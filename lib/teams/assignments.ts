import { prisma } from "@/lib/db/prisma";
import { getTodayDateOnly } from "@/lib/dates/today";
import { resolveAssignmentSnapshots } from "@/lib/teams/selection";
import type { AssignmentSnapshot } from "@/lib/teams/selection";
export type { AssignmentSnapshot } from "@/lib/teams/selection";

function uniqueValues(form: FormData, name: string) {
  return [...new Set(form.getAll(name).map(String).map((value) => value.trim()).filter(Boolean))];
}

/** Keep existing assignment snapshots, including legacy NULL values, on ordinary edits. */
export async function buildAssignmentSnapshots(
  form: FormData,
  taskDate: Date,
  previous: AssignmentSnapshot[] = [],
  observerId?: string,
): Promise<AssignmentSnapshot[]> {
  if (observerId) {
    return [{ userId: observerId, teamId: null, teamNameSnapshot: null, headcountSnapshot: 0, actualHeadcount: null, workforceKindSnapshot: "OBSERVER" }];
  }
  const userIds = uniqueValues(form, "assigneeIds");
  const teamIds = uniqueValues(form, "teamIds");
  const [users, teams] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, isActive: true } }),
    prisma.team.findMany({ where: { id: { in: teamIds } }, include: { representative: { select: { id: true, role: true, isActive: true } } } }),
  ]);
  return resolveAssignmentSnapshots(userIds, teamIds, users, teams, taskDate, previous, getTodayDateOnly(), !form.has("assignmentSchemaVersion"));
}
