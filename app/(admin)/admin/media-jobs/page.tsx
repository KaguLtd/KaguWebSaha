import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { scheduleHeicConversionProcessing } from "@/lib/files/heic-conversion-jobs";
import { scheduleImageThumbnailProcessing } from "@/lib/files/image-thumbnail-jobs";

export const dynamic = "force-dynamic";

async function retryJob(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const args = { where: { id, status: "FAILED" as const, completedAt: null }, data: {
    status: "PENDING" as const, attempts: 0, nextAttemptAt: new Date(), lastError: null, lockedBy: null, lockedUntil: null,
  } };
  if (kind === "heic") await prisma.heicConversionJob.updateMany(args);
  if (kind === "thumbnail") await prisma.imageThumbnailJob.updateMany(args);
  scheduleHeicConversionProcessing(); scheduleImageThumbnailProcessing();
  revalidatePath("/admin/media-jobs");
}

export default async function MediaJobsPage() {
  await requireRole("ADMIN");
  const [heic, thumbnails, heicCounts, thumbnailCounts] = await Promise.all([
    prisma.heicConversionJob.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 30 }),
    prisma.imageThumbnailJob.findMany({ where: { status: "FAILED" }, include: { projectFile: { select: { originalName: true } } }, orderBy: { updatedAt: "desc" }, take: 30 }),
    prisma.heicConversionJob.groupBy({ by: ["status"], _count: true }),
    prisma.imageThumbnailJob.groupBy({ by: ["status"], _count: true }),
  ]);
  const jobs = [
    ...heic.map((job) => ({ ...job, kind: "heic", name: job.originalName })),
    ...thumbnails.map((job) => ({ ...job, kind: "thumbnail", name: job.projectFile.originalName })),
  ];
  const counts = new Map<string, number>();
  for (const group of [...heicCounts, ...thumbnailCounts]) counts.set(group.status, (counts.get(group.status) ?? 0) + group._count);
  return <main className="space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold">Dosya işlemleri</h1><p className="mt-2 text-sm text-muted-foreground">Dosya aktarımı tamamlanmış olabilir; fotoğraf dönüşümü ve önizleme ayrı işlemlerdir.</p></div>
    <div className="flex flex-wrap gap-3">{[["PENDING", "Bekleyen"], ["PROCESSING", "İşlenen"], ["FAILED", "Başarısız"]].map(([status, label]) => <p className="rounded-md border bg-white px-4 py-3" key={status}>{label}: <strong>{counts.get(status) ?? 0}</strong></p>)}</div>
    <section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Başarısız işlemler</h2>
      {jobs.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Başarısız işlem yok.</p> : <ul className="mt-3 space-y-3">{jobs.map((job) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" key={`${job.kind}:${job.id}`}>
        <div><p className="break-all font-medium">{job.name}</p><p className="text-sm text-muted-foreground">{job.kind === "heic" ? "Fotoğraf dönüşümü" : "Önizleme"} · {job.attempts} deneme</p><p className="text-sm">{job.completedAt ? "Önceden tamamlanmış kayıt; dosya eşleşmesi ayrıca incelenmeli." : "Kaynak dosya korunuyor. Tekrar deneyebilirsiniz."}</p></div>
        {!job.completedAt ? <form action={retryJob}><input name="id" type="hidden" value={job.id} /><input name="kind" type="hidden" value={job.kind} /><button className="rounded-md border px-3 py-2 text-sm" type="submit">Tekrar dene</button></form> : null}
      </li>)}</ul>}
    </section>
  </main>;
}
