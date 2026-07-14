import { getTodayDateOnly } from "@/lib/dates/today";
import { prisma } from "@/lib/db/prisma";

export async function completeStaleOnSiteTasks() {
  await prisma.dailyTask.updateMany({
    where: {
      status: "ON_SITE",
      taskDate: {
        lt: getTodayDateOnly(),
      },
    },
    data: {
      status: "COMPLETED",
    },
  });
}
