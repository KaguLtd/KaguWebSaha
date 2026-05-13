"use client";

import { BriefcaseBusiness, Building2, PencilLine } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createCustomerAction,
  createProjectAction,
  updateProjectAction,
} from "@/app/(admin)/admin/projects/new/actions";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";

export type ProjectDrawerCustomer = {
  id: string;
  name: string;
};

export type ProjectDrawerProject = {
  customerName: string;
  description: string;
  googleMapsUrl: string;
  id: string;
  location: string;
  name: string;
};

type DrawerMode = "customer" | "project" | "edit" | null;

type ProjectDrawersProps = {
  customers: ProjectDrawerCustomer[];
  projects: ProjectDrawerProject[];
};

export function ProjectDrawers({ customers, projects }: ProjectDrawersProps) {
  const [mode, setMode] = useState<DrawerMode>(null);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const router = useRouter();
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
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
      setMode(null);
      setMessage(successMessage);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <section className="rounded-lg border bg-white p-5 shadow-card">
        <div className="grid gap-3 sm:grid-cols-3">
          <Button className="h-16 justify-start px-5 text-base" onClick={() => setMode("customer")}>
            <Building2 className="h-5 w-5" aria-hidden="true" />
            Cari Ac
          </Button>
          <Button
            className="h-16 justify-start px-5 text-base"
            disabled={customers.length === 0}
            onClick={() => setMode("project")}
          >
            <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
            Proje Ac
          </Button>
          <Button
            className="h-16 justify-start px-5 text-base"
            disabled={projects.length === 0}
            onClick={() => setMode("edit")}
            variant="outline"
          >
            <PencilLine className="h-5 w-5" aria-hidden="true" />
            Proje Duzenle
          </Button>
        </div>
        {message ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-white shadow-card">
        <div className="border-b bg-muted/50 p-5">
          <h2 className="text-lg font-semibold text-navy">Projeler</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mevcut proje kayitlari hizli kontrol icin listelenir.
          </p>
        </div>
        <div className="divide-y">
          {projects.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Henuz proje yok.</p>
          ) : (
            projects.map((project) => (
              <div
                className="flex items-start justify-between gap-4 border-l-2 border-transparent p-4 transition hover:border-primary hover:bg-primary/5"
                key={project.id}
              >
                <div>
                  <p className="font-medium">{project.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {project.customerName}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setMode("edit");
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Duzenle
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <Drawer
        description="Cari kaydi proje acarken secilebilir hale gelir."
        isOpen={mode === "customer"}
        onClose={() => setMode(null)}
        title="Cari Ac"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(
              new FormData(event.currentTarget),
              createCustomerAction,
              "Cari kaydedildi.",
            );
          }}
        >
          <Field label="Firma / Sahis Ismi" name="name" required />
          <TextArea label="Firma / Sahis Bilgileri" name="info" rows={5} />
          <Button disabled={isPending} type="submit">
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </form>
      </Drawer>

      <Drawer
        description="Konum bilgisi tek alandan girilir; koordinat uygunsa arka planda saklanir."
        isOpen={mode === "project"}
        onClose={() => setMode(null)}
        title="Proje Ac"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(
              new FormData(event.currentTarget),
              createProjectAction,
              "Proje kaydedildi.",
            );
          }}
        >
          <CustomerSelect customers={customers} />
          <Field label="Proje Ismi" name="name" required />
          <TextArea label="Proje Aciklamasi" name="description" rows={5} />
          <Field label="Konum / Google Maps Linki" name="location" />
          <Field label="Google Maps Linki" name="googleMapsUrl" type="url" />
          <FileInput label="Dosyalar" />
          <Button disabled={isPending || customers.length === 0} type="submit">
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </form>
      </Drawer>

      <Drawer
        description="Statik proje bilgilerini guncelle veya yeni dosya ekle."
        isOpen={mode === "edit"}
        onClose={() => setMode(null)}
        title="Proje Duzenle"
      >
        <form
          className="flex flex-col gap-4"
          key={selectedProject?.id ?? "empty"}
          onSubmit={(event) => {
            event.preventDefault();
            submit(
              new FormData(event.currentTarget),
              updateProjectAction,
              "Proje bilgileri guncellendi.",
            );
          }}
        >
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="projectId">
              Proje sec
            </label>
            <select
              className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
              id="projectId"
              name="projectId"
              onChange={(event) => setSelectedProjectId(event.target.value)}
              required
              value={selectedProjectId}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} - {project.customerName}
                </option>
              ))}
            </select>
          </div>
          <Field defaultValue={selectedProject?.name} label="Proje Ismi" name="name" required />
          <TextArea
            defaultValue={selectedProject?.description}
            label="Proje Aciklamasi"
            name="description"
            rows={5}
          />
          <Field
            defaultValue={selectedProject?.location}
            label="Konum / Google Maps Linki"
            name="location"
          />
          <Field
            defaultValue={selectedProject?.googleMapsUrl}
            label="Google Maps Linki"
            name="googleMapsUrl"
            type="url"
          />
          <FileInput label="Yeni Dosyalar" />
          <Button disabled={isPending || !selectedProject} type="submit">
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </form>
      </Drawer>
    </>
  );
}

function CustomerSelect({ customers }: { customers: ProjectDrawerCustomer[] }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="customerId">
        Bagli Cari
      </label>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
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
  type?: "text" | "url";
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id={name}
        name={name}
        required={required}
        type={type}
      />
    </div>
  );
}

function FileInput({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="files">
        {label}
      </label>
      <input
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border file:border-primary/20 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
        id="files"
        multiple
        name="files"
        type="file"
      />
    </div>
  );
}

function TextArea({
  defaultValue,
  label,
  name,
  rows,
}: {
  defaultValue?: string;
  label: string;
  name: string;
  rows: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <textarea
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary"
        defaultValue={defaultValue}
        id={name}
        name={name}
        rows={rows}
      />
    </div>
  );
}
