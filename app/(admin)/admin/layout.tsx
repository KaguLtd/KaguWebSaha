import { AdminShell } from "@/components/admin/admin-shell";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireRole("ADMIN");

  return (
    <AdminShell user={user}>{children}</AdminShell>
  );
}
