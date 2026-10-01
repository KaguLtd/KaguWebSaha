import { access, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

class PreflightError extends Error {}

function requireEnv(env, name) {
  if (!env[name]?.trim()) throw new PreflightError(`${name} is required`);
  return env[name].trim();
}

export async function loadServiceEnvironment(file, serviceEnv = process.env, optional = false) {
  try { return { ...parseEnv(await readFile(file, "utf8")), ...serviceEnv }; }
  catch (error) {
    if (optional && error.code === "ENOENT") return { ...serviceEnv };
    throw new PreflightError("Environment file could not be read or parsed");
  }
}

export function parsePreflightArgs(args) {
  const options = { mode: "upgrade", allowFallback: false, checkWorker: false };
  for (const arg of args) {
    if (arg.startsWith("--mode=")) options.mode = arg.slice(7);
    else if (arg.startsWith("--env-file=")) options.envFile = arg.slice(11);
    else if (arg.startsWith("--worker-env-file=")) options.workerEnvFile = arg.slice(18);
    else if (arg === "--allow-fallback") options.allowFallback = true;
    else if (arg === "--check-worker") options.checkWorker = true;
    else throw new PreflightError("Unknown preflight option");
  }
  if (!["upgrade", "bootstrap"].includes(options.mode)) throw new PreflightError("Mode must be upgrade or bootstrap");
  return options;
}

function validateDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new PreflightError();
  } catch { throw new PreflightError("DATABASE_URL must be a PostgreSQL URL"); }
}

function validateOrigin(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new PreflightError();
  } catch { throw new PreflightError("APP_ORIGIN must be an HTTP(S) origin without credentials or a path"); }
}

async function assertUploadDir(uploadDir) {
  if (!path.isAbsolute(uploadDir) || path.parse(uploadDir).root === path.resolve(uploadDir)) throw new PreflightError("UPLOAD_DIR must be an absolute, dedicated storage directory");
  await mkdir(uploadDir, { recursive: true });
  const resolved = await realpath(uploadDir);
  await access(resolved, constants.R_OK | constants.W_OK);
  const probePath = path.join(resolved, `.kagu-write-test-${randomUUID()}`);
  try { await writeFile(probePath, "ok", { flag: "wx", mode: 0o600 }); }
  finally { await rm(probePath, { force: true }); }
  return resolved;
}

export async function runPreflight({ args = [], env = process.env, cwd = process.cwd(), nodeVersion = process.versions.node } = {}) {
  const options = parsePreflightArgs(args);
  if (Number(nodeVersion.split(".")[0]) !== 24) throw new PreflightError("Node.js 24 is required; use the repository .node-version pin");
  const environment = await loadServiceEnvironment(path.resolve(cwd, options.envFile ?? ".env"), env, !options.envFile);
  validateDatabaseUrl(requireEnv(environment, "DATABASE_URL"));
  validateOrigin(requireEnv(environment, "APP_ORIGIN"));
  if (options.mode === "bootstrap") {
    for (const name of ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_FULL_NAME"]) requireEnv(environment, name);
  }
  const uploadRoot = await assertUploadDir(requireEnv(environment, "UPLOAD_DIR"));
  const external = environment.MEDIA_WORKER_MODE === "external";
  if (!external && !options.allowFallback) throw new PreflightError("Production requires MEDIA_WORKER_MODE=external and a separate supervised worker");
  if (external) {
    try { await access(path.join(cwd, "dist/media-worker/scripts/media-worker.js"), constants.R_OK); }
    catch { throw new PreflightError("Compiled media worker is missing; run npm ci, prisma generate and npm run build before preflight"); }
    const heartbeatFile = requireEnv(environment, "MEDIA_WORKER_HEARTBEAT_FILE");
    if (!path.isAbsolute(heartbeatFile)) throw new PreflightError("MEDIA_WORKER_HEARTBEAT_FILE must be absolute");
    if (path.resolve(heartbeatFile) === uploadRoot || path.resolve(heartbeatFile).startsWith(uploadRoot + path.sep)) throw new PreflightError("Worker heartbeat must be outside the upload directory");
    if (options.workerEnvFile) {
      const workerEnv = await loadServiceEnvironment(path.resolve(cwd, options.workerEnvFile), {});
      if (workerEnv.DATABASE_URL !== environment.DATABASE_URL) throw new PreflightError("Web and worker DATABASE_URL declarations differ");
      if (!workerEnv.UPLOAD_DIR || !path.isAbsolute(workerEnv.UPLOAD_DIR) || await realpath(workerEnv.UPLOAD_DIR) !== uploadRoot) throw new PreflightError("Web and worker UPLOAD_DIR declarations differ");
      if (!workerEnv.MEDIA_WORKER_HEARTBEAT_FILE || !path.isAbsolute(workerEnv.MEDIA_WORKER_HEARTBEAT_FILE) || path.resolve(workerEnv.MEDIA_WORKER_HEARTBEAT_FILE) !== path.resolve(heartbeatFile)) throw new PreflightError("Web and worker heartbeat declarations differ");
    }
    if (options.checkWorker) {
      let heartbeat;
      try { heartbeat = JSON.parse(await readFile(heartbeatFile, "utf8")); }
      catch { throw new PreflightError("Worker heartbeat is missing or unreadable"); }
      const now = Date.now();
      const heartbeatAge = now - Date.parse(heartbeat.lastHeartbeatAt);
      const batchAge = now - Date.parse(heartbeat.lastSuccessfulBatchAt);
      if (heartbeat.state !== "RUNNING" || !Number.isFinite(heartbeatAge) || heartbeatAge < -5_000 || heartbeatAge > 45_000 || !Number.isFinite(batchAge) || batchAge < -5_000 || batchAge > 300_000) throw new PreflightError("Worker is unhealthy, its heartbeat is stale, or no recent batch completed");
    }
  } else if (options.checkWorker || options.workerEnvFile) throw new PreflightError("Worker checks require external mode");
  return { mode: options.mode, uploadRoot, workerMode: external ? "external" : "fallback", workerChecked: options.checkWorker, sharedEnvironmentChecked: Boolean(options.workerEnvFile) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPreflight({ args: process.argv.slice(2) }).then((result) => {
    console.log(`Preflight OK (${result.mode}; ${result.workerMode})`);
    console.log("Storage is writable; configuration values and credentials are not logged.");
    console.log(result.sharedEnvironmentChecked ? "Shared web/worker declarations match." : "Worker environment has not been independently compared; use a shared service environment file.");
    if (result.workerChecked) console.log("Worker heartbeat and successful batch are recent.");
    console.log("No database connection or migration was performed.");
  }).catch((error) => {
    const message = error instanceof PreflightError ? error.message : "Storage or runtime files could not be accessed; check service permissions and paths";
    console.error(`Preflight failed: ${message}`);
    process.exitCode = 1;
  });
}

