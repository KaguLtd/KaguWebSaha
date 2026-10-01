import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { scheduleHeicConversionProcessing } from "@/lib/files/heic-conversion-jobs";
import {
  queueMissingProjectFileThumbnails,
  scheduleImageThumbnailProcessing,
} from "@/lib/files/image-thumbnail-jobs";

export async function GET() {
  const user = await getCurrentUser();
  const activeStatuses: ("PENDING" | "PROCESSING")[] = ["PENDING", "PROCESSING"];
  if (!user) return NextResponse.json({ error: "Oturum süresi doldu." }, { status: 401 });
  if (user.role === "ADMIN") await queueMissingProjectFileThumbnails(25);
  const where =
    user.role !== "ADMIN"
      ? {
          uploadedByUserId: user.id,
          status: {
            in: activeStatuses,
          },
        }
      : {
          status: {
            in: activeStatuses,
          },
        };

  const pendingCount = await prisma.heicConversionJob.count({
    where,
  });
  const pendingThumbnailCount = await prisma.imageThumbnailJob.count({
    where: {
      ...(user.role !== "ADMIN" ? { projectFile: { uploadedByUserId: user.id } } : {}),
      status: {
        in: activeStatuses,
      },
    },
  });
  const latestCompletedJob = await prisma.heicConversionJob.findFirst({
    where: {
      ...(user.role !== "ADMIN" ? { uploadedByUserId: user.id } : {}),
      status: "COMPLETED",
      completedAt: {
        not: null,
      },
    },
    orderBy: {
      completedAt: "desc",
    },
    select: {
      completedAt: true,
      id: true,
    },
  });
  const latestCompletedThumbnailJob = await prisma.imageThumbnailJob.findFirst({
    where: {
      ...(user.role !== "ADMIN" ? { projectFile: { uploadedByUserId: user.id } } : {}),
      status: "COMPLETED",
      completedAt: {
        not: null,
      },
    },
    orderBy: {
      completedAt: "desc",
    },
    select: {
      completedAt: true,
      id: true,
    },
  });
  const latestCompleted =
    latestCompletedThumbnailJob?.completedAt &&
    (!latestCompletedJob?.completedAt ||
      latestCompletedThumbnailJob.completedAt > latestCompletedJob.completedAt)
      ? latestCompletedThumbnailJob
      : latestCompletedJob;
  const totalPendingCount = pendingCount + pendingThumbnailCount;
  const [failedHeicCount, failedThumbnailCount] = await Promise.all([
    prisma.heicConversionJob.count({ where: { ...(user.role !== "ADMIN" ? { uploadedByUserId: user.id } : {}), status: "FAILED" } }),
    prisma.imageThumbnailJob.count({ where: { ...(user.role !== "ADMIN" ? { projectFile: { uploadedByUserId: user.id } } : {}), status: "FAILED" } }),
  ]);

  if (pendingCount > 0) {
    scheduleHeicConversionProcessing();
  }

  if (pendingThumbnailCount > 0) {
    scheduleImageThumbnailProcessing();
  }

  return NextResponse.json({
    completedVersion: latestCompleted?.completedAt
      ? `${latestCompleted.completedAt.toISOString()}:${latestCompleted.id}`
      : null,
    pendingCount: totalPendingCount,
    failedCount: failedHeicCount + failedThumbnailCount,
  });
}
