import { PrismaClient, UserRole } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");

  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const username = requiredEnv("ADMIN_USERNAME").trim();
  const password = requiredEnv("ADMIN_PASSWORD");
  const fullName = requiredEnv("ADMIN_FULL_NAME").trim();

  if (!username || !fullName) {
    throw new Error("ADMIN_USERNAME and ADMIN_FULL_NAME cannot be empty");
  }

  await prisma.user.upsert({
    where: {
      username,
    },
    create: {
      username,
      passwordHash: hashPassword(password),
      fullName,
      role: UserRole.ADMIN,
      isActive: true,
    },
    update: {
      passwordHash: hashPassword(password),
      fullName,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  console.log(`Admin user is ready: ${username}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

