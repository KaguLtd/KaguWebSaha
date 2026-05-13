"use server";

import { redirect } from "next/navigation";

import { createSession, destroySession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Kullanici ID ve sifre zorunludur." };
  }

  const user = await prisma.user.findUnique({
    where: {
      username,
    },
  });

  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return { error: "Kullanici ID veya sifre hatali." };
  }

  await createSession(user.id);

  redirect(user.role === "ADMIN" ? "/admin" : "/personnel");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

