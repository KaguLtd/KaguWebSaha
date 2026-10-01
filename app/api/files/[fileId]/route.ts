import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "path";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/session";
import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";
import { resolveStoragePath } from "@/lib/files/storage";
import { parseByteRange } from "@/lib/files/http-range";

export const runtime = "nodejs";

async function serveFile(
  request: Request,
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

  const canAccess =
    user.role === "ADMIN" ||
    (user.role === "OBSERVER" && file.project.isActive) ||
    (user.role === "PERSONNEL" && file.project.dailyTasks.length > 0);

  if (!canAccess) {
    return NextResponse.json({ error: "Yetkisiz dosya erisimi." }, { status: 403 });
  }

  const absolutePath = resolveStoragePath(file.storagePath);
  let info;

  try {
    info = await stat(absolutePath);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    return NextResponse.json({ error: "Dosya depoda bulunamadi." }, { status: 404 });
  }
  const encodedFileName = encodeURIComponent(path.basename(file.originalName));
  const url = new URL(request.url);
  const inlineType = file.mimeType === "application/pdf" || file.mimeType.startsWith("video/") ||
    ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"].includes(file.mimeType);
  const disposition = url.searchParams.get("download") === "1" || !inlineType ? "attachment" : "inline";

  const etag = `"${file.id}-${info.size}-${Math.trunc(info.mtimeMs)}"`;
  const ifRange = request.headers.get("if-range");
  const rangeHeader = !ifRange || ifRange === etag || ifRange === info.mtime.toUTCString()
    ? request.headers.get("range") : null;
  const range = parseByteRange(rangeHeader, info.size);
  const headers: Record<string, string> = {
    "Content-Type": file.mimeType,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedFileName}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Last-Modified": info.mtime.toUTCString(),
    ETag: etag,
  };
  if (range === "unsatisfiable") {
    headers["Content-Range"] = `bytes */${info.size}`;
    return new Response(null, { status: 416, headers });
  }
  const length = range ? range.end - range.start + 1 : info.size;
  headers["Content-Length"] = String(length);
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
  if (request.method === "HEAD" || length === 0) return new Response(null, { status: range ? 206 : 200, headers });
  const stream = createReadStream(absolutePath, { ...(range ?? {}), signal: request.signal });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}

export const GET = serveFile;
export const HEAD = serveFile;
