"use server";

import { revalidatePath } from "next/cache";
import type { UserRole } from "@prisma/client";

import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function parseRole(value: FormDataEntryValue | null): UserRole {
  return value === "ADMIN" ? "ADMIN" : "PERSONNEL";
}

function parseRequiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export async function createUserAction(formData: FormData) {
  await requireRole("ADMIN");

  const username = parseRequiredText(formData, "username");
  const password = parseRequiredText(formData, "password");
  const fullName = parseRequiredText(formData, "fullName");
  const role = parseRole(formData.get("role"));

  await prisma.user.create({
    data: {
      username,
      passwordHash: hashPassword(password),
      fullName,
      role,
      isActive: true,
    },
  });

  revalidatePath("/admin/users");
}

export async function updateUserAction(formData: FormData) {
  const currentUser = await requireRole("ADMIN");

  const userId = parseRequiredText(formData, "userId");
  const username = parseRequiredText(formData, "username");
  const fullName = parseRequiredText(formData, "fullName");
  const role = parseRole(formData.get("role"));
  const isActive = formData.get("isActive") === "on";
  const newPassword = String(formData.get("newPassword") ?? "");

  const data = {
    username,
    fullName,
    role,
    isActive: userId === currentUser.id ? true : isActive,
    ...(newPassword.trim()
      ? {
          passwordHash: hashPassword(newPassword),
        }
      : {}),
  };

  await prisma.user.update({
    where: {
      id: userId,
    },
    data,
  });

  revalidatePath("/admin/users");
}

