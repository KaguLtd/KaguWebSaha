import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { UploadProtocolError } from "@/lib/uploads/protocol";
import { readUploadMetadata, renewedUploadExpiry, requireUploadContext, uploadError, uploadStatus, uploadUser } from "@/lib/uploads/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await uploadUser(request);
    const payload = await request.json();
    if (payload && typeof payload === "object" && "ownerUserId" in payload && payload.ownerUserId !== user.id) {
      throw new UploadProtocolError("Bu taslak baska bir kullaniciya ait. Ilgili hesaba giris yapin.", 401);
    }
    const metadata = readUploadMetadata(payload);
    await requireUploadContext(user, metadata);
    const id = randomUUID();
    const session = await prisma.uploadSession.upsert({
      where: { uploadedByUserId_clientUploadId: { uploadedByUserId: user.id, clientUploadId: metadata.clientUploadId } },
      create: { id, uploadedByUserId: user.id, ...metadata, tempStoragePath: `pending-uploads/${id}.bin`, expiresAt: renewedUploadExpiry() },
      update: {},
    });
    if (["projectId", "dailyTaskId", "projectVisitId", "originalName", "mimeType", "sizeBytes", "note"].some((key) => session[key as keyof typeof metadata] !== metadata[key as keyof typeof metadata])) {
      throw new UploadProtocolError("Ayni yukleme kimligi farkli bir dosyada kullanilamaz.", 409);
    }
    if (session.status === "OPEN" && session.expiresAt <= new Date()) {
      const renewed = await prisma.uploadSession.update({ where: { id: session.id }, data: { expiresAt: renewedUploadExpiry() } });
      return NextResponse.json(uploadStatus(renewed));
    }
    return NextResponse.json(uploadStatus(session));
  } catch (error) { return uploadError(error); }
}
