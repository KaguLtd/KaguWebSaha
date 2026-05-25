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
              ...(user.role === "OBSERVER"
                ? {}
                : {
                    assignees: {
                      some: {
                        userId: user.id,
                      },
                    },
                  }),
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

  if (!file.thumbnailStoragePath || !file.thumbnailMimeType) {
    return NextResponse.json({ error: "Thumbnail hazir degil." }, { status: 404 });
  }

  let bytes: Buffer;

  try {
    bytes = await readFile(resolveStoragePath(file.thumbnailStoragePath));
  } catch {
    return NextResponse.json({ error: "Thumbnail depoda bulunamadi." }, { status: 404 });
  }

  const parsedName = path.parse(file.originalName);
  const thumbnailName = `${parsedName.name || "thumbnail"}.webp`;
  const encodedFileName = encodeURIComponent(thumbnailName);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": file.thumbnailMimeType,
    },
  });
}
