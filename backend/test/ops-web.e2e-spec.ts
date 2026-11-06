import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { seedDemoTrends } from '../prisma/seed-demo-trends';

describe('Phase 5 dashboard diary HSE (e2e)', () => {
  let app: INestApplication<App>;
  let admin: string;
  let ss: string;
  let worker: string;
  let projectId: string;
  let date: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    ss = (await login(app, 'ss@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    const ssId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(ss))
    ).body.data.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `P5 ${Date.now()}`,
        code: `P5${Date.now().toString().slice(-6)}`,
      });
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: ssId, role: 'SS' });
    // BE-11 (opcija A): radnik mora biti na projektu da bi tamo mogao prijaviti incident.
    const workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: workerId, role: 'WORKER' });
    date = new Date().toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('WORKER cannot list projects; dashboard has no spend', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(worker));
    expect(list.status).toBe(403);
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set(auth(worker));
    expect(dash.status).toBe(200);
    const keys = (dash.body.data.cards as { key: string }[]).map(
      (card) => card.key,
    );
    expect(keys).not.toContain('spend');
    expect(keys).toContain('myTasks');
    expect(dash.body.data.presence).toBeNull();
  });

  it('ADMIN dashboard cards include spend and unread', async () => {
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set(auth(admin));
    expect(dash.status).toBe(200);
    const keys = (dash.body.data.cards as { key: string }[]).map(
      (card) => card.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'activeProjects',
        'spend',
        'openTimers',
        'unread',
      ]),
    );
  });

  it('dashboard projects are tenant-scoped, permission-checked and bounded', async () => {
    const foreign = await prisma.company.create({
      data: { name: 'Foreign dashboard company', slug: `dash-${Date.now()}` },
    });
    const hidden = await prisma.project.create({
      data: {
        companyId: foreign.id,
        name: 'A foreign project',
        geofenceRadius: 50,
      },
    });
    const own = await prisma.project.update({
      where: { id: projectId },
      data: { name: 'A scoped dashboard project', plannedBudget: '100.13' },
    });
    const extra = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        prisma.project.create({
          data: {
            companyId: own.companyId,
            name: `ZZ unassigned ${index}`,
            geofenceRadius: 50,
          },
        }),
      ),
    );
    try {
      const adminDash = await request(app.getHttpServer())
        .get('/api/dashboard/projects')
        .set(auth(admin));
      expect(adminDash.status).toBe(200);
      expect(adminDash.body.data.length).toBe(10);
      expect(adminDash.body.meta).toMatchObject({
        limit: 10,
        nextCursor: expect.any(String),
      });
      const firstPage = await request(app.getHttpServer())
        .get('/api/dashboard/projects?limit=2')
        .set(auth(admin));
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.data).toHaveLength(2);
      const secondPage = await request(app.getHttpServer())
        .get(
          `/api/dashboard/projects?limit=2&cursor=${firstPage.body.meta.nextCursor}`,
        )
        .set(auth(admin));
      expect(secondPage.status).toBe(200);
      const firstIds = firstPage.body.data.map((row: { id: string }) => row.id);
      expect(
        secondPage.body.data.every(
          (row: { id: string }) => !firstIds.includes(row.id),
        ),
      ).toBe(true);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/dashboard/projects?cursor=${hidden.id}`)
            .set(auth(admin))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/dashboard/projects?cursor=${extra[0].id}`)
            .set(auth(ss))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/dashboard/projects?limit=11')
            .set(auth(admin))
        ).status,
      ).toBe(400);

      expect(adminDash.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: projectId,
            plannedBudget: '100.13',
            currentSpend: '0.00',
          }),
        ]),
      );
      expect(
        adminDash.body.data.map((row: { id: string }) => row.id),
      ).not.toContain(hidden.id);
      const scoped = await request(app.getHttpServer())
        .get('/api/dashboard/projects')
        .set(auth(ss));
      expect(scoped.status).toBe(200);
      const scopedIds = scoped.body.data.map((row: { id: string }) => row.id);
      expect(scopedIds).toContain(projectId);
      expect(scopedIds).not.toContain(hidden.id);
      for (const project of extra) expect(scopedIds).not.toContain(project.id);
      const forbidden = await request(app.getHttpServer())
        .get('/api/dashboard/projects')
        .set(auth(worker));
      expect(forbidden.status).toBe(403);
    } finally {
      await prisma.project.deleteMany({
        where: { id: { in: [hidden.id, ...extra.map((row) => row.id)] } },
      });
      await prisma.company.delete({ where: { id: foreign.id } });
    }
  });

  it('activity events are admin-only, tenant-scoped, payload-free and cursor-paged', async () => {
    const admin = (await login(app, 'admin@gradix.local')).body.data
      .accessToken as string;
    const ss = (await login(app, 'ss@gradix.local')).body.data
      .accessToken as string;
    const worker = (await login(app, 'worker@gradix.local')).body.data
      .accessToken as string;
    const accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken as string;
    const platform = (await login(app, 'platform@gradix.local')).body.data
      .accessToken as string;
    const me = (
      await request(app.getHttpServer()).get('/api/me').set(auth(admin))
    ).body.data as { id: string; companyId: string };
    const other = await prisma.company.create({
      data: { name: 'Other activity', slug: `other-activity-${Date.now()}` },
    });
    const ids = Array.from(
      { length: 23 },
      (_, i) => `activity-test-${Date.now()}-${i}`,
    );
    try {
      await prisma.auditEvent.createMany({
        data: ids.map((id, i) => ({
          id,
          companyId: i === 22 ? other.id : me.companyId,
          actorId: me.id,
          action: 'PROJECT_CREATED',
          entityType: 'Project',
          entityId: id,
          payload: { privateProbe: 'must-not-be-returned' },
          createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)),
        })),
      });
      const url = '/api/activity/events';
      const first = await request(app.getHttpServer())
        .get(url)
        .set(auth(admin));
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(20);
      expect(
        first.body.data.map((row: { id: string }) => row.id),
      ).not.toContain(ids[22]);
      expect(JSON.stringify(first.body)).not.toContain('privateProbe');
      expect(first.body.data[0].createdAt).toMatch(/Z$/);
      const next = await request(app.getHttpServer())
        .get(`${url}?cursor=${first.body.meta.nextCursor}`)
        .set(auth(admin));
      expect(next.status).toBe(200);
      expect(next.body.data.map((row: { id: string }) => row.id)).toContain(
        ids[0],
      );
      expect(
        (
          await request(app.getHttpServer())
            .get(`${url}?cursor=${ids[22]}`)
            .set(auth(admin))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get(`${url}?limit=21`)
            .set(auth(admin))
        ).status,
      ).toBe(400);
      for (const token of [ss, worker, accountant])
        expect(
          (await request(app.getHttpServer()).get(url).set(auth(token))).status,
        ).toBe(403);
      expect(
        (await request(app.getHttpServer()).get(url).set(auth(platform)))
          .status,
      ).toBe(403);
      const scoped = await request(app.getHttpServer())
        .get(url)
        .set(auth(platform))
        .set('X-Company-Id', other.id);
      expect(scoped.status).toBe(200);
      expect(scoped.body.data.map((row: { id: string }) => row.id)).toEqual([
        ids[22],
      ]);
      const openapi = await request(app.getHttpServer()).get('/api/docs-json');
      expect(openapi.body.paths['/api/activity/events'].get.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'cursor' }),
        ]),
      );
    } finally {
      await prisma.auditEvent.deleteMany({ where: { id: { in: ids } } });
      await prisma.company.delete({ where: { id: other.id } });
    }
  });

  it('task deadline alerts are tenant scoped, severity ordered and cursor paged', async () => {
    const platform = (await login(app, 'platform@gradix.local')).body.data
      .accessToken as string;
    const accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken as string;
    const a = await prisma.company.create({
      data: { name: 'Task alerts A', slug: `task-alert-a-${Date.now()}` },
    });
    const b = await prisma.company.create({
      data: { name: 'Task alerts B', slug: `task-alert-b-${Date.now()}` },
    });
    const p = await prisma.project.create({
      data: { companyId: a.id, name: 'A', geofenceRadius: 100 },
    });
    const foreignProject = await prisma.project.create({
      data: { companyId: b.id, name: 'B', geofenceRadius: 100 },
    });
    const archived = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'Archived',
        geofenceRadius: 100,
        archivedAt: new Date(),
      },
    });
    const stamp = Date.now();
    const ids = Array.from({ length: 8 }, (_, i) => `task-alert-${stamp}-${i}`);
    const date = (days: number) => new Date(stamp + days * 86_400_000);
    try {
      await prisma.task.createMany({
        data: [
          {
            id: ids[0],
            companyId: a.id,
            projectId: p.id,
            title: 'Overdue',
            plannedEnd: date(-1),
          },
          {
            id: ids[1],
            companyId: a.id,
            projectId: p.id,
            title: 'Soon',
            plannedEnd: date(2),
          },
          {
            id: ids[2],
            companyId: a.id,
            projectId: p.id,
            title: 'Later',
            plannedEnd: date(10),
          },
          {
            id: ids[3],
            companyId: a.id,
            projectId: p.id,
            title: 'Future',
            plannedEnd: date(20),
          },
          {
            id: ids[4],
            companyId: a.id,
            projectId: p.id,
            title: 'Far future',
            plannedEnd: date(31),
          },
          {
            id: ids[5],
            companyId: a.id,
            projectId: p.id,
            title: 'Completed',
            status: 'COMPLETED',
            plannedEnd: date(-5),
          },
          {
            id: ids[6],
            companyId: a.id,
            projectId: archived.id,
            title: 'Archived',
            plannedEnd: date(-4),
          },
          {
            id: ids[7],
            companyId: b.id,
            projectId: foreignProject.id,
            title: 'Foreign',
            plannedEnd: date(-3),
          },
        ],
      });
      const url = '/api/alerts/tasks';
      const headers = { ...auth(platform), 'X-Company-Id': a.id };
      const first = await request(app.getHttpServer())
        .get(`${url}?limit=2`)
        .set(headers);
      expect(first.status).toBe(200);
      expect(first.body.data.map((r: { id: string }) => r.id)).toEqual(
        ids.slice(0, 2),
      );
      expect(
        first.body.data.map((r: { severity: string }) => r.severity),
      ).toEqual(['CRITICAL', 'HIGH']);
      const next = await request(app.getHttpServer())
        .get(`${url}?limit=2&cursor=${first.body.meta.nextCursor}`)
        .set(headers);
      expect(next.status).toBe(200);
      expect(next.body.data.map((r: { id: string }) => r.id)).toEqual(
        ids.slice(2, 4),
      );
      expect(
        next.body.data.map((r: { severity: string }) => r.severity),
      ).toEqual(['MEDIUM', 'LOW']);
      expect(next.body.meta.nextCursor).toBeNull();
      expect(next.body.data[0].plannedEnd).toMatch(/Z$/);
      expect(
        (
          await request(app.getHttpServer())
            .get(`${url}?cursor=${ids[7]}`)
            .set(headers)
        ).status,
      ).toBe(400);
      expect(
        (await request(app.getHttpServer()).get(`${url}?limit=21`).set(headers))
          .status,
      ).toBe(400);
      for (const token of [ss, worker, accountant, platform])
        expect(
          (await request(app.getHttpServer()).get(url).set(auth(token))).status,
        ).toBe(403);
      const other = await request(app.getHttpServer())
        .get(url)
        .set(auth(platform))
        .set('X-Company-Id', b.id);
      expect(other.status).toBe(200);
      expect(other.body.data.map((r: { id: string }) => r.id)).toEqual([
        ids[7],
      ]);
      const api = await request(app.getHttpServer()).get('/api/docs-json');
      expect(api.body.paths['/api/alerts/tasks'].get.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'cursor' }),
        ]),
      );
    } finally {
      await prisma.task.deleteMany({ where: { id: { in: ids } } });
      await prisma.project.deleteMany({
        where: { id: { in: [p.id, foreignProject.id, archived.id] } },
      });
      await prisma.company.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });

  it('analytics summary is an exact tenant-admin scalar aggregate with budget coverage', async () => {
    const platform = (await login(app, 'platform@gradix.local')).body.data
      .accessToken as string;
    const accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken as string;
    const a = await prisma.company.create({
      data: { name: 'Summary A', slug: `summary-a-${Date.now()}` },
    });
    const b = await prisma.company.create({
      data: { name: 'Summary B', slug: `summary-b-${Date.now()}` },
    });
    const p1 = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'Budgeted',
        geofenceRadius: 100,
        plannedBudget: '100.10',
        currentSpend: '12.34',
      },
    });
    const p2 = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'No budget',
        geofenceRadius: 100,
        currentSpend: '1.02',
      },
    });
    const held = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'On hold',
        status: 'ON_HOLD',
        geofenceRadius: 100,
        plannedBudget: '999.99',
      },
    });
    const archived = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'Archived',
        archivedAt: new Date(),
        geofenceRadius: 100,
        plannedBudget: '999.99',
      },
    });
    const other = await prisma.project.create({
      data: {
        companyId: b.id,
        name: 'Foreign',
        geofenceRadius: 100,
        plannedBudget: '987.65',
      },
    });
    const person = await prisma.user.create({
      data: {
        companyId: a.id,
        firstName: 'Summary',
        lastName: 'User',
        email: `summary-user-${Date.now()}@example.test`,
        passwordHash: 'fixture-not-used',
      },
    });
    const person2 = await prisma.user.create({
      data: {
        companyId: a.id,
        firstName: 'Summary',
        lastName: 'Other',
        email: `summary-other-${Date.now()}@example.test`,
        passwordHash: 'fixture-not-used',
      },
    });
    const task = await prisma.task.create({
      data: { companyId: a.id, projectId: p1.id, title: 'Open' },
    });
    const done = await prisma.task.create({
      data: {
        companyId: a.id,
        projectId: p1.id,
        title: 'Done',
        status: 'COMPLETED',
      },
    });
    const heldTask = await prisma.task.create({
      data: { companyId: a.id, projectId: held.id, title: 'On hold' },
    });
    try {
      await prisma.timerSession.createMany({
        data: [
          {
            companyId: a.id,
            userId: person.id,
            taskId: task.id,
            startedAt: new Date(),
          },
          {
            companyId: a.id,
            userId: person2.id,
            taskId: heldTask.id,
            startedAt: new Date(),
          },
        ],
      });
      const url = '/api/analytics/summary';
      const first = await request(app.getHttpServer())
        .get(url)
        .set(auth(platform))
        .set('X-Company-Id', a.id);
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({
        activeProjects: 2,
        openTasks: 1,
        openTimers: 1,
        projectsWithBudget: 1,
        knownPlannedBudget: '100.10',
        currentSpend: '13.36',
      });
      const second = await request(app.getHttpServer())
        .get(url)
        .set(auth(platform))
        .set('X-Company-Id', b.id);
      expect(second.status).toBe(200);
      expect(second.body.data).toEqual({
        activeProjects: 1,
        openTasks: 0,
        openTimers: 0,
        projectsWithBudget: 1,
        knownPlannedBudget: '987.65',
        currentSpend: '0.00',
      });
      for (const token of [ss, worker, accountant, platform])
        expect(
          (await request(app.getHttpServer()).get(url).set(auth(token))).status,
        ).toBe(403);
      const api = await request(app.getHttpServer()).get('/api/docs-json');
      expect(api.body.paths['/api/analytics/summary'].get).toBeDefined();
    } finally {
      await prisma.timerSession.deleteMany({
        where: { taskId: { in: [task.id, done.id, heldTask.id] } },
      });
      await prisma.task.deleteMany({
        where: { id: { in: [task.id, done.id, heldTask.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [person.id, person2.id] } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: [p1.id, p2.id, held.id, archived.id, other.id] } },
      });
      await prisma.company.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });

  it('live presence is paged, tenant-scoped, recent, geofenced and excludes coordinates', async () => {
    const platform = (await login(app, 'platform@gradix.local')).body.data
      .accessToken as string;
    const accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken as string;
    const a = await prisma.company.create({
      data: { name: 'Presence A', slug: `presence-a-${Date.now()}` },
    });
    const b = await prisma.company.create({
      data: { name: 'Presence B', slug: `presence-b-${Date.now()}` },
    });
    const projectA = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'Site A',
        lat: '43.85',
        lng: '18.41',
        geofenceRadius: 100,
      },
    });
    const projectB = await prisma.project.create({
      data: {
        companyId: b.id,
        name: 'Site B',
        lat: '43.85',
        lng: '18.41',
        geofenceRadius: 100,
      },
    });
    const archived = await prisma.project.create({
      data: {
        companyId: a.id,
        name: 'Archived site',
        lat: '44.5',
        lng: '18.41',
        geofenceRadius: 100,
        archivedAt: new Date(),
      },
    });
    const stamp = Date.now();
    const ids = Array.from({ length: 9 }, (_, i) => `presence-${stamp}-${i}`);
    try {
      await prisma.user.createMany({
        data: ids.map((id, i) => ({
          id,
          companyId: i === 6 ? b.id : a.id,
          firstName: 'Fixture',
          lastName: `${i}`,
          email: `${id}@example.test`,
          passwordHash: 'fixture-not-used',
          isActive: i !== 8,
        })),
      });
      const now = Date.now();
      const loc = (
        userId: string,
        companyId: string,
        lat: string,
        millisecondsAgo: number,
      ) => ({
        userId,
        companyId,
        lat,
        lng: '18.41',
        recordedAt: new Date(now - millisecondsAgo),
      });
      await prisma.userLocation.createMany({
        data: [
          ...ids.slice(0, 3).map((id) => loc(id, a.id, '43.8508', 60_000)),
          loc(ids[3], a.id, '43.85', 120_000),
          loc(ids[3], a.id, '43.851', 60_000),
          loc(ids[4], a.id, '43.85', 3_600_000),
          loc(ids[5], a.id, '43.85', -3_600_000),
          loc(ids[6], b.id, '43.85', 60_000),
          loc(ids[7], a.id, '44.5', 60_000),
          loc(ids[8], a.id, '43.85', 60_000),
        ],
      });
      const url = '/api/presence/people';
      const headers = { ...auth(platform), 'X-Company-Id': a.id };
      const first = await request(app.getHttpServer())
        .get(`${url}?limit=2`)
        .set(headers);
      expect(first.status).toBe(200);
      expect(first.body.data.map((r: { userId: string }) => r.userId)).toEqual(
        ids.slice(0, 2),
      );
      expect(first.body.data[0]).toMatchObject({
        projectId: projectA.id,
        lastSeenAt: expect.stringMatching(/Z$/),
      });
      expect(first.body.data[0]).not.toHaveProperty('lat');
      expect(first.body.data[0]).not.toHaveProperty('lng');
      const second = await request(app.getHttpServer())
        .get(`${url}?limit=2&cursor=${first.body.meta.nextCursor}`)
        .set(headers);
      expect(second.status).toBe(200);
      expect(second.body.data.map((r: { userId: string }) => r.userId)).toEqual(
        [ids[2]],
      );
      expect(second.body.meta.nextCursor).toBeNull();
      const foreign = await request(app.getHttpServer())
        .get(url)
        .set(auth(platform))
        .set('X-Company-Id', b.id);
      expect(foreign.status).toBe(200);
      expect(foreign.body.data).toMatchObject([
        { userId: ids[6], projectId: projectB.id },
      ]);
      expect(
        (await request(app.getHttpServer()).get(`${url}?limit=21`).set(headers))
          .status,
      ).toBe(400);
      for (const token of [ss, worker, accountant, platform])
        expect(
          (await request(app.getHttpServer()).get(url).set(auth(token))).status,
        ).toBe(403);
      const api = await request(app.getHttpServer()).get('/api/docs-json');
      expect(api.body.paths['/api/presence/people'].get.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'cursor' }),
        ]),
      );
    } finally {
      await prisma.userLocation.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.project.deleteMany({
        where: { id: { in: [projectA.id, projectB.id, archived.id] } },
      });
      await prisma.company.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });

  it('demo trends seed is idempotent and produces a varied 30-day API series', async () => {
    const project = await prisma.project.findFirstOrThrow({
      where: { code: 'DEMO-1' },
    });
    const demoWorker = await prisma.user.findUniqueOrThrow({
      where: { email: 'worker@gradix.local' },
    });
    const operator = await prisma.user.findUniqueOrThrow({
      where: { email: 'op@gradix.local' },
    });
    const input = {
      companyId: project.companyId,
      projectId: project.id,
      workerId: demoWorker.id,
      operatorId: operator.id,
    };
    await seedDemoTrends(prisma, input);
    const where = {
      companyId: project.companyId,
      id: { startsWith: `demo-trend-${project.id}-` },
    };
    const beforeTasks = await prisma.task.count({ where });
    const beforeTimers = await prisma.timerSession.count({ where });
    await seedDemoTrends(prisma, input);
    expect(await prisma.task.count({ where })).toBe(beforeTasks);
    expect(await prisma.timerSession.count({ where })).toBe(beforeTimers);
    expect(beforeTasks).toBeGreaterThan(20);
    expect(beforeTimers).toBeGreaterThan(20);
    const result = await request(app.getHttpServer())
      .get('/api/analytics/tasks/created?limit=30')
      .set(auth(admin));
    expect(result.status).toBe(200);
    expect(result.body.data.series).toHaveLength(30);
    expect(
      new Set(result.body.data.series.map((r: { count: number }) => r.count))
        .size,
    ).toBeGreaterThan(1);
    const timers = await request(app.getHttpServer())
      .get('/api/analytics/timers/closed?limit=30')
      .set(auth(admin));
    expect(timers.status).toBe(200);
    expect(BigInt(timers.body.data.currentMinutes)).toBeGreaterThan(0n);
  });

  it('document alerts are severity ordered, scoped, bounded and exclude file details', async () => {
    const platform = (await login(app, 'platform@gradix.local')).body.data
      .accessToken as string;
    const accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken as string;
    const a = await prisma.company.create({
      data: { name: 'Alerts A', slug: `alerts-a-${Date.now()}` },
    });
    const b = await prisma.company.create({
      data: { name: 'Alerts B', slug: `alerts-b-${Date.now()}` },
    });
    const alertUser = await prisma.user.create({
      data: {
        companyId: a.id,
        firstName: 'Alert',
        lastName: 'Worker',
        email: `alert-worker-${Date.now()}@example.test`,
        passwordHash: 'fixture-not-used',
      },
    });
    const machine = await prisma.machine.create({
      data: { companyId: a.id, name: 'Alert machine', type: 'OTHER' },
    });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Sarajevo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const day = (offset: number) => {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d;
    };
    const ids = Array.from(
      { length: 7 },
      (_, i) => `document-alert-${Date.now()}-${i}`,
    );
    try {
      await prisma.companyDocument.createMany({
        data: [-3, 1, 10, 20, -91, 31, -10].map((offset, i) => ({
          id: ids[i],
          companyId: i === 6 ? b.id : a.id,
          type: 'Test licence',
          filePath: 'private-file-path',
          note: 'private-document-note',
          expiresAt: day(offset),
        })),
      });
      const workerDoc = await prisma.workerDocument.create({
        data: {
          companyId: a.id,
          userId: alertUser.id,
          type: 'Worker permit',
          filePath: 'private-worker-path',
          expiresAt: day(1),
        },
      });
      const machineDoc = await prisma.machineDocument.create({
        data: {
          companyId: a.id,
          machineId: machine.id,
          type: 'Machine permit',
          filePath: 'private-machine-path',
          expiresAt: day(1),
        },
      });
      const url = '/api/alerts/documents';
      const headers = { ...auth(platform), 'X-Company-Id': a.id };
      const first = await request(app.getHttpServer())
        .get(`${url}?limit=2`)
        .set(headers);
      expect(first.status).toBe(200);
      expect(first.body.data.map((r: { id: string }) => r.id)).toEqual(
        ids.slice(0, 2),
      );
      expect(
        first.body.data.map((r: { severity: string }) => r.severity),
      ).toEqual(['CRITICAL', 'HIGH']);
      expect(JSON.stringify(first.body)).not.toContain('private-');
      const next = await request(app.getHttpServer())
        .get(`${url}?limit=2&cursor=${first.body.meta.nextCursor}`)
        .set(headers);
      expect(next.status).toBe(200);
      expect(next.body.data.map((r: { id: string }) => r.id)).toEqual([
        machineDoc.id,
        workerDoc.id,
      ]);
      expect(
        next.body.data.map((r: { severity: string }) => r.severity),
      ).toEqual(['HIGH', 'HIGH']);
      const last = await request(app.getHttpServer())
        .get(`${url}?limit=2&cursor=${next.body.meta.nextCursor}`)
        .set(headers);
      expect(last.body.data.map((r: { id: string }) => r.id)).toEqual(
        ids.slice(2, 4),
      );
      expect(
        last.body.data.map((r: { severity: string }) => r.severity),
      ).toEqual(['MEDIUM', 'LOW']);
      expect(last.body.meta.nextCursor).toBeNull();
      expect(next.body.data[0].expiresAt).toMatch(/Z$/);
      expect(
        (await request(app.getHttpServer()).get(`${url}?limit=21`).set(headers))
          .status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get(`${url}?cursor=bad`)
            .set(headers)
        ).status,
      ).toBe(400);
      expect(
        (await request(app.getHttpServer()).get(url).set(auth(ss))).status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer()).get(url).set(auth(worker))).status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer()).get(url).set(auth(accountant)))
          .status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer()).get(url).set(auth(platform)))
          .status,
      ).toBe(403);
      const secondTenant = await request(app.getHttpServer())
        .get(url)
        .set(auth(platform))
        .set('X-Company-Id', b.id);
      expect(secondTenant.status).toBe(200);
      expect(secondTenant.body.data.map((r: { id: string }) => r.id)).toEqual([
        ids[6],
      ]);
      const own = await request(app.getHttpServer()).get(url).set(auth(admin));
      expect(own.status).toBe(200);
      expect(own.body.data.map((r: { id: string }) => r.id)).not.toContain(
        ids[0],
      );
      const api = await request(app.getHttpServer()).get('/api/docs-json');
      expect(api.body.paths['/api/alerts/documents'].get.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'cursor' }),
        ]),
      );
    } finally {
      await prisma.workerDocument.deleteMany({ where: { companyId: a.id } });
      await prisma.machineDocument.deleteMany({ where: { companyId: a.id } });
      await prisma.user.delete({ where: { id: alertUser.id } });
      await prisma.machine.delete({ where: { id: machine.id } });
      await prisma.companyDocument.deleteMany({ where: { id: { in: ids } } });
      await prisma.company.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });

  it('closed timer metrics use approved durations, tenant scope and bounded local-day periods', async () => {
    const me = (
      await request(app.getHttpServer()).get('/api/me').set(auth(admin))
    ).body.data as { id: string; companyId: string };
    const other = await prisma.company.create({
      data: {
        name: 'Timer metrics other',
        slug: `timer-metrics-${Date.now()}`,
      },
    });
    const ownProject = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const foreignProject = await prisma.project.create({
      data: { companyId: other.id, name: 'Timer foreign', geofenceRadius: 100 },
    });
    const ownTask = await prisma.task.create({
      data: {
        companyId: ownProject.companyId,
        projectId,
        title: 'Timer trend own',
      },
    });
    const foreignTask = await prisma.task.create({
      data: {
        companyId: other.id,
        projectId: foreignProject.id,
        title: 'Timer trend foreign',
      },
    });
    const endpoint = '/api/analytics/timers/closed?limit=3&cursor=2025-01-08';
    const before = await request(app.getHttpServer())
      .get(endpoint)
      .set(auth(admin));
    expect(before.status).toBe(200);
    const timerIds = Array.from(
      { length: 6 },
      (_, i) => `timer-metrics-${Date.now()}-${i}`,
    );
    try {
      const current = new Date('2025-01-07T12:00:00.000Z');
      const previous = new Date('2025-01-04T12:00:00.000Z');
      await prisma.timerSession.createMany({
        data: [
          {
            id: timerIds[0],
            companyId: me.companyId,
            taskId: ownTask.id,
            userId: me.id,
            startedAt: previous,
            closedAt: previous,
            durationMinutes: 60,
            approvalStatus: 'APPROVED',
          },
          {
            id: timerIds[1],
            companyId: me.companyId,
            taskId: ownTask.id,
            userId: me.id,
            startedAt: previous,
            closedAt: current,
            durationMinutes: 120,
            approvalStatus: 'APPROVED',
          },
          {
            id: timerIds[2],
            companyId: me.companyId,
            taskId: ownTask.id,
            userId: me.id,
            startedAt: current,
            closedAt: current,
            durationMinutes: 60,
            approvalStatus: 'APPROVED',
          },
          {
            id: timerIds[3],
            companyId: me.companyId,
            taskId: ownTask.id,
            userId: me.id,
            startedAt: current,
            closedAt: current,
            durationMinutes: 500,
            approvalStatus: 'REJECTED',
          },
          {
            id: timerIds[4],
            companyId: me.companyId,
            taskId: ownTask.id,
            userId: me.id,
            startedAt: current,
            closedAt: null,
            durationMinutes: null,
            approvalStatus: 'APPROVED',
          },
          {
            id: timerIds[5],
            companyId: other.id,
            taskId: foreignTask.id,
            userId: me.id,
            startedAt: current,
            closedAt: current,
            durationMinutes: 999,
            approvalStatus: 'APPROVED',
          },
        ],
      });
      const result = await request(app.getHttpServer())
        .get(endpoint)
        .set(auth(admin));
      expect(result.status).toBe(200);
      expect(
        BigInt(result.body.data.currentMinutes) -
          BigInt(before.body.data.currentMinutes),
      ).toBe(180n);
      expect(
        BigInt(result.body.data.previousMinutes) -
          BigInt(before.body.data.previousMinutes),
      ).toBe(60n);
      expect(result.body.data.nextCursor).toBe('2025-01-05');
      expect(result.body.data.series[2]).toMatchObject({
        minutes: '180',
        workers: 1,
      });
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(ss))).status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(worker)))
          .status,
      ).toBe(403);
      const accountant = (await login(app, 'accountant@gradix.local')).body.data
        .accessToken as string;
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(accountant)))
          .status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/analytics/timers/closed?limit=31')
            .set(auth(admin))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/analytics/timers/closed?cursor=2025-02-30')
            .set(auth(admin))
        ).status,
      ).toBe(400);
      const platform = (await login(app, 'platform@gradix.local')).body.data
        .accessToken as string;
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(platform)))
          .status,
      ).toBe(403);
      const foreign = await request(app.getHttpServer())
        .get(endpoint)
        .set(auth(platform))
        .set('X-Company-Id', other.id);
      expect(foreign.status).toBe(200);
      expect(foreign.body.data.currentMinutes).toBe('999');
      const dst = await request(app.getHttpServer())
        .get('/api/analytics/timers/closed?limit=1&cursor=2025-03-31')
        .set(auth(platform))
        .set('X-Company-Id', other.id);
      expect(dst.status).toBe(200);
      expect(dst.body.data.series[0]).toMatchObject({
        startAt: '2025-03-29T23:00:00.000Z',
        endAt: '2025-03-30T22:00:00.000Z',
      });
      const api = await request(app.getHttpServer()).get('/api/docs-json');
      expect(
        api.body.paths['/api/analytics/timers/closed'].get.parameters,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'cursor' }),
        ]),
      );
    } finally {
      await prisma.timerSession.deleteMany({ where: { id: { in: timerIds } } });
      await prisma.task.deleteMany({
        where: { id: { in: [ownTask.id, foreignTask.id] } },
      });
      await prisma.project.delete({ where: { id: foreignProject.id } });
      await prisma.company.delete({ where: { id: other.id } });
    }
  });

  it('task creation metrics apply tenant and project scope with bounded cursor paging', async () => {
    const endpoint = '/api/analytics/tasks/created?limit=3&cursor=2025-01-08';
    const beforeAdmin = await request(app.getHttpServer())
      .get(endpoint)
      .set(auth(admin));
    const beforeScoped = await request(app.getHttpServer())
      .get(endpoint)
      .set(auth(ss));
    expect(beforeAdmin.status).toBe(200);
    expect(beforeScoped.status).toBe(200);
    const own = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const foreign = await prisma.company.create({
      data: { name: 'Metrics foreign', slug: `metrics-${Date.now()}` },
    });
    const foreignProject = await prisma.project.create({
      data: {
        companyId: foreign.id,
        name: 'Metrics foreign project',
        geofenceRadius: 100,
      },
    });
    const unassigned = await prisma.project.create({
      data: {
        companyId: own.companyId,
        name: 'Metrics unassigned',
        geofenceRadius: 100,
      },
    });
    const currentDate = new Date('2025-01-07T12:00:00.000Z');
    const previousDate = new Date('2025-01-04T12:00:00.000Z');
    const created = await Promise.all([
      prisma.task.create({
        data: {
          companyId: own.companyId,
          projectId,
          title: 'Visible current',
          createdAt: currentDate,
        },
      }),
      prisma.task.create({
        data: {
          companyId: own.companyId,
          projectId,
          title: 'Visible previous',
          createdAt: previousDate,
        },
      }),
      prisma.task.create({
        data: {
          companyId: own.companyId,
          projectId: unassigned.id,
          title: 'Unassigned',
          createdAt: currentDate,
        },
      }),
      prisma.task.create({
        data: {
          companyId: foreign.id,
          projectId: foreignProject.id,
          title: 'Foreign',
          createdAt: currentDate,
        },
      }),
    ]);
    try {
      const all = await request(app.getHttpServer())
        .get(endpoint)
        .set(auth(admin));
      const scoped = await request(app.getHttpServer())
        .get(endpoint)
        .set(auth(ss));
      expect(all.status).toBe(200);
      expect(scoped.status).toBe(200);
      expect(all.body.data.current - beforeAdmin.body.data.current).toBe(2);
      expect(all.body.data.previous - beforeAdmin.body.data.previous).toBe(1);
      expect(scoped.body.data.current - beforeScoped.body.data.current).toBe(1);
      expect(scoped.body.data.previous - beforeScoped.body.data.previous).toBe(
        1,
      );
      expect(scoped.body.data.series).toHaveLength(3);
      expect(scoped.body.data.nextCursor).toBe('2025-01-05');
      expect(new Date(scoped.body.data.series[0].startAt).toISOString()).toBe(
        scoped.body.data.series[0].startAt,
      );
      const accountant = (await login(app, 'accountant@gradix.local')).body.data
        .accessToken as string;
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(accountant)))
          .status,
      ).toBe(403);
      const ssId = (
        await request(app.getHttpServer()).get('/api/me').set(auth(ss))
      ).body.data.id as string;
      const extraRole = await prisma.userRoleAssignment.create({
        data: { userId: ssId, role: 'ACCOUNTANT' },
      });
      try {
        const mixed = await request(app.getHttpServer())
          .get(endpoint)
          .set(auth(ss));
        expect(mixed.status).toBe(200);
        expect(mixed.body.data.current).toBe(scoped.body.data.current);
        expect(mixed.body.data.previous).toBe(scoped.body.data.previous);
      } finally {
        await prisma.userRoleAssignment.delete({ where: { id: extraRole.id } });
      }
      const openapi = await request(app.getHttpServer()).get('/api/docs-json');
      expect(openapi.status).toBe(200);
      expect(
        openapi.body.paths['/api/analytics/tasks/created'].get.parameters,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'cursor' }),
        ]),
      );
      const page = await request(app.getHttpServer())
        .get(
          `/api/analytics/tasks/created?limit=3&cursor=${scoped.body.data.nextCursor}`,
        )
        .set(auth(ss));
      expect(page.status).toBe(200);
      expect(page.body.data.nextCursor).toBe('2025-01-02');
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(worker)))
          .status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get(endpoint)
            .set(auth(admin))
            .set('X-Company-Id', foreign.id)
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/analytics/tasks/created?limit=31')
            .set(auth(admin))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/analytics/tasks/created?cursor=2025-02-30')
            .set(auth(admin))
        ).status,
      ).toBe(400);
      const platform = (await login(app, 'platform@gradix.local')).body.data
        .accessToken as string;
      expect(
        (await request(app.getHttpServer()).get(endpoint).set(auth(platform)))
          .status,
      ).toBe(403);
      const foreignResult = await request(app.getHttpServer())
        .get(endpoint)
        .set(auth(platform))
        .set('X-Company-Id', foreign.id);
      expect(foreignResult.status).toBe(200);
      expect(foreignResult.body.data.current).toBe(1);
      expect(foreignResult.body.data.previous).toBe(0);
      expect(foreignResult.body.data.deltaPercent).toBeNull();
      const dst = await request(app.getHttpServer())
        .get('/api/analytics/tasks/created?limit=1&cursor=2025-03-31')
        .set(auth(platform))
        .set('X-Company-Id', foreign.id);
      expect(dst.status).toBe(200);
      expect(dst.body.data.timezone).toBe('Europe/Sarajevo');
      expect(dst.body.data.series[0]).toMatchObject({
        startAt: '2025-03-29T23:00:00.000Z',
        endAt: '2025-03-30T22:00:00.000Z',
        count: 0,
      });
    } finally {
      await prisma.task.deleteMany({
        where: { id: { in: created.map((row) => row.id) } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: [foreignProject.id, unassigned.id] } },
      });
      await prisma.company.delete({ where: { id: foreign.id } });
    }
  });

  it('second diary create same day returns DIARY_CONFLICT; resolve B', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date, workDescription: 'A' });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(admin))
      .send({ projectId, date, workDescription: 'B' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DIARY_CONFLICT');
    expect(
      second.body.error.details.conflictData.incoming.workDescription,
    ).toBe('B');
    const resolved = await request(app.getHttpServer())
      .post('/api/sync/resolve-conflict')
      .set(auth(ss))
      .send({
        entityType: 'DIARY',
        projectId,
        date,
        choice: 'B',
        incoming: { projectId, date, workDescription: 'B' },
      });
    expect(resolved.status).toBe(201);
    expect(resolved.body.data.workDescription).toBe('B');
  });

  /**
   * BE-11 / odluka vlasnika (opcija A): prijavljivač vidi **svoje** prijave.
   * Prije je WORKER dobijao 403 i na listu i na vlastitu prijavu, iako je jedini
   * koji HSE prijave unosi. Tuđe prijave ostaju nevidljive (scope po `userId`).
   */
  it('HSE: radnik vidi samo vlastite prijave; tuđe ne vidi (opcija A)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'Near miss' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('OPEN');
    const ssIncidentId = created.body.data.id as string;

    const workerEmpty = await request(app.getHttpServer())
      .get('/api/incidents')
      .set(auth(worker));
    expect(workerEmpty.status).toBe(200);
    expect(
      (workerEmpty.body.data as { id: string }[]).map((row) => row.id),
    ).not.toContain(ssIncidentId);

    const own = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(worker))
      .send({ projectId, severity: 'MEDIUM', description: 'Klizav pod' });
    expect(own.status).toBe(201);
    const ownId = own.body.data.id as string;

    const workerList = await request(app.getHttpServer())
      .get('/api/incidents')
      .set(auth(worker));
    expect(workerList.status).toBe(200);
    const ids = (workerList.body.data as { id: string }[]).map((row) => row.id);
    expect(ids).toContain(ownId);
    expect(ids).not.toContain(ssIncidentId);

    // prijavljivač smije zatvoriti svoju prijavu, tuđu ne (404, ne 403 — ne otkriva postojanje)
    const ackOwn = await request(app.getHttpServer())
      .patch(`/api/incidents/${ownId}`)
      .set(auth(worker))
      .send({ status: 'ACK' });
    expect(ackOwn.status).toBe(200);
    expect(ackOwn.body.data.status).toBe('ACK');
    // BE-13 (B11): HSE prijava i promjena statusa su u auditu.
    const incidentAudit = (
      await prisma.auditEvent.findMany({
        where: { entityType: 'Incident', entityId: ownId },
      })
    ).map((row) => row.action);
    expect(incidentAudit).toEqual(
      expect.arrayContaining(['INCIDENT_CREATED', 'INCIDENT_STATUS_CHANGED']),
    );
    const patchForeign = await request(app.getHttpServer())
      .patch(`/api/incidents/${ssIncidentId}`)
      .set(auth(worker))
      .send({ status: 'CLOSED' });
    expect(patchForeign.status).toBe(404);

    const list = await request(app.getHttpServer())
      .get('/api/incidents')
      .set(auth(ss));
    expect(list.status).toBe(200);
    expect((list.body.data as { id: string }[]).map((row) => row.id)).toContain(
      ssIncidentId,
    );
  });

  /**
   * BE-11: PDF dnevnika je padao na 500 za bh. slova (`č`, `ć`, `đ` — WinAnsi ih ne
   * kodira) i sjekao je tekst na 110 znakova; sada se lomi i ide na više stranica.
   */
  it('diary: PDF sa bh. slovima i višerednim tekstom; radnik bez diary.read 403', async () => {
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const created = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({
        projectId,
        date: day,
        workDescription:
          'Čišćenje čelične konstrukcije i đžepova temelja.\nDrugi red — šljunak.',
        problemsNoted: 'Čekamo ćeramičara; žalba na buku.',
      });
    expect(created.status).toBe(201);
    const pdf = await request(app.getHttpServer())
      .post(`/api/diary/${created.body.data.id}/pdf`)
      .set(auth(ss))
      .send({});
    expect(pdf.status).toBe(201);
    expect(pdf.body.data.pdfUrl).toMatch(/\.pdf$/);
    // BE-13 (B11): dnevnik i PDF su sada u auditu.
    const diaryAudit = (
      await prisma.auditEvent.findMany({
        where: { entityType: 'DiaryEntry', entityId: created.body.data.id },
      })
    ).map((row) => row.action);
    expect(diaryAudit).toEqual(
      expect.arrayContaining(['DIARY_CREATED', 'DIARY_PDF_GENERATED']),
    );
    const denied = await request(app.getHttpServer())
      .post(`/api/diary/${created.body.data.id}/pdf`)
      .set(auth(worker))
      .send({});
    expect(denied.status).toBe(403);
  });

  it('diary: temperatura i koordinate fotografije se validiraju (BE-11)', async () => {
    const day = new Date(Date.now() + 172_800_000).toISOString().slice(0, 10);
    const badTemp = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date: day, tempMin: 'abc' });
    expect(badTemp.status).toBe(400);
    const hugeTemp = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date: day, tempMax: '500' });
    expect(hugeTemp.status).toBe(400);
    const ok = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date: day, tempMin: '-3.5', tempMax: '11.2' });
    expect(ok.status).toBe(201);
    const entryId = ok.body.data.id as string;
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(ss));
    const companyId = me.body.data.company.id as string;
    const path = `${companyId}/2026/11/photo-${Date.now()}.png`;
    const halfCoords = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '43.85' });
    expect(halfCoords.status).toBe(400);
    const outOfRange = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '999', lng: '18.4' });
    expect(outOfRange.status).toBe(400);
    const first = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '43.85', lng: '18.41', caption: 'Temelj' });
    expect(first.status).toBe(201);
    // isti objekat dvaput (offline replay) → isti zapis, bez duplikata
    const again = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '43.85', lng: '18.41', caption: 'Temelj' });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(first.body.data.id);
  });

  it('HSE: nevalidan status filter i nevalidne koordinate zadatka (BE-11)', async () => {
    const badStatus = await request(app.getHttpServer())
      .get('/api/incidents')
      .query({ status: 'BOGUS' })
      .set(auth(ss));
    expect(badStatus.status).toBe(400);
    const goodStatus = await request(app.getHttpServer())
      .get('/api/incidents')
      .query({ status: 'OPEN' })
      .set(auth(ss));
    expect(goodStatus.status).toBe(200);
    const badTask = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'x', taskId: 'nema' });
    expect(badTask.status).toBe(400);
    const halfCoords = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'x', lat: '43.85' });
    expect(halfCoords.status).toBe(400);
    const outOfRange = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({
        projectId,
        severity: 'LOW',
        description: 'x',
        lat: '43.85',
        lng: '999',
      });
    expect(outOfRange.status).toBe(400);
    const ok = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({
        projectId,
        severity: 'MEDIUM',
        description: 'Near miss',
        lat: '43.85',
        lng: '18.41',
      });
    expect(ok.status).toBe(201);
  });
});
