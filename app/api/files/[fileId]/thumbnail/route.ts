import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canReadProjectFile, readProjectFileForAccess } from "@/lib/files/access";
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
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Oturum süresi doldu. Tekrar giriş yapın." }, { status: 401 });
  const { fileId } = await params;
  const file = await readProjectFileForAccess(fileId, user);

  if (!file) {
    return NextResponse.json({ error: "Dosya bulunamadi." }, { status: 404 });
  }

  const canAccess = canReadProjectFile(user, file);

  if (!canAccess) {
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
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": file.thumbnailMimeType,
    },
  });
}
