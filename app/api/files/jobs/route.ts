import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { scheduleHeicConversionProcessing } from "@/lib/files/heic-conversion-jobs";
import { scheduleImageThumbnailProcessing } from "@/lib/files/image-thumbnail-jobs";
import { UploadProtocolError } from "@/lib/uploads/protocol";
import { uploadError, uploadUser } from "@/lib/uploads/server";

export async function GET(request: Request) {
  try {
    const user = await uploadUser(request);
    if (user.role !== "ADMIN") throw new UploadProtocolError("Bu islem yalniz yonetici icin.", 403);
    const [heic, thumbnails] = await Promise.all([
      prisma.heicConversionJob.groupBy({ by: ["status"], _count: true }),
      prisma.imageThumbnailJob.groupBy({ by: ["status"], _count: true }),
    ]);
    return NextResponse.json({ ok: true, heic, thumbnails }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return uploadError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await uploadUser(request);
    if (user.role !== "ADMIN") throw new UploadProtocolError("Bu islem yalniz yonetici icin.", 403);
    const data = await request.json() as { id?: unknown; kind?: unknown };
    if (typeof data.id !== "string" || !["heic", "thumbnail"].includes(String(data.kind))) throw new UploadProtocolError("Is bilgisi gecersiz.", 400);
    const args = { where: { id: data.id, status: "FAILED" as const, completedAt: null }, data: {
      status: "PENDING" as const, attempts: 0, nextAttemptAt: new Date(), lastError: null, lockedBy: null, lockedUntil: null,
    } };
    const result = data.kind === "heic" ? await prisma.heicConversionJob.updateMany(args) : await prisma.imageThumbnailJob.updateMany(args);
    if (result.count !== 1) throw new UploadProtocolError("Is yeniden denemeye uygun degil; tamamlanmis dosya ayri incelenmeli.", 409);
    scheduleHeicConversionProcessing(); scheduleImageThumbnailProcessing();
    return NextResponse.json({ ok: true });
  } catch (error) { return uploadError(error); }
}
