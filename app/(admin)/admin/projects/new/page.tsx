import { ProjectDrawers } from "@/components/admin/project-drawers";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireRole("ADMIN");

  const [customers, projects] = await Promise.all([
    prisma.customer.findMany({
      include: {
        _count: {
          select: { projects: true },
        },
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.project.findMany({
      include: {
        customer: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  return (
    <main className="p-6 text-navy">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <section>
          <h1 className="text-3xl font-semibold text-navy">Cari ve Proje Islemleri</h1>
          <p className="mt-2 text-muted-foreground">
            Yeni kayit ac, proje bilgilerini guncelle veya dosya ekle.
          </p>
        </section>

        <ProjectDrawers
          customers={customers.map((customer) => ({
            id: customer.id,
            info: customer.info ?? "",
            name: customer.name,
            projectCount: customer._count.projects,
          }))}
          projects={projects.map((project) => ({
            city: project.city ?? "",
            contactName: project.contactName ?? "",
            contactPhone: project.contactPhone ?? "",
            customerName: project.customer.name,
            description: project.description ?? "",
            googleMapsUrl: project.googleMapsUrl ?? "",
            id: project.id,
            isActive: project.isActive,
            location: project.location ?? "",
            name: project.name,
          }))}
        />
      </div>
    </main>
  );
}
