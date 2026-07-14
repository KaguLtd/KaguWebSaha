import { AdminShell } from "@/components/admin/admin-shell";
import { PendingHeicRefresh } from "@/components/files/pending-heic-refresh";
import { OfflineSyncBoot } from "@/components/personnel/offline-sync-boot";
import { requireAnyRole } from "@/lib/auth/session";
import { completeStaleOnSiteTasks } from "@/lib/tasks/rollover";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);
  await completeStaleOnSiteTasks();

  return (
    <AdminShell user={user}>
      {children}
      <OfflineSyncBoot kind="VISIT_UPLOAD" />
      <PendingHeicRefresh />
    </AdminShell>
  );
}
