import { logoutAction } from "@/app/(auth)/login/actions";
import { changePasswordAction } from "./actions";

import { LocationTestButton } from "@/components/personnel/location-fields";
import { Button } from "@/components/ui/button";

export default function PersonnelSettingsPage() {
  return (
    <main className="p-6">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <section>
          <h1 className="text-3xl font-semibold">Ayarlar</h1>
          <p className="mt-2 text-muted-foreground">
            Sifre ve konum izinlerini buradan kontrol et.
          </p>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Sifre degistir</h2>
          <form action={changePasswordAction} className="mt-4 flex flex-col gap-4">
            <Field label="Mevcut sifre" name="currentPassword" />
            <Field label="Yeni sifre" name="newPassword" />
            <Button type="submit">Sifreyi degistir</Button>
          </form>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Konum izni</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Konum sadece sahaya ulasma, sahadan ayrilma ve bu test sirasinda
            alinir. Surekli takip yapilmaz.
          </p>
          <div className="mt-4">
            <LocationTestButton />
          </div>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Offline kayitlar</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Internet yokken olusan saha kayitlari tarayicida bekler ve baglanti
            gelince otomatik olarak server'a gonderilir.
          </p>
        </section>

        <form action={logoutAction}>
          <Button className="w-full" type="submit" variant="outline">
            Cikis yap
          </Button>
        </form>
      </div>
    </main>
  );
}

function Field({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
        id={name}
        name={name}
        required
        type="password"
      />
    </div>
  );
}
