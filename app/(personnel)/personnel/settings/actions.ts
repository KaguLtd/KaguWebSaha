"use server";

import { revalidatePath } from "next/cache";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function readRequiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "");

  if (!value.trim()) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export async function changePasswordAction(formData: FormData) {
  const user = await requireRole("PERSONNEL");
  const currentPassword = readRequiredText(formData, "currentPassword");
  const newPassword = readRequiredText(formData, "newPassword");

  const freshUser = await prisma.user.findUnique({
    where: {
      id: user.id,
    },
  });

  if (!freshUser || !verifyPassword(currentPassword, freshUser.passwordHash)) {
    throw new Error("Mevcut sifre hatali.");
  }

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash: hashPassword(newPassword),
    },
  });

  revalidatePath("/personnel/settings");
}

