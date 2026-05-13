import { createCustomerAction, createProjectAction } from "./actions";

import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const customers = await prisma.customer.findMany({
    orderBy: {
      name: "asc",
    },
  });

  return (
    <main className="p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">Cari Hesap Olusturma</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Cari basit tutulur: firma/sahis adi ve kisa bilgi.
          </p>

          <form action={createCustomerAction} className="mt-6 flex flex-col gap-4">
            <Field label="Firma / Sahis Ismi" name="name" required />
            <TextArea label="Firma / Sahis Bilgileri" name="info" rows={5} />
            <Button type="submit">Cari olustur</Button>
          </form>
        </section>

        <section className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-semibold">Proje Olusturma</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Proje bir cariye baglanir. Aciklama ve dosyalar proje timeline'ina duser.
          </p>

          <form
            action={createProjectAction}
            className="mt-6 grid gap-4 md:grid-cols-2"
          >
            <div className="flex flex-col gap-2 md:col-span-2">
              <label className="text-sm font-medium" htmlFor="customerId">
                Bagli Cari Hesap
              </label>
              <select
                className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
                disabled={customers.length === 0}
                id="customerId"
                name="customerId"
                required
              >
                <option value="">Cari sec</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>

            <Field label="Proje Ismi" name="name" required />
            <Field label="Proje Konumu" name="location" />
            <TextArea
              className="md:col-span-2"
              label="Proje Aciklamasi"
              name="description"
              rows={5}
            />
            <Field
              className="md:col-span-2"
              label="Google Maps Linki"
              name="googleMapsUrl"
              type="url"
            />
            <Field label="Latitude" name="latitude" />
            <Field label="Longitude" name="longitude" />

            <div className="flex flex-col gap-2 md:col-span-2">
              <label className="text-sm font-medium" htmlFor="files">
                Dosyalar
              </label>
              <input
                className="w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                id="files"
                multiple
                name="files"
                type="file"
              />
              <p className="text-xs text-muted-foreground">
                Ilk surumde genis dosya tipi kabul edilir. Tek dosya limiti 25 MB.
              </p>
            </div>

            <div className="md:col-span-2">
              <Button disabled={customers.length === 0} type="submit">
                Proje olustur
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function Field({
  className,
  label,
  name,
  required,
  type = "text",
}: {
  className?: string;
  label: string;
  name: string;
  required?: boolean;
  type?: "text" | "url";
}) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
        id={name}
        name={name}
        required={required}
        type={type}
      />
    </div>
  );
}

function TextArea({
  className,
  label,
  name,
  rows,
}: {
  className?: string;
  label: string;
  name: string;
  rows: number;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <textarea
        className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
        id={name}
        name={name}
        rows={rows}
      />
    </div>
  );
}

