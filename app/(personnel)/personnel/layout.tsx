import { logoutAction } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { OfflineSyncBoot } from "@/components/personnel/offline-sync-boot";
import { requireRole } from "@/lib/auth/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PersonnelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireRole("PERSONNEL");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Personel</p>
            <p className="font-semibold">{user.fullName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/personnel">Anasayfa</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/personnel/settings">Ayarlar</Link>
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Cikis
              </Button>
            </form>
          </div>
        </div>
      </header>
      {children}
      <OfflineSyncBoot />
    </div>
  );
}
