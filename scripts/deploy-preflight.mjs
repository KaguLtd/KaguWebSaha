import { access, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "APP_ORIGIN",
  "UPLOAD_DIR",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "ADMIN_FULL_NAME",
];

function requireEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function assertUploadDir(uploadDir) {
  const resolved = path.resolve(process.cwd(), uploadDir);
  await mkdir(resolved, { recursive: true });
  await access(resolved, constants.R_OK | constants.W_OK);

  const probePath = path.join(resolved, `.write-test-${Date.now()}`);
  await writeFile(probePath, "ok");
  await rm(probePath, { force: true });

  return resolved;
}

async function main() {
  for (const name of REQUIRED_ENV) {
    requireEnv(name);
  }

  const uploadRoot = await assertUploadDir(process.env.UPLOAD_DIR);

  console.log("Preflight OK");
  console.log(`Upload directory is writable: ${uploadRoot}`);
  console.log("Required environment variables are present.");
}

main().catch((error) => {
  console.error(`Preflight failed: ${error.message}`);
  process.exitCode = 1;
});

