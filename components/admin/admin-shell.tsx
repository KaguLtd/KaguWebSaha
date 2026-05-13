import Link from "next/link";
import {
  CalendarDays,
  FolderKanban,
  LayoutDashboard,
  PlusCircle,
  UsersRound,
} from "lucide-react";
import type { User } from "@prisma/client";

import { logoutAction } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";

const navItems = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/admin/projects",
    label: "Projeler",
    icon: FolderKanban,
  },
  {
    href: "/admin/projects/new",
    label: "Proje Olusturma",
    icon: PlusCircle,
  },
  {
    href: "/admin/schedule",
    label: "Gunluk Programlama",
    icon: CalendarDays,
  },
  {
    href: "/admin/users",
    label: "Kullanicilar",
    icon: UsersRound,
  },
];

export function AdminShell({
  children,
  user,
}: Readonly<{
  children: React.ReactNode;
  user: User;
}>) {
  return (
    <div className="min-h-screen bg-muted">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-white px-4 py-5 md:block">
        <Link className="block px-2" href="/admin">
          <span className="text-lg font-semibold">Kagu Saha</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Yonetici Paneli
          </span>
        </Link>

        <nav className="mt-8 flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                href={item.href}
                key={item.href}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="md:pl-64">
        <header className="border-b bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Yonetici</p>
              <p className="font-semibold">{user.fullName}</p>
            </div>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Cikis yap
              </Button>
            </form>
          </div>
          <nav className="flex gap-2 overflow-x-auto border-t px-6 py-3 md:hidden">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground"
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {children}
      </div>
    </div>
  );
}
