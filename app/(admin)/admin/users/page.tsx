import { UserDrawers } from "@/components/admin/user-drawers";
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates/format";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { TeamsPanel } from "@/components/admin/teams-panel";
import { getTodayDateOnly } from "@/lib/dates/today";
import { toDateInputValue } from "@/lib/dates/calendar";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireRole("ADMIN");

  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });
  const teams = await prisma.team.findMany({ include: { representative: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <UserDrawers
          users={users.map((user) => ({
            fullName: user.fullName,
            id: user.id,
            isActive: user.isActive,
            lastLatitude: user.lastLatitude ? String(user.lastLatitude) : null,
            lastLocationLabel: user.lastLocationAt
              ? `${formatDisplayDate(user.lastLocationAt)} ${formatDisplayTime(user.lastLocationAt)}`
              : null,
            lastLongitude: user.lastLongitude ? String(user.lastLongitude) : null,
            role: user.role,
            username: user.username,
          }))}
        />
        <TeamsPanel
          today={toDateInputValue(getTodayDateOnly())}
          personnel={users.filter((user) => user.role === "PERSONNEL").map((user) => ({ id: user.id, fullName: user.fullName, isActive: user.isActive }))}
          teams={teams.map((team) => ({ id: team.id, name: team.name, representativeUserId: team.representativeUserId, representativeName: team.representative.fullName, extraPersonnelCount: team.extraPersonnelCount, includeRepresentative: team.includeRepresentative, isActive: team.isActive, effectiveFrom: toDateInputValue(team.effectiveFrom) }))}
        />
      </div>
    </main>
  );
}
