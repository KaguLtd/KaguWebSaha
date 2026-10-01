import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadServiceEnvironment, parsePreflightArgs, runPreflight } from "../deploy-preflight.mjs";
import { guardedCiDatabaseUrl } from "../test-migrations-ci.mjs";
import { writeWorkerHeartbeat } from "../media-worker-monitor.ts";

async function temporaryFixture(run) {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, "kagu-operations-test-"));
  assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep));
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function runtimeEnv(directory) {
  return { DATABASE_URL: "postgresql://fixture:never-connect@127.0.0.1:1/fixture", APP_ORIGIN: "https://saha.example.test", UPLOAD_DIR: path.join(directory, "uploads"), MEDIA_WORKER_MODE: "external", MEDIA_WORKER_HEARTBEAT_FILE: path.join(directory, "health/worker.json") };
}

async function compiledWorker(directory) {
  const worker = path.join(directory, "dist/media-worker/scripts/media-worker.js");
  await mkdir(path.dirname(worker), { recursive: true }); await writeFile(worker, "// fixture; never executed");
}

test("upgrade preflight does not require bootstrap passwords, connect to a database or leave storage probes", () => temporaryFixture(async (directory) => {
  await compiledWorker(directory);
  const result = await runPreflight({ env: runtimeEnv(directory), cwd: directory, nodeVersion: "24.15.0" });
  assert.equal(result.mode, "upgrade"); assert.equal(result.workerMode, "external");
  assert.deepEqual(await readdir(result.uploadRoot), []);
  await assert.rejects(runPreflight({ args: ["--mode=bootstrap"], env: runtimeEnv(directory), cwd: directory, nodeVersion: "24.15.0" }), /ADMIN_USERNAME/);
}));

test("environment files load without overriding explicitly supplied service values", () => temporaryFixture(async (directory) => {
  const file = path.join(directory, "runtime.env");
  await writeFile(file, 'APP_ORIGIN="https://file.example.test"\nADMIN_PASSWORD="fixture-secret"\n');
  const env = await loadServiceEnvironment(file, { APP_ORIGIN: "https://service.example.test" });
  assert.equal(env.APP_ORIGIN, "https://service.example.test"); assert.equal(env.ADMIN_PASSWORD, "fixture-secret");
  assert.deepEqual(await loadServiceEnvironment(path.join(directory, "absent.env"), {}, true), {});
  await assert.rejects(loadServiceEnvironment(path.join(directory, "absent.env"), {}), /Environment file/);
}));

test("production preflight rejects relative storage, fallback, wrong Node and missing worker output", () => temporaryFixture(async (directory) => {
  const env = runtimeEnv(directory);
  await assert.rejects(runPreflight({ env: { ...env, UPLOAD_DIR: "./uploads" }, cwd: directory, nodeVersion: "24.15.0" }), /absolute/);
  await assert.rejects(runPreflight({ env: { ...env, MEDIA_WORKER_MODE: "fallback" }, cwd: directory, nodeVersion: "24.15.0" }), /separate supervised worker/);
  await assert.rejects(runPreflight({ env, cwd: directory, nodeVersion: "20.19.0" }), /Node.js 24/);
  await assert.rejects(runPreflight({ env, cwd: directory, nodeVersion: "24.15.0" }), /Compiled media worker/);
  const local = await runPreflight({ args: ["--allow-fallback"], env: { ...env, MEDIA_WORKER_MODE: "fallback" }, cwd: directory, nodeVersion: "24.15.0" });
  assert.equal(local.workerMode, "fallback");
}));

test("worker and web declarations must point at the same database, storage and heartbeat", () => temporaryFixture(async (directory) => {
  await compiledWorker(directory);
  const env = runtimeEnv(directory); const file = path.join(directory, "worker.env");
  const writeEnv = async (values) => writeFile(file, Object.entries(values).map(([key, value]) => `${key}="${value}"`).join("\n"));
  await writeEnv(env);
  const result = await runPreflight({ args: [`--worker-env-file=${file}`], env, cwd: directory, nodeVersion: "24.15.0" });
  assert.equal(result.sharedEnvironmentChecked, true);
  await writeEnv({ ...env, DATABASE_URL: "postgresql://fixture:never-connect@127.0.0.1:1/different" });
  await assert.rejects(runPreflight({ args: [`--worker-env-file=${file}`], env, cwd: directory, nodeVersion: "24.15.0" }), /DATABASE_URL declarations differ/);
  const other = path.join(directory, "other-uploads"); await mkdir(other);
  await writeEnv({ ...env, UPLOAD_DIR: other });
  await assert.rejects(runPreflight({ args: [`--worker-env-file=${file}`], env, cwd: directory, nodeVersion: "24.15.0" }), /UPLOAD_DIR declarations differ/);
}));

test("worker readiness rejects stale, degraded and absent successful batches", () => temporaryFixture(async (directory) => {
  await compiledWorker(directory); const env = runtimeEnv(directory);
  const base = { version: 1, pid: 123, state: "RUNNING", startedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(), lastSuccessfulBatchAt: new Date().toISOString(), successfulBatches: 1, lastBatchCount: 0, pendingJobs: 0, oldestPendingAt: null, queueObservedAt: new Date().toISOString() };
  const check = () => runPreflight({ args: ["--check-worker"], env, cwd: directory, nodeVersion: "24.15.0" });
  await assert.rejects(check(), /heartbeat is missing/);
  await writeWorkerHeartbeat(env.MEDIA_WORKER_HEARTBEAT_FILE, base); assert.equal((await check()).workerChecked, true);
  for (const change of [{ state: "DEGRADED" }, { lastSuccessfulBatchAt: null }, { lastHeartbeatAt: new Date(Date.now() - 60_000).toISOString() }, { lastSuccessfulBatchAt: new Date(Date.now() - 360_000).toISOString() }]) {
    await writeWorkerHeartbeat(env.MEDIA_WORKER_HEARTBEAT_FILE, { ...base, ...change }); await assert.rejects(check(), /unhealthy/);
  }
  assert.deepEqual(await readdir(path.dirname(env.MEDIA_WORKER_HEARTBEAT_FILE)), ["worker.json"]);
  assert.equal(JSON.parse(await readFile(env.MEDIA_WORKER_HEARTBEAT_FILE, "utf8")).version, 1);
  await access(env.UPLOAD_DIR);
}));

test("CI migration target guard never falls back to live DATABASE_URL and rejects alternate destinations", () => {
  const valid = { CI: "true", GITHUB_ACTIONS: "true", CI_DATABASE_URL: "postgresql://kagu_ci:ci_only_password@127.0.0.1:5432/kagu_saha_ci_v11?schema=public" };
  assert.equal(guardedCiDatabaseUrl(valid), valid.CI_DATABASE_URL);
  assert.throws(() => guardedCiDatabaseUrl({ DATABASE_URL: valid.CI_DATABASE_URL }), /isolated GitHub Actions/);
  for (const url of [valid.CI_DATABASE_URL.replace("127.0.0.1", "production.example.test"), valid.CI_DATABASE_URL.replace("kagu_saha_ci_v11", "kagu_saha"), valid.CI_DATABASE_URL.replace("5432", "5433"), valid.CI_DATABASE_URL + "&host=production.example.test", valid.CI_DATABASE_URL.replace("ci_only_password", "actual-password")]) {
    assert.throws(() => guardedCiDatabaseUrl({ ...valid, CI_DATABASE_URL: url }), /dedicated loopback CI service/);
  }
  assert.throws(() => guardedCiDatabaseUrl({ ...valid, GITHUB_ACTIONS: "false" }), /isolated GitHub Actions/);
});

test("preflight validates option modes without accepting an implicit reset or deploy", () => {
  assert.equal(parsePreflightArgs([]).mode, "upgrade");
  assert.equal(parsePreflightArgs(["--mode=bootstrap"]).mode, "bootstrap");
  assert.throws(() => parsePreflightArgs(["--mode=reset"]), /Mode must/);
  assert.throws(() => parsePreflightArgs(["--deploy"]), /Unknown/);
});

test("CLI failure identifies the missing bootstrap field without printing environment secrets", () => temporaryFixture(async (directory) => {
  const secret = "fixture-password-must-not-be-logged";
  const file = path.join(directory, "bootstrap.env");
  await writeFile(file, `DATABASE_URL="postgresql://fixture:${secret}@127.0.0.1:1/fixture"\nAPP_ORIGIN="https://saha.example.test"\nADMIN_PASSWORD="${secret}"\n`);
  let failure;
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../deploy-preflight.mjs", import.meta.url)), "--mode=bootstrap", `--env-file=${file}`], { cwd: directory, env: {}, timeout: 10_000 });
  } catch (error) { failure = error; }
  assert.equal(failure?.code, 1);
  assert.match(failure.stderr, /ADMIN_USERNAME is required/);
  assert.ok(!`${failure.stdout}${failure.stderr}`.includes(secret));
}));
