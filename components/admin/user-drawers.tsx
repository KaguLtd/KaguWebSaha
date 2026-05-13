"use client";

import { PencilLine, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createUserAction, updateUserAction } from "@/app/(admin)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";

export type UserDrawerUser = {
  fullName: string;
  id: string;
  isActive: boolean;
  lastLatitude: string | null;
  lastLocationLabel: string | null;
  lastLongitude: string | null;
  role: "ADMIN" | "PERSONNEL";
  username: string;
};

type DrawerMode =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      userId: string;
    }
  | null;

export function UserDrawers({ users }: { users: UserDrawerUser[] }) {
  const [drawer, setDrawer] = useState<DrawerMode>(null);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const selectedUser = useMemo(
    () => (drawer?.mode === "edit" ? users.find((user) => user.id === drawer.userId) : null),
    [drawer, users],
  );

  async function submit(
    formData: FormData,
    action: (formData: FormData) => Promise<void>,
    successMessage: string,
  ) {
    setIsPending(true);
    setMessage("");

    try {
      await action(formData);
      setDrawer(null);
      setMessage(successMessage);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <section className="rounded-lg border border-primary/15 bg-white p-5 text-navy shadow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-navy">Kullanicilar</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Yeni hesap ac veya mevcut kullanicilari duzenle.
            </p>
          </div>
          <Button onClick={() => setDrawer({ mode: "create" })} type="button">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Kullanici Olustur
          </Button>
        </div>
        {message ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-navy/10 bg-white text-navy shadow-card">
        <div className="border-b border-primary/15 bg-primary/5 p-5">
          <h2 className="text-xl font-semibold text-navy">Mevcut Kullanicilar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Her satirdaki Duzenle butonu kullanici bilgilerini drawer icinde acar.
          </p>
        </div>

        <div className="divide-y">
          {users.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Henuz kullanici yok.
            </div>
          ) : (
            users.map((user) => (
              <div
                className="flex flex-col gap-4 border-l-2 border-transparent p-5 transition hover:border-primary hover:bg-primary/5 sm:flex-row sm:items-center sm:justify-between"
                key={user.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-navy">{user.fullName}</p>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        user.isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      {user.isActive ? "Aktif" : "Pasif"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {user.username} - {user.role === "ADMIN" ? "Yonetici" : "Personel"}
                  </p>
                  {user.role === "PERSONNEL" && user.lastLocationLabel ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Son konum: {user.lastLocationLabel}
                    </p>
                  ) : null}
                </div>
                <Button
                  onClick={() => setDrawer({ mode: "edit", userId: user.id })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PencilLine className="h-4 w-4" aria-hidden="true" />
                  Duzenle
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <Drawer
        description="Yeni yonetici veya personel hesabi olustur."
        isOpen={drawer?.mode === "create"}
        onClose={() => setDrawer(null)}
        title="Kullanici Olustur"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget), createUserAction, "Kullanici olusturuldu.");
          }}
        >
          <Field label="ID" name="username" required />
          <Field label="Password" name="password" required type="password" />
          <Field label="Personel Adi Soyadi" name="fullName" required />
          <RoleSelect />
          <Button disabled={isPending} type="submit">
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </form>
      </Drawer>

      <Drawer
        description="Kullanici bilgilerini, rolunu, aktiflik durumunu veya sifresini guncelle."
        isOpen={drawer?.mode === "edit" && Boolean(selectedUser)}
        onClose={() => setDrawer(null)}
        title="Kullanici Duzenle"
      >
        {selectedUser ? (
          <form
            className="flex flex-col gap-4"
            key={selectedUser.id}
            onSubmit={(event) => {
              event.preventDefault();
              submit(new FormData(event.currentTarget), updateUserAction, "Kullanici guncellendi.");
            }}
          >
            <input name="userId" type="hidden" value={selectedUser.id} />
            <Field defaultValue={selectedUser.username} label="ID" name="username" required />
            <Field
              defaultValue={selectedUser.fullName}
              label="Ad Soyad"
              name="fullName"
              required
            />
            <RoleSelect defaultValue={selectedUser.role} />
            <label className="flex items-center gap-3 rounded-md border border-navy/10 bg-white p-3 text-sm font-medium text-navy">
              <input
                className="h-4 w-4"
                defaultChecked={selectedUser.isActive}
                name="isActive"
                type="checkbox"
              />
              Aktif
            </label>
            <Field label="Yeni Sifre Belirle" name="newPassword" type="password" />

            {selectedUser.role === "PERSONNEL" ? (
              <div className="rounded-md border border-primary/15 bg-primary/5 p-3">
                <p className="text-sm font-medium text-navy">Son konum</p>
                {selectedUser.lastLatitude &&
                selectedUser.lastLongitude &&
                selectedUser.lastLocationLabel ? (
                  <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                    <p>{selectedUser.lastLocationLabel}</p>
                    <a
                      className="font-medium text-primary hover:underline"
                      href={`https://www.google.com/maps?q=${selectedUser.lastLatitude},${selectedUser.lastLongitude}`}
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

            <Button disabled={isPending} type="submit">
              {isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </form>
        ) : null}
      </Drawer>
    </>
  );
}

function RoleSelect({ defaultValue = "PERSONNEL" }: { defaultValue?: "ADMIN" | "PERSONNEL" }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-navy" htmlFor="role">
        Kullanici Tipi
      </label>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id="role"
        name="role"
      >
        <option value="PERSONNEL">Personel</option>
        <option value="ADMIN">Yonetici</option>
      </select>
    </div>
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
      <label className="text-sm font-medium text-navy" htmlFor={name}>
        {label}
      </label>
      <input
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id={name}
        name={name}
        required={required}
        type={type}
      />
    </div>
  );
}
