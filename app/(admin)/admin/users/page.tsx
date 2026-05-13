import { UserDrawers } from "@/components/admin/user-drawers";
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });

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
      </div>
    </main>
  );
}
