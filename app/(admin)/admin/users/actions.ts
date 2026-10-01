"use server";

import { revalidatePath } from "next/cache";
import type { UserRole } from "@prisma/client";

import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getTodayDateOnly } from "@/lib/dates/today";
import { parseDateOnly } from "@/lib/dates/calendar";
import { teamHeadcount } from "@/lib/teams/headcount";

function parseRole(value: FormDataEntryValue | null): UserRole {
  if (value === "ADMIN" || value === "OBSERVER" || value === "PERSONNEL") {
    return value;
  }

  return "PERSONNEL";
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

  if (role !== "PERSONNEL" || !isActive) {
    const activeTeam = await prisma.team.findFirst({ where: { representativeUserId: userId, isActive: true } });
    if (activeTeam) throw new Error("Bu kullanıcı aktif bir ekibin temsilcisi. Önce ekibi pasifleştirin.");
  }

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

export async function saveTeamAction(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("teamId") ?? "").trim();
  const name = parseRequiredText(formData, "name");
  const representativeUserId = parseRequiredText(formData, "representativeUserId");
  const rawCount = String(formData.get("extraPersonnelCount") ?? "").trim();
  if (!rawCount || !/^\d+$/.test(rawCount)) throw new Error("Hesabı olmayan personel sayısı tam sayı olmalıdır.");
  const extraPersonnelCount = Number(rawCount);
  const includeRepresentative = formData.get("includeRepresentative") === "on";
  teamHeadcount(extraPersonnelCount, includeRepresentative);
  const isActive = formData.get("isActive") === "on";
  const effectiveFrom = parseDateOnly(String(formData.get("effectiveFrom") ?? ""));
  if (!effectiveFrom) throw new Error("Geçerli bir başlangıç tarihi seçin.");
  if (name.length > 120) throw new Error("Ekip adı en fazla 120 karakter olabilir.");
  const representative = await prisma.user.findUnique({ where: { id: representativeUserId }, select: { role: true, isActive: true } });
  if (!representative || representative.role !== "PERSONNEL" || (isActive && !representative.isActive)) throw new Error("Ekip temsilcisi aktif bir personel hesabı olmalıdır.");
  if (id) {
    const previous = await prisma.team.findUnique({ where: { id }, include: { _count: { select: { assignments: true } } } });
    if (!previous) throw new Error("Ekip bulunamadı.");
    if (previous.representativeUserId !== representativeUserId && previous._count.assignments > 0) {
      throw new Error("Görevlerde kullanılmış ekibin temsilcisi değiştirilemez. Yeni bir ekip oluşturun.");
    }
  } else if (effectiveFrom < getTodayDateOnly()) {
    throw new Error("Yeni ekip için başlangıç tarihi bugün veya sonrası olmalıdır.");
  }
  if (isActive) {
    const other = await prisma.team.findFirst({ where: { representativeUserId, isActive: true, ...(id ? { id: { not: id } } : {}) } });
    if (other) throw new Error("Bu temsilcinin zaten aktif bir ekibi var.");
  }
  const data = { name, representativeUserId, extraPersonnelCount, includeRepresentative, isActive, effectiveFrom };
  try {
    if (id) await prisma.team.update({ where: { id }, data });
    else await prisma.team.create({ data });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new Error("Bu temsilcinin zaten aktif bir ekibi var.");
    throw error;
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin/schedule");
}
