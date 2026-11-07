import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { createTestApp } from './helpers/create-app';
import { seedDemoDashboard } from '../prisma/seed-demo-dashboard';

describe('demo dashboard data (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  it('creates an isolated realistic, repeatable demo dataset', async () => {
    const seed = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    const otherCompanyId = seed.companyId!;
    const otherProjects = await prisma.project.count({
      where: { companyId: otherCompanyId },
    });
    const otherWorkers = await prisma.user.count({
      where: { companyId: otherCompanyId },
    });
    const company = await prisma.company.create({
      data: {
        name: 'Seed test',
        slug: `demo-rich-${randomUUID()}`,
        country: 'BA',
      },
    });
    const actor = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `rich-${randomUUID()}@example.invalid`,
        firstName: 'Demo',
        lastName: 'Admin',
        passwordHash: seed.passwordHash,
      },
    });
    const input = {
      companyId: company.id,
      actorId: actor.id,
      passwordHash: seed.passwordHash,
      now: new Date('2026-11-06T12:00:00Z'),
    };
    await seedDemoDashboard(prisma, input);
    const countRows = () =>
      Promise.all([
        prisma.project.count({ where: { companyId: company.id } }),
        prisma.user.count({ where: { companyId: company.id } }),
        prisma.machine.count({ where: { companyId: company.id } }),
        prisma.task.count({ where: { companyId: company.id } }),
        prisma.timerSession.count({ where: { companyId: company.id } }),
        prisma.diaryEntry.count({ where: { companyId: company.id } }),
        prisma.auditEvent.count({ where: { companyId: company.id } }),
        prisma.incident.count({ where: { companyId: company.id } }),
        prisma.serviceRecord.count({ where: { companyId: company.id } }),
        prisma.companyDocument.count({ where: { companyId: company.id } }),
        prisma.userLocation.count({ where: { companyId: company.id } }),
      ]);
    const first = await countRows();
    await seedDemoDashboard(prisma, input);
    const counts = await countRows();
    expect(counts).toEqual(first);
    expect(
      await prisma.project.count({ where: { companyId: otherCompanyId } }),
    ).toBe(otherProjects);
    expect(
      await prisma.user.count({ where: { companyId: otherCompanyId } }),
    ).toBe(otherWorkers);
    expect(counts.slice(0, 3)).toEqual([6, 13, 6]);
    expect(counts[3]).toBeGreaterThanOrEqual(30);
    expect(counts[4]).toBeGreaterThanOrEqual(30);
    expect(counts[5]).toBe(30);
    expect(counts[6]).toBeGreaterThanOrEqual(20);
    expect(counts.slice(7, 10)).toEqual([2, 2, 2]);
    expect(counts[10]).toBeGreaterThan(150);
    expect(
      await prisma.timerSession.count({
        where: { companyId: company.id, closedAt: null },
      }),
    ).toBe(4);
    const projects = await prisma.project.findMany({
      where: { companyId: company.id },
      include: { costEntries: true },
    });
    for (const project of projects)
      expect(project.currentSpend.toFixed(2)).toBe(
        project.costEntries[0].amount.toFixed(2),
      );
    const weekend = await prisma.diaryEntry.findMany({
      where: { companyId: company.id },
      select: { date: true, workersCount: true },
    });
    expect(
      weekend
        .filter((day) => day.date.getUTCDay() === 0)
        .every((day) => day.workersCount === 0),
    ).toBe(true);
  });
});
