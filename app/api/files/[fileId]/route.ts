import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/session";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";
import { resolveStoragePath } from "@/lib/files/storage";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      fileId: string;
    }>;
  },
) {
  const user = await requireUser();

  const { fileId } = await params;
  const file = await prisma.projectFile.findUnique({
    where: {
      id: fileId,
    },
    include: {
      project: {
        include: {
          dailyTasks: {
            where: {
              taskDate: getTodayDateOnly(),
              assignees: {
                some: {
                  userId: user.id,
                },
              },
            },
            select: {
              id: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  if (!file) {
    return NextResponse.json({ error: "Dosya bulunamadi." }, { status: 404 });
  }

  if (user.role !== "ADMIN" && file.project.dailyTasks.length === 0) {
    return NextResponse.json({ error: "Yetkisiz dosya erisimi." }, { status: 403 });
  }

  const absolutePath = resolveStoragePath(file.storagePath);
  let bytes: Buffer;

  try {
    bytes = await readFile(absolutePath);
  } catch {
    return NextResponse.json({ error: "Dosya depoda bulunamadi." }, { status: 404 });
  }
  const encodedFileName = encodeURIComponent(path.basename(file.originalName));

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
    },
  });
}
