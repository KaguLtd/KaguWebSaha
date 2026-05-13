import { createUserAction, updateUserAction } from "./actions";

import { Button } from "@/components/ui/button";
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates/format";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });

  return (
    <main className="p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">Kullanici Olusturma</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Yeni yonetici veya personel hesabi olustur.
          </p>

          <form action={createUserAction} className="mt-6 flex flex-col gap-4">
            <Field label="ID" name="username" required />
            <Field label="Password" name="password" required type="password" />
            <Field label="Personel Adi Soyadi" name="fullName" required />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="role">
                Kullanici Tipi
              </label>
              <select
                className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                defaultValue="PERSONNEL"
                id="role"
                name="role"
              >
                <option value="PERSONNEL">Personel</option>
                <option value="ADMIN">Yonetici</option>
              </select>
            </div>

            <Button className="w-full" type="submit">
              Kullanici olustur
            </Button>
          </form>
        </section>

        <section className="rounded-lg border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="text-xl font-semibold">Mevcut Kullanicilar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kullanici adina tiklayarak bilgileri duzenle.
            </p>
          </div>

          <div className="divide-y">
            {users.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Henuz kullanici yok.
              </div>
            ) : (
              users.map((user) => (
                <details className="group p-5" key={user.id}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">{user.fullName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {user.username} · {user.role === "ADMIN" ? "Yonetici" : "Personel"}
                      </p>
                      {user.role === "PERSONNEL" && user.lastLocationAt ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Son konum: {formatDisplayDate(user.lastLocationAt)}{" "}
                          {formatDisplayTime(user.lastLocationAt)}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        user.isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {user.isActive ? "Aktif" : "Pasif"}
                    </span>
                  </summary>

                  <form
                    action={updateUserAction}
                    className="mt-5 grid gap-4 rounded-lg bg-muted p-4 md:grid-cols-2"
                  >
                    <input name="userId" type="hidden" value={user.id} />
                    <Field defaultValue={user.username} label="ID" name="username" required />
                    <Field
                      defaultValue={user.fullName}
                      label="Ad Soyad"
                      name="fullName"
                      required
                    />

                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium" htmlFor={`role-${user.id}`}>
                        Kullanici Tipi
                      </label>
                      <select
                        className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                        defaultValue={user.role}
                        id={`role-${user.id}`}
                        name="role"
                      >
                        <option value="PERSONNEL">Personel</option>
                        <option value="ADMIN">Yonetici</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-3 pt-7">
                      <input
                        className="h-4 w-4"
                        defaultChecked={user.isActive}
                        id={`active-${user.id}`}
                        name="isActive"
                        type="checkbox"
                      />
                      <label className="text-sm font-medium" htmlFor={`active-${user.id}`}>
                        Aktif
                      </label>
                    </div>

                    <div className="md:col-span-2">
                      <Field
                        label="Yeni Sifre Belirle"
                        name="newPassword"
                        type="password"
                      />
                    </div>

                    {user.role === "PERSONNEL" ? (
                      <div className="rounded-md border bg-white p-3 md:col-span-2">
                        <p className="text-sm font-medium">Son konum</p>
                        {user.lastLatitude && user.lastLongitude && user.lastLocationAt ? (
                          <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                            <p>
                              {formatDisplayDate(user.lastLocationAt)}{" "}
                              {formatDisplayTime(user.lastLocationAt)}
                            </p>
                            <a
                              className="font-medium text-primary hover:underline"
                              href={`https://www.google.com/maps?q=${user.lastLatitude},${user.lastLongitude}`}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Google Maps'te ac
                            </a>
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Henuz konum kaydi yok.
                          </p>
                        )}
                      </div>
                    ) : null}

                    <div className="md:col-span-2">
                      <Button type="submit">Kaydet</Button>
                    </div>
                  </form>
                </details>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  required?: boolean;
  type?: "text" | "password";
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id={name}
        name={name}
        required={required}
        type={type}
      />
    </div>
  );
}
