import { AdminShell } from "@/components/admin/admin-shell";
import { PendingHeicRefresh } from "@/components/files/pending-heic-refresh";
import { requireAnyRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAnyRole(["ADMIN", "OBSERVER"]);

  return (
    <AdminShell user={user}>
      {children}
      <PendingHeicRefresh />
    </AdminShell>
  );
}
