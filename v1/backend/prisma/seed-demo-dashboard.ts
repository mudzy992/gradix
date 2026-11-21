import { PrismaClient } from '../generated/client';

// Synthetic data only, called after the SEED_DEMO gate. Stable tenant-qualified IDs make
// repeat runs safe without deleting or rewriting the customer's existing records.
export async function seedDemoDashboard(
  prisma: PrismaClient,
  input: {
    companyId: string;
    actorId: string;
    passwordHash: string;
    now?: Date;
  },
) {
  const { companyId, actorId, passwordHash } = input;
  const now = input.now ?? new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000);
  const id = (kind: string, n: string | number) =>
    `demo-dashboard-${companyId}-${kind}-${n}`;
  const sites = [
    ['Rekonstrukcija mosta', 'Visoko', 43.9889, 18.1781],
    ['Stambeni blok Sjever', 'Sarajevo', 43.8563, 18.4131],
    ['Sanacija ceste', 'Zenica', 44.2034, 17.9077],
    ['Poslovna zona Jug', 'Ilidža', 43.8299, 18.3064],
    ['Vodovodna mreža', 'Kakanj', 44.1331, 18.1185],
    ['Industrijska hala', 'Vogošća', 43.9023, 18.3445],
  ] as const;
  const names = [
    'Adnan',
    'Amar',
    'Dino',
    'Edin',
    'Emir',
    'Haris',
    'Jasmin',
    'Kenan',
    'Lejla',
    'Mirza',
    'Nermin',
    'Selma',
  ];
  await prisma.project.createMany({
    data: sites.map(([name, locality, lat, lng], i) => ({
      id: id('project', i),
      companyId,
      code: `DASH-${i + 1}`,
      name: `Demo: ${name}`,
      locality,
      lat,
      lng,
      geofenceRadius: 250,
      status: i === 5 ? 'PLANNING' : 'IN_PROGRESS',
      plannedBudget: 180000 + i * 50000,
      currentSpend: 72000 + i * 26000,
      progressPercent: 34 + i * 8,
      plannedStart: day(-60 - i * 5),
      plannedEnd: day(60 + i * 20),
      createdAt: day(-70 - i * 5),
    })),
    skipDuplicates: true,
  });
  await prisma.user.createMany({
    data: names.map((firstName, i) => ({
      id: id('worker', i),
      companyId,
      email: `demo-dashboard-${companyId}-${i}@example.invalid`,
      firstName,
      lastName: 'Demo',
      passwordHash,
      hourlyRate: 16 + (i % 5),
      mustChangePassword: true,
    })),
    skipDuplicates: true,
  });
  await prisma.userRoleAssignment.createMany({
    data: names.map((_, i) => ({
      id: id('role', i),
      userId: id('worker', i),
      role: 'WORKER' as const,
    })),
    skipDuplicates: true,
  });
  await prisma.projectAssignment.createMany({
    data: names.map((_, i) => ({
      id: id('assignment', i),
      companyId,
      projectId: id('project', i % sites.length),
      userId: id('worker', i),
      role: 'WORKER' as const,
    })),
    skipDuplicates: true,
  });
  const types = [
    'EXCAVATOR',
    'LOADER',
    'ROLLER',
    'TRUCK',
    'GRADER',
    'PAVER',
  ] as const;
  await prisma.machine.createMany({
    data: types.map((type, i) => ({
      id: id('machine', i),
      companyId,
      name: `Demo: ${['Bager', 'Utovarivač', 'Valjak', 'Kamion', 'Grejder', 'Finišer'][i]}`,
      code: `DASH-M${i + 1}`,
      type,
      status: i === 5 ? ('IN_SERVICE' as const) : ('ACTIVE' as const),
      currentWorkingHours: 850 + i * 120,
    })),
    skipDuplicates: true,
  });
  await prisma.costEntry.createMany({
    data: sites.map((_, i) => ({
      id: id('cost', i),
      companyId,
      projectId: id('project', i),
      amount: 72000 + i * 26000,
      category: 'MATERIAL' as const,
      source: 'MANUAL' as const,
      date: day(-12),
      note: 'Sintetički demo trošak',
    })),
    skipDuplicates: true,
  });

  const tasks = [];
  const timers: Array<{
    id: string;
    companyId: string;
    userId: string;
    taskId: string;
    startedAt: Date;
    closedAt: Date | null;
    durationMinutes: number | null;
    hourlyRateSnapshot: number;
    createdAt: Date;
  }> = [];
  const diaries = [];
  for (let d = 29; d >= 0; d--) {
    const date = day(-d);
    const key = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const workers = weekday === 0 ? 0 : weekday === 6 ? 1 : 3;
    diaries.push({
      id: id('diary', key),
      companyId,
      projectId: id('project', 0),
      date,
      weather: d % 4 ? 'Oblačno' : 'Vedro',
      workersCount: workers ? workers + 3 : 0,
      workDescription: workers
        ? 'Radovi na pripremi i izvedbi prema planu.'
        : 'Neradni dan.',
      createdAt: date,
    });
    for (let i = 0; i < workers; i++) {
      const taskId = id('task', `${key}-${i}`);
      const userId = id('worker', (d + i) % names.length);
      const start = new Date(date.getTime() + (7 + i) * 3_600_000);
      const duration = weekday === 6 ? 240 : 420 + (d % 4) * 15;
      const closed = new Date(start.getTime() + duration * 60_000);
      // Do not manufacture work in the future on the current day.
      if (closed > now) continue;
      tasks.push({
        id: taskId,
        companyId,
        projectId: id('project', (d + i) % sites.length),
        title: `Demo: ${['Priprema terena', 'Montaža oplate', 'Kontrola izvedenih radova'][i]}`,
        status: 'COMPLETED' as const,
        plannedStart: start,
        plannedEnd: closed,
        totalTimeSpentMinutes: duration,
        createdAt: start,
      });
      timers.push({
        id: id('timer', `${key}-${i}`),
        companyId,
        userId,
        taskId,
        startedAt: start,
        closedAt: closed,
        durationMinutes: duration,
        hourlyRateSnapshot: 18,
        createdAt: start,
      });
    }
  }
  for (let i = 0; i < 3; i++)
    tasks.push({
      id: id('overdue', i),
      companyId,
      projectId: id('project', i),
      title: `Demo: ${['Dostaviti zapisnik', 'Provjeriti opremu', 'Završiti pripremu'][i]}`,
      status: 'PENDING' as const,
      plannedStart: day(-7),
      plannedEnd: day(-i - 1),
      totalTimeSpentMinutes: 0,
      createdAt: day(-8),
    });
  for (let i = 0; i < 4; i++) {
    const startedAt = new Date(now.getTime() - (i + 1) * 30 * 60_000);
    const taskId = id('active-task', i);
    tasks.push({
      id: taskId,
      companyId,
      projectId: id('project', i),
      title: `Demo: Radovi u toku ${i + 1}`,
      status: 'IN_PROGRESS' as const,
      plannedStart: startedAt,
      plannedEnd: new Date(now.getTime() + 3 * 3_600_000),
      totalTimeSpentMinutes: 0,
      createdAt: startedAt,
    });
    timers.push({
      id: id('active-timer', i),
      companyId,
      userId: id('worker', i),
      taskId,
      startedAt,
      closedAt: null,
      durationMinutes: null,
      hourlyRateSnapshot: 18,
      createdAt: startedAt,
    });
  }
  await prisma.task.createMany({ data: tasks, skipDuplicates: true });
  await prisma.timerSession.createMany({ data: timers, skipDuplicates: true });
  await prisma.diaryEntry.createMany({ data: diaries, skipDuplicates: true });
  // Weekdays have a full crew, Saturdays a smaller crew and Sundays no historical shift.
  const history = [];
  for (let d = 1; d < 30; d++) {
    const date = day(-d);
    const weekday = date.getUTCDay();
    const crew = weekday === 0 ? 0 : weekday === 6 ? 4 : names.length;
    for (let i = 0; i < crew; i++) {
      const [, , lat, lng] = sites[i % sites.length];
      history.push({
        id: id('location', `${date.toISOString().slice(0, 10)}-${i}`),
        companyId,
        userId: id('worker', i),
        lat,
        lng,
        accuracyM: 12,
        recordedAt: new Date(date.getTime() + 10 * 3_600_000),
      });
    }
  }
  await prisma.userLocation.createMany({ data: history, skipDuplicates: true });
  for (let i = 0; i < names.length; i++) {
    const [, , lat, lng] = sites[i % sites.length];
    const locationId = id('live-location', i);
    const recordedAt = new Date(now.getTime() - (i + 1) * 30_000);
    await prisma.userLocation.upsert({
      where: { id: locationId },
      create: {
        id: locationId,
        companyId,
        userId: id('worker', i),
        lat,
        lng,
        accuracyM: 12,
        recordedAt,
      },
      update: { recordedAt },
    });
  }
  await prisma.companyDocument.createMany({
    data: [3, 12].map((offset, i) => ({
      id: id('document', i),
      companyId,
      type: i ? 'Osiguranje' : 'Registracija',
      filePath: 'demo/no-file',
      expiresAt: day(offset),
      note: 'Sintetički demo dokument; datoteka nije učitana.',
    })),
    skipDuplicates: true,
  });
  await prisma.incident.createMany({
    data: [0, 1].map((i) => ({
      id: id('incident', i),
      companyId,
      projectId: id('project', i),
      userId: id('worker', i),
      severity: i ? ('MEDIUM' as const) : ('HIGH' as const),
      description: 'Demo: prijavljena opasnost na gradilištu',
      status: 'OPEN' as const,
      createdAt: day(-i - 1),
    })),
    skipDuplicates: true,
  });
  await prisma.serviceRecord.createMany({
    data: [0, 1].map((i) => ({
      id: id('service', i),
      companyId,
      machineId: id('machine', i),
      projectId: id('project', i),
      status: 'PLANNED' as const,
      scheduledAt: day(i ? 4 : -2),
      note: 'Demo: preventivni servis',
    })),
    skipDuplicates: true,
  });
  const recentCompleted = tasks
    .filter((task) => task.status === 'COMPLETED')
    .slice(-24);
  await prisma.auditEvent.createMany({
    data: recentCompleted.map((task) => ({
      id: id('activity', task.id.slice(-12)),
      companyId,
      actorId,
      action: 'TASK_COMPLETED' as const,
      entityType: 'Task',
      entityId: task.id,
      payload: { demo: true },
      createdAt: new Date(task.plannedEnd.getTime() + 5 * 60_000),
    })),
    skipDuplicates: true,
  });
}
