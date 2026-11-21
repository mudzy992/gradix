import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Role } from '../../generated/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { auth, login } from './auth';

type Resources = {
  project: string;
  task: string;
  machine: string;
  material: string;
  depot: string;
  timer: string;
  trip: string;
  diary: string;
  incident: string;
  document: string;
  service: string;
  tender: string;
  partner: string;
  warehouse: string;
  cost: string;
};
type Side = {
  marker: string;
  companyId: string;
  users: Record<Role, string>;
  ids: Resources;
  headers: Record<Role, Record<string, string>>;
};
type Context = {
  companyId: string;
  users: Record<Role, string>;
  ids: Partial<Resources>;
  marker: string;
};

/** Ordered factory registry: every value is a real persisted ID, not a made-up path token. */
const factories: {
  [K in keyof Resources]: (
    p: PrismaService,
    c: Context,
  ) => Promise<{ id: string }>;
} = {
  project: (p, c) =>
    p.project.create({
      data: { companyId: c.companyId, name: c.marker, geofenceRadius: 50 },
    }),
  task: (p, c) =>
    p.task.create({
      data: {
        companyId: c.companyId,
        projectId: c.ids.project!,
        title: c.marker,
      },
    }),
  machine: (p, c) =>
    p.machine.create({
      data: { companyId: c.companyId, name: c.marker, type: 'TRUCK' },
    }),
  material: (p, c) =>
    p.material.create({
      data: { companyId: c.companyId, name: c.marker, unit: 'M3' },
    }),
  depot: (p, c) =>
    p.depot.create({
      data: { companyId: c.companyId, name: c.marker, qrToken: randomUUID() },
    }),
  timer: (p, c) =>
    p.timerSession.create({
      data: {
        companyId: c.companyId,
        userId: c.users.WORKER,
        taskId: c.ids.task!,
        startedAt: new Date('2026-01-01T08:00:00Z'),
        closedAt: new Date('2026-01-01T09:00:00Z'),
      },
    }),
  trip: (p, c) =>
    p.trip.create({
      data: {
        companyId: c.companyId,
        driverId: c.users.DRIVER,
        projectId: c.ids.project!,
        machineId: c.ids.machine!,
        materialId: c.ids.material!,
        quantity: '1.000',
        originText: c.marker,
      },
    }),
  diary: (p, c) =>
    p.diaryEntry.create({
      data: {
        companyId: c.companyId,
        projectId: c.ids.project!,
        date: new Date('2026-01-01T00:00:00Z'),
        workDescription: c.marker,
      },
    }),
  incident: (p, c) =>
    p.incident.create({
      data: {
        companyId: c.companyId,
        projectId: c.ids.project!,
        taskId: c.ids.task!,
        userId: c.users.WORKER,
        severity: 'LOW',
        description: c.marker,
      },
    }),
  document: (p, c) =>
    p.companyDocument.create({
      data: {
        companyId: c.companyId,
        type: c.marker,
        filePath: `${c.companyId}/fixture`,
      },
    }),
  service: (p, c) =>
    p.serviceRecord.create({
      data: {
        companyId: c.companyId,
        machineId: c.ids.machine!,
        note: c.marker,
      },
    }),
  tender: (p, c) =>
    p.tender.create({
      data: { companyId: c.companyId, title: c.marker, client: c.marker },
    }),
  partner: (p, c) =>
    p.partner.create({
      data: { companyId: c.companyId, type: 'CLIENT', name: c.marker },
    }),
  warehouse: (p, c) =>
    p.warehouse.create({
      data: { companyId: c.companyId, type: 'YARD', name: c.marker },
    }),
  cost: (p, c) =>
    p.costEntry.create({
      data: {
        companyId: c.companyId,
        amount: '1.00',
        category: 'OTHER',
        source: 'MANUAL',
        date: new Date('2026-01-01T00:00:00Z'),
        note: c.marker,
      },
    }),
};

export async function seedTenantFixtures(
  app: INestApplication,
  prisma: PrismaService,
) {
  const seed = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@gradix.local' },
  });
  const suffix = randomUUID();
  const companies: string[] = [];
  const userIds: string[] = [];
  async function cleanup() {
    const where = { companyId: { in: companies } };
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.timerSession.deleteMany({ where });
    await prisma.trip.deleteMany({ where });
    await prisma.incident.deleteMany({ where });
    await prisma.diaryEntry.deleteMany({ where });
    await prisma.companyDocument.deleteMany({ where });
    await prisma.serviceRecord.deleteMany({ where });
    await prisma.tender.deleteMany({ where });
    await prisma.costEntry.deleteMany({ where });
    await prisma.warehouse.deleteMany({ where });
    await prisma.partner.deleteMany({ where });
    await prisma.machineAssignment.deleteMany({ where });
    await prisma.machine.deleteMany({ where });
    await prisma.material.deleteMany({ where });
    await prisma.depot.deleteMany({ where });
    await prisma.taskAssignment.deleteMany({ where });
    await prisma.task.deleteMany({ where });
    await prisma.projectAssignment.deleteMany({ where });
    await prisma.project.deleteMany({ where });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
  }
  async function createSide(side: 'a' | 'b'): Promise<Side> {
    const marker = `tenant-${side}-${suffix}`;
    const company = await prisma.company.create({
      data: { name: marker, slug: marker },
    });
    companies.push(company.id);
    const users = {} as Record<Role, string>;
    const headers = {} as Record<Role, Record<string, string>>;
    for (const role of Object.values(Role)) {
      const email = `${side}-${role.toLowerCase()}-${suffix}@example.invalid`;
      const user = await prisma.user.create({
        data: {
          email,
          firstName: 'Tenant',
          lastName: side,
          companyId: role === Role.PLATFORM_ADMIN ? null : company.id,
          passwordHash: seed.passwordHash,
          mustChangePassword: false,
          roles: { create: { role } },
        },
      });
      userIds.push(user.id);
      users[role] = user.id;
      const logged = await login(app, email);
      if (
        logged.status !== 200 ||
        typeof logged.body.data?.accessToken !== 'string'
      )
        throw new Error(`Login ${side}/${role}: ${logged.status}`);
      headers[role] = {
        ...auth(logged.body.data.accessToken as string),
        ...(role === Role.PLATFORM_ADMIN ? { 'X-Company-Id': company.id } : {}),
      };
    }
    const context: Context = { companyId: company.id, users, ids: {}, marker };
    for (const [name, factory] of Object.entries(factories) as [
      keyof Resources,
      (p: PrismaService, c: Context) => Promise<{ id: string }>,
    ][])
      context.ids[name] = (await factory(prisma, context)).id;
    for (const role of Object.values(Role).filter(
      (r) => r !== Role.PLATFORM_ADMIN,
    )) {
      await prisma.projectAssignment.create({
        data: {
          companyId: company.id,
          projectId: context.ids.project!,
          userId: users[role],
          role: 'WORKER',
        },
      });
      await prisma.taskAssignment.create({
        data: {
          companyId: company.id,
          taskId: context.ids.task!,
          userId: users[role],
        },
      });
    }
    await prisma.machineAssignment.create({
      data: {
        companyId: company.id,
        projectId: context.ids.project!,
        machineId: context.ids.machine!,
      },
    });
    return {
      marker,
      companyId: company.id,
      users,
      ids: context.ids as Resources,
      headers,
    };
  }
  try {
    const a = await createSide('a');
    const b = await createSide('b');
    return { a, b, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
