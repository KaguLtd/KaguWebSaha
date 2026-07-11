import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TAG = "TEST-YUK-20260711";
const PROJECT_COUNT = 150;
const START_DATE = new Date(Date.UTC(2026, 6, 13));

const customerNames = [
  "Anadolu Yapı Sistemleri",
  "Marmara Endüstri",
  "Ege Teknik Çözümler",
  "Başkent Tesis Yönetimi",
  "Akdeniz Proje Grubu",
  "Trakya Lojistik",
  "Karadeniz Enerji",
  "Toroslar İnşaat",
  "Bosphorus Gayrimenkul",
  "İç Anadolu Makine",
  "Güneydoğu Üretim",
  "Kuzey Yıldızı Teknoloji",
  "Pera İşletme Hizmetleri",
  "Rota Altyapı",
  "Ufuk Kurumsal Çözümler",
];

const projectKinds = [
  "Saha Keşfi",
  "Montaj Kontrolü",
  "Periyodik Bakım",
  "Devreye Alma",
  "Altyapı İncelemesi",
  "Enerji Analizi",
  "Güvenlik Denetimi",
  "Teknik Kabul",
  "Arıza Tespiti",
  "Ölçüm ve Raporlama",
];

const locations = [
  ["İstanbul", "Kadıköy, İstanbul", 40.9909, 29.0285],
  ["İstanbul", "Ümraniye, İstanbul", 41.0164, 29.1248],
  ["Ankara", "Çankaya, Ankara", 39.9179, 32.8627],
  ["İzmir", "Bornova, İzmir", 38.4622, 27.2165],
  ["Bursa", "Nilüfer, Bursa", 40.2137, 28.9846],
  ["Antalya", "Muratpaşa, Antalya", 36.8874, 30.7075],
  ["Kocaeli", "Gebze, Kocaeli", 40.8028, 29.4307],
  ["Tekirdağ", "Çorlu, Tekirdağ", 41.1592, 27.8022],
  ["Konya", "Selçuklu, Konya", 37.9463, 32.4917],
  ["Adana", "Seyhan, Adana", 36.9914, 35.3308],
  ["Gaziantep", "Şehitkamil, Gaziantep", 37.0747, 37.3766],
  ["Samsun", "Atakum, Samsun", 41.3329, 36.2732],
];

function businessDays(start, count) {
  const days = [];
  const cursor = new Date(start);

  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function dateLabel(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const [before, admins, personnel] = await Promise.all([
    Promise.all([
      prisma.customer.count(),
      prisma.project.count(),
      prisma.dailyTask.count(),
    ]),
    prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "PERSONNEL", isActive: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  if (!admins.length) throw new Error("Aktif ADMIN kullanıcısı bulunamadı.");

  const admin = admins[0];
  const scheduleDays = businessDays(START_DATE, 20);
  const existingCustomers = await prisma.customer.findMany({
    where: { info: { contains: TAG } },
  });
  const customers = [...existingCustomers];

  for (let index = customers.length; index < customerNames.length; index += 1) {
    customers.push(
      await prisma.customer.create({
        data: {
          name: `[TEST] ${customerNames[index]}`,
          info: `${TAG} yük testi için oluşturulmuş kurgusal müşteri.`,
        },
      }),
    );
  }

  const existingProjects = await prisma.project.findMany({
    where: { description: { contains: TAG } },
    select: { name: true },
  });
  const existingNames = new Set(existingProjects.map((project) => project.name));
  let createdProjects = 0;
  let createdTasks = 0;

  for (let index = 0; index < PROJECT_COUNT; index += 1) {
    const sequence = String(index + 1).padStart(3, "0");
    const kind = projectKinds[index % projectKinds.length];
    const name = `[TEST-${sequence}] ${kind}`;
    if (existingNames.has(name)) continue;

    const customer = customers[index % customers.length];
    const [city, location, latitude, longitude] = locations[index % locations.length];
    const taskDate = scheduleDays[index % scheduleDays.length];
    const assigneeIds = personnel.length
      ? [personnel[index % personnel.length].id]
      : [];
    if (personnel.length > 2 && index % 5 === 0) {
      const secondId = personnel[(index + 1) % personnel.length].id;
      if (!assigneeIds.includes(secondId)) assigneeIds.push(secondId);
    }

    await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          customerId: customer.id,
          name,
          description: `${TAG} — ${kind.toLowerCase()} için oluşturulmuş kurgusal yük testi projesi.`,
          contactName: `Test Yetkilisi ${sequence}`,
          contactPhone: `+90 555 9${sequence.slice(0, 2)} ${sequence.slice(-1)}${sequence.slice(0, 2)}`,
          city,
          location,
          latitude,
          longitude,
        },
      });

      await tx.projectNote.create({
        data: {
          projectId: project.id,
          userId: admin.id,
          note: `${TAG}: Otomatik üretilmiş test proje notu. Gerçek saha verisi değildir.`,
        },
      });

      await tx.projectTimelineEvent.create({
        data: {
          projectId: project.id,
          userId: admin.id,
          eventType: "PROJECT_CREATED",
          title: "Test projesi oluşturuldu",
          description: TAG,
        },
      });

      const task = await tx.dailyTask.create({
        data: {
          taskDate,
          projectId: project.id,
          title: project.name,
          managerNote: `${TAG}: Planlanan ${kind.toLowerCase()} çalışması.`,
          createdByUserId: admin.id,
          assignees: {
            create: assigneeIds.map((userId) => ({ userId })),
          },
        },
      });

      await tx.taskEvent.create({
        data: {
          dailyTaskId: task.id,
          projectId: project.id,
          userId: admin.id,
          type: "TASK_CREATED",
          note: `${TAG}: ${dateLabel(taskDate)} gününe programlandı.`,
        },
      });

      await tx.projectTimelineEvent.createMany({
        data: [
          {
            projectId: project.id,
            dailyTaskId: task.id,
            userId: admin.id,
            eventType: "TASK_CREATED",
            title: "Günlük görev oluşturuldu",
            description: `${dateLabel(taskDate)} · ${TAG}`,
          },
          ...assigneeIds.map((userId) => ({
            projectId: project.id,
            dailyTaskId: task.id,
            userId,
            eventType: "PERSON_ASSIGNED",
            title: "Personel atandı",
            description: dateLabel(taskDate),
          })),
        ],
      });
    });

    createdProjects += 1;
    createdTasks += 1;
  }

  const [after, taggedProjects, taggedTasks, distribution] = await Promise.all([
    Promise.all([
      prisma.customer.count(),
      prisma.project.count(),
      prisma.dailyTask.count(),
    ]),
    prisma.project.count({ where: { description: { contains: TAG } } }),
    prisma.dailyTask.count({
      where: { managerNote: { contains: TAG } },
    }),
    prisma.dailyTask.groupBy({
      by: ["taskDate"],
      where: { managerNote: { contains: TAG } },
      _count: { _all: true },
      orderBy: { taskDate: "asc" },
    }),
  ]);

  console.log(JSON.stringify({
    tag: TAG,
    admin: admin.fullName,
    activePersonnel: personnel.length,
    createdThisRun: { projects: createdProjects, tasks: createdTasks },
    taggedTotals: { projects: taggedProjects, tasks: taggedTasks },
    databaseTotals: {
      before: { customers: before[0], projects: before[1], tasks: before[2] },
      after: { customers: after[0], projects: after[1], tasks: after[2] },
    },
    distribution: distribution.map((row) => ({
      date: dateLabel(row.taskDate),
      tasks: row._count._all,
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
