import type { PrismaClient } from '../generated/client';

type Input = {
  companyId: string;
  projectId: string;
  workerId: string;
  operatorId: string;
};
const TITLES = [
  'Priprema terena',
  'Iskop i odvoz',
  'Kontrola podloge',
  'Ugradnja materijala',
  'Završna kontrola',
];

/** Demo-only deterministic data. No existing rows are overwritten on reseed. */
export function buildDemoTrend(input: Input, today: string) {
  const tasks: Array<{
    id: string;
    companyId: string;
    projectId: string;
    title: string;
    status: 'COMPLETED';
    createdAt: Date;
    totalTimeSpentMinutes: number;
  }> = [];
  const timers: Array<{
    id: string;
    companyId: string;
    taskId: string;
    userId: string;
    startedAt: Date;
    closedAt: Date;
    durationMinutes: number;
    approvalStatus: 'APPROVED';
  }> = [];
  for (let offset = 30; offset >= 1; offset--) {
    const day = new Date(`${today}T00:00:00.000Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    if (day.getUTCDay() === 0) continue; // No planned Sunday work.
    const iso = day.toISOString().slice(0, 10);
    const ordinal = Math.floor(day.getTime() / 86_400_000);
    const count = day.getUTCDay() === 6 ? 1 : 1 + (ordinal % 3 === 0 ? 1 : 0);
    const durationMinutes =
      day.getUTCDay() === 6 ? 300 : 420 + (ordinal % 4) * 30;
    const users =
      ordinal % 3 === 0 && day.getUTCDay() !== 6
        ? [input.workerId, input.operatorId]
        : [input.workerId];
    for (let n = 0; n < count; n++) {
      const taskId = `demo-trend-${input.projectId}-${iso}-${n}`;
      const createdAt = new Date(`${iso}T06:00:00.000Z`);
      tasks.push({
        id: taskId,
        companyId: input.companyId,
        projectId: input.projectId,
        title: `${TITLES[(ordinal + n) % TITLES.length]} (demo)`,
        status: 'COMPLETED',
        createdAt,
        totalTimeSpentMinutes: n === 0 ? users.length * durationMinutes : 0,
      });
      if (n !== 0) continue;
      for (const [index, userId] of users.entries()) {
        const closedAt = new Date(`${iso}T16:00:00.000Z`);
        const startedAt = new Date(
          closedAt.getTime() - durationMinutes * 60_000,
        );
        timers.push({
          id: `${taskId}-timer-${index}`,
          companyId: input.companyId,
          taskId,
          userId,
          startedAt,
          closedAt,
          durationMinutes,
          approvalStatus: 'APPROVED',
        });
      }
    }
  }
  return { tasks, timers };
}

export async function seedDemoTrends(prisma: PrismaClient, input: Input) {
  const setting = await prisma.setting.findUnique({
    where: {
      companyId_key: { companyId: input.companyId, key: 'app.timezone' },
    },
  });
  const timeZone =
    typeof setting?.value === 'string' && setting.value
      ? setting.value
      : 'Europe/Sarajevo';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const { tasks, timers } = buildDemoTrend(input, today);
  await prisma.task.createMany({ data: tasks, skipDuplicates: true });
  await prisma.timerSession.createMany({ data: timers, skipDuplicates: true });
}
