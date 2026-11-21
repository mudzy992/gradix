import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../generated/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { resolvePermissions } from '../src/common/rbac/role-permissions';
import { createTestApp } from './helpers/create-app';
import { seedTenantFixtures } from './helpers/tenant-fixtures';
import { collectRoutes } from './helpers/route-inventory';

const admins = [Role.PLATFORM_ADMIN, Role.SUPER_ADMIN, Role.ADMIN];
const projectReaders = Object.values(Role);
const taskReaders = [
  ...admins,
  Role.PROJECT_MANAGER,
  Role.SITE_SUPERVISOR,
  Role.MACHINE_OPERATOR,
  Role.WORKER,
];
const fleetReaders = [
  ...admins,
  Role.PROJECT_MANAGER,
  Role.SITE_SUPERVISOR,
  Role.MACHINE_OPERATOR,
  Role.MECHANIC,
];
const diaryReaders = [...admins, Role.PROJECT_MANAGER, Role.SITE_SUPERVISOR];
const erpReaders = [...admins, Role.ACCOUNTANT];
const cases = [
  { path: '/api/projects/:id', type: 'project', roles: projectReaders },
  { path: '/api/tasks/:id', type: 'task', roles: taskReaders },
  { path: '/api/machines/:id', type: 'machine', roles: fleetReaders },
  { path: '/api/diary/:id', type: 'diary', roles: diaryReaders },
  {
    path: '/api/tenders/:id',
    type: 'tender',
    roles: [...admins, Role.PROJECT_MANAGER],
  },
  { path: '/api/cost-entries/:id', type: 'cost', roles: erpReaders },
  { path: '/api/partners/:id', type: 'partner', roles: erpReaders },
  { path: '/api/warehouses/:id', type: 'warehouse', roles: erpReaders },
  {
    path: '/api/trips/:id',
    type: 'trip',
    roles: [
      ...admins,
      Role.ACCOUNTANT,
      Role.PROJECT_MANAGER,
      Role.SITE_SUPERVISOR,
      Role.DRIVER,
    ],
  },
] as const;

const deleteCases = [
  {
    path: '/api/projects/:id',
    type: 'project',
    roles: [...admins, Role.PROJECT_MANAGER],
    success: 204,
  },
  { path: '/api/machines/:id', type: 'machine', roles: admins, success: 200 },
  { path: '/api/cost-entries/:id', type: 'cost', roles: admins, success: 204 },
] as const;

const listCases = [
  {
    path: '/api/projects',
    type: 'project',
    roles: [
      ...admins,
      Role.ACCOUNTANT,
      Role.PROJECT_MANAGER,
      Role.SITE_SUPERVISOR,
    ],
  },
  { path: '/api/tasks', type: 'task', roles: taskReaders },
] as const;

describe('TEST-01 genuine resource isolation: inventory GET by ID', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('requires every registered route in the isolation coverage ledger', () => {
    const ledger = readFileSync(
      resolve(__dirname, '../../AUDIT/TEST-01-ROUTE-COVERAGE.csv'),
      'utf8',
    )
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));
    const keys = ledger.map(([method, path]) => `${method} ${path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(
      collectRoutes(app)
        .map((r) => `${r.method} ${r.path}`)
        .sort(),
    );
    expect(
      ledger.every(
        (row) =>
          row.length === 4 &&
          ['covered', 'partial', 'pending', 'exception'].includes(row[2]) &&
          row[3].trim().length > 0,
      ),
    ).toBe(true);
    expect(
      ledger
        .filter((row) => row[2] === 'exception')
        .map(([method, path]) => `${method} ${path}`)
        .sort(),
    ).toEqual(
      collectRoutes(app)
        .filter((route) => route.public)
        .map((route) => `${route.method} ${route.path}`)
        .sort(),
    );
    expect(
      ledger
        .filter((row) => row[2] === 'covered')
        .map(([method, path]) => `${method} ${path}`)
        .sort(),
    ).toEqual(
      [
        ...cases.map((item) => `GET ${item.path}`),
        ...deleteCases.map((item) => `DELETE ${item.path}`),
      ].sort(),
    );
    expect(
      ledger
        .filter((row) => row[2] === 'partial')
        .map(([method, path]) => `${method} ${path}`)
        .sort(),
    ).toEqual(listCases.map((item) => `GET ${item.path}`).sort());
  });

  it('keeps declared permission eligibility in sync with the explicit role cases', () => {
    const routes = collectRoutes(app);
    for (const entry of [
      ...cases.map((item) => ({ ...item, method: 'GET' })),
      ...listCases.map((item) => ({ ...item, method: 'GET' })),
      ...deleteCases.map((item) => ({ ...item, method: 'DELETE' })),
    ]) {
      const route = routes.find(
        (item) => item.path === entry.path && item.method === entry.method,
      );
      expect(route).toBeDefined();
      if (!route?.permissions.length) continue; // service-level rules are explicitly enumerated above
      const allowed = Object.values(Role).filter((role) =>
        route.permissions.every((permission) =>
          resolvePermissions([role]).some((granted) => granted === permission),
        ),
      );
      expect([...entry.roles].sort()).toEqual(allowed.sort());
    }
  });

  it('uses real resource IDs, explicit roles and positive controls in both companies', async () => {
    const inventory = collectRoutes(app);
    const fixture = await seedTenantFixtures(app, app.get(PrismaService));
    try {
      const http = request(app.getHttpServer());
      for (const item of cases) {
        expect(
          inventory.filter((r) => r.method === 'GET' && r.path === item.path),
        ).toHaveLength(1);
        for (const side of ['a', 'b'] as const) {
          const other = side === 'a' ? 'b' : 'a';
          for (const role of item.roles) {
            const headers = fixture[side].headers[role];
            const ownId = fixture[side].ids[item.type];
            const foreignId = fixture[other].ids[item.type];
            const own = await http
              .get(item.path.replace(':id', ownId))
              .set(headers);
            expect([
              item.path,
              side,
              role,
              own.status,
              own.body.data?.id,
            ]).toEqual([item.path, side, role, 200, ownId]);
            const foreign = await http
              .get(item.path.replace(':id', foreignId))
              .set(headers);
            expect([
              item.path,
              side,
              role,
              [403, 404].includes(foreign.status),
            ]).toEqual([item.path, side, role, true]);
            expect(JSON.stringify(foreign.body)).not.toContain(foreignId);
            expect(JSON.stringify(foreign.body)).not.toContain(
              fixture[other].marker,
            );
            expect(foreign.body.data).toBeUndefined();
          }
        }
      }
      const prisma = app.get(PrismaService);
      for (const item of deleteCases) {
        for (const side of ['a', 'b'] as const) {
          const other = side === 'a' ? 'b' : 'a';
          for (const role of item.roles) {
            const ownTenant = fixture[side];
            const foreignId = fixture[other].ids[item.type];
            const read = async (id: string) =>
              item.type === 'project'
                ? prisma.project.findUnique({ where: { id } })
                : item.type === 'machine'
                  ? prisma.machine.findUnique({ where: { id } })
                  : prisma.costEntry.findUnique({ where: { id } });
            const before = await read(foreignId);
            expect(before).not.toBeNull();
            const foreign = await http
              .delete(item.path.replace(':id', foreignId))
              .set(ownTenant.headers[role]);
            expect([
              item.path,
              side,
              role,
              [403, 404].includes(foreign.status),
            ]).toEqual([item.path, side, role, true]);
            expect(JSON.stringify(foreign.body)).not.toContain(
              fixture[other].marker,
            );
            expect(JSON.stringify(foreign.body)).not.toContain(foreignId);
            expect(foreign.body.data).toBeUndefined();
            expect(await read(foreignId)).toEqual(before);
            const own =
              item.type === 'project'
                ? await prisma.project.create({
                    data: {
                      companyId: ownTenant.companyId,
                      name: 'delete-control',
                      geofenceRadius: 50,
                    },
                  })
                : item.type === 'machine'
                  ? await prisma.machine.create({
                      data: {
                        companyId: ownTenant.companyId,
                        name: 'delete-control',
                        type: 'TRUCK',
                      },
                    })
                  : await prisma.costEntry.create({
                      data: {
                        companyId: ownTenant.companyId,
                        amount: '1.00',
                        category: 'OTHER',
                        source: 'MANUAL',
                        date: new Date('2026-01-01T00:00:00Z'),
                      },
                    });
            if (item.type === 'project' && role === Role.PROJECT_MANAGER)
              await prisma.projectAssignment.create({
                data: {
                  companyId: ownTenant.companyId,
                  projectId: own.id,
                  userId: ownTenant.users[role],
                  role: 'PM',
                },
              });
            const deleted = await http
              .delete(item.path.replace(':id', own.id))
              .set(ownTenant.headers[role]);
            expect([item.path, side, role, deleted.status]).toEqual([
              item.path,
              side,
              role,
              item.success,
            ]);
            if (item.type === 'project')
              expect(
                (
                  await prisma.project.findUniqueOrThrow({
                    where: { id: own.id },
                  })
                ).archivedAt,
              ).not.toBeNull();
            if (item.type === 'machine')
              expect(
                (
                  await prisma.machine.findUniqueOrThrow({
                    where: { id: own.id },
                  })
                ).status,
              ).toBe('DECOMMISSIONED');
            if (item.type === 'cost')
              expect(
                await prisma.costEntry.findUnique({ where: { id: own.id } }),
              ).toBeNull();
            if (item.type === 'project') {
              await prisma.projectAssignment.deleteMany({
                where: { projectId: own.id },
              });
              await prisma.project.delete({ where: { id: own.id } });
            }
            if (item.type === 'machine')
              await prisma.machine.delete({ where: { id: own.id } });
          }
        }
      }
      for (const item of listCases) {
        for (const side of ['a', 'b'] as const) {
          const other = side === 'a' ? 'b' : 'a';
          for (const role of item.roles) {
            const headers = fixture[side].headers[role];
            for (const order of ['asc', 'desc']) {
              const own = await http
                .get(item.path)
                .query({ page: 1, limit: 1, order })
                .set(headers);
              expect([
                item.path,
                side,
                role,
                own.status,
                own.body.data?.[0]?.id,
              ]).toEqual([
                item.path,
                side,
                role,
                200,
                fixture[side].ids[item.type],
              ]);
              expect(JSON.stringify(own.body)).not.toContain(
                fixture[other].ids[item.type],
              );
              expect(JSON.stringify(own.body)).not.toContain(
                fixture[other].marker,
              );
              const page2 = await http
                .get(item.path)
                .query({ page: 2, limit: 1, order })
                .set(headers);
              expect([page2.status, page2.body.data]).toEqual([200, []]);
            }
            const ownFilter =
              item.type === 'project'
                ? { q: fixture[side].marker, status: 'PLANNING' }
                : { projectId: fixture[side].ids.project, status: 'PENDING' };
            const filteredOwn = await http
              .get(item.path)
              .query(ownFilter)
              .set(headers);
            expect([
              filteredOwn.status,
              filteredOwn.body.data?.[0]?.id,
            ]).toEqual([200, fixture[side].ids[item.type]]);
            const filter =
              item.type === 'project'
                ? { q: fixture[other].marker, status: 'PLANNING' }
                : { projectId: fixture[other].ids.project, status: 'PENDING' };
            const foreignFilter = await http
              .get(item.path)
              .query(filter)
              .set(headers);
            expect([
              item.path,
              side,
              role,
              foreignFilter.status,
              foreignFilter.body.data,
            ]).toEqual([item.path, side, role, 200, []]);
          }
        }
      }
    } finally {
      await fixture.cleanup();
    }
  }, 120_000);
});
