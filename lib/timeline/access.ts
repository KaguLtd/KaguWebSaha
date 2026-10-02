import type { Prisma } from "@prisma/client";

/** Observer timeline scope within an active project. */
export function observerTimelineWhere(userId: string): Prisma.ProjectTimelineEventWhereInput {
  return {
    OR: [
      // Site movement and all uploaded media are shared across the project.
      { eventType: { in: ["ARRIVED_SITE", "LEFT_SITE", "FILE_ADDED"] } },
      {
        dailyTaskId: null,
        OR: [
          { projectVisitId: { not: null } },
          { userId },
          // Independent project and quick notes are shared regardless of author.
          { eventType: "NOTE_ADDED" },
        ],
      },
    ],
  };
}
