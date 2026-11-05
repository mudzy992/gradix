import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { Prisma } from '../generated/client';

describe('Phase 10 erp-lite (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let worker: string;
  let accountant: string;
  let projectId: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken;
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(admin));
    companyId = me.body.data.company.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `ERP ${Date.now()}`,
        code: `ER${Date.now().toString().slice(-6)}`,
        client: 'JP Ceste',
      });
    projectId = created.body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('ACC read, ADMIN write, WORKER 403; client string without partner', async () => {
    const workerList = await request(app.getHttpServer())
      .get('/api/partners')
      .set(auth(worker));
    expect(workerList.status).toBe(403);
    const accList = await request(app.getHttpServer())
      .get('/api/partners')
      .set(auth(accountant));
    expect(accList.status).toBe(200);
    const accWrite = await request(app.getHttpServer())
      .post('/api/partners')
      .set(auth(accountant))
      .send({ type: 'CLIENT', name: 'No write' });
    expect(accWrite.status).toBe(403);
    const partner = await request(app.getHttpServer())
      .post('/api/partners')
      .set(auth(admin))
      .send({ type: 'CLIENT', name: 'JP Ceste' });
    expect(partner.status).toBe(201);
    const project = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    expect(project.body.data.client).toBe('JP Ceste');
    void companyId;
  });

  it('duplicate fuel CostEntry 409; spend not doubled; from-payroll duplicate 409', async () => {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'ERP fuel', type: 'LOADER' });
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '10',
        unitPrice: '2.50',
      });
    expect(fuel.status).toBe(201);
    const afterFuel = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    const spendFuel = Number(afterFuel.body.data.currentSpend);
    const cost = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        amount: '25.00',
        category: 'FUEL',
        date: '2024-03-01',
        source: 'FUEL',
        sourceId: fuel.body.data.id,
        projectId,
      });
    expect(cost.status).toBe(201);
    const afterCost = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    expect(Number(afterCost.body.data.currentSpend)).toBe(spendFuel);
    const dup = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        amount: '25.00',
        category: 'FUEL',
        date: '2024-03-01',
        source: 'FUEL',
        sourceId: fuel.body.data.id,
        projectId,
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const payroll = await request(app.getHttpServer())
      .post('/api/cost-entries/from-payroll')
      .set(auth(admin))
      .send({ year: 2024, month: 3, projectId });
    expect(payroll.status).toBe(201);
    const payrollDup = await request(app.getHttpServer())
      .post('/api/cost-entries/from-payroll')
      .set(auth(admin))
      .send({ year: 2024, month: 3, projectId });
    expect(payrollDup.status).toBe(409);
  });

  async function setupFuelLinkedCost() {
    const source = await prisma.project.create({
      data: { companyId, name: 'Linked fuel source', geofenceRadius: 100 },
    });
    const target = await prisma.project.create({
      data: { companyId, name: 'Linked fuel target', geofenceRadius: 100 },
    });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Linked fuel machine', type: 'TRUCK' });
    expect(machine.status).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId: source.id,
        liters: '5',
        unitPrice: '2',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const cost = (body: object) =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          source: 'FUEL',
          sourceId: fuelId,
          amount: '15',
          category: 'FUEL',
          date: '2026-11-05',
          ...body,
        });
    const amend = (field: string, newValue: string) =>
      request(app.getHttpServer())
        .post('/api/amendments')
        .set(auth(admin))
        .send({
          entityType: 'FUEL',
          entityId: fuelId,
          field,
          newValue,
          reason: 'correct linked fuel',
        });
    return {
      source,
      target,
      fuelId,
      cost,
      amend,
      machineId: machine.body.data.id as string,
    };
  }

  it('validates fuel cost source, tenant and project and keeps entered cost as override', async () => {
    const f = await setupFuelLinkedCost();
    const other = await prisma.company.create({
      data: {
        name: 'Foreign fuel cost',
        slug: `foreign-fuel-cost-${randomUUID()}`,
      },
    });
    const key = randomUUID();
    const beforeAudit = await prisma.auditEvent.count({
      where: { companyId, action: 'COST_ENTRY_CREATED' },
    });
    const post = (body: object) => f.cost({ idempotencyKey: key, ...body });
    expect((await post({ projectId: f.target.id })).status).toBe(409);
    expect(
      (await post({ projectId: f.source.id, sourceId: 'missing-fuel-id' }))
        .status,
    ).toBe(404);
    const foreignMachine = await prisma.machine.create({
      data: {
        companyId: other.id,
        name: 'Foreign source machine',
        type: 'TRUCK',
      },
    });
    const foreignUser = await prisma.user.findFirstOrThrow({
      where: { companyId },
    });
    const foreignFuel = await prisma.fuelEntry.create({
      data: {
        companyId: other.id,
        machineId: foreignMachine.id,
        userId: foreignUser.id,
        liters: '1',
        unitPrice: '1',
        totalCost: '1',
      },
    });
    expect(
      (await post({ projectId: f.source.id, sourceId: foreignFuel.id })).status,
    ).toBe(404);
    expect(
      await prisma.costRequest.count({
        where: { companyId, idempotencyKey: key },
      }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'COST_ENTRY_CREATED' },
      }),
    ).toBe(beforeAudit);
    const created = await post({ projectId: f.source.id });
    expect(created.status).toBe(201);
    const costId = created.body.data.id as string;
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.source.id } })
      ).currentSpend.toString(),
    ).toBe('15');
    expect((await f.amend('unitPrice', '4')).status).toBe(201);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.source.id } })
      ).currentSpend.toString(),
    ).toBe('15');
    expect(
      (
        await prisma.costEntry.findUniqueOrThrow({ where: { id: costId } })
      ).amount.toString(),
    ).toBe('15');
    expect((await f.amend('projectId', f.source.id)).status).toBe(201);
    const amendmentCount = await prisma.amendment.count({
      where: { companyId, entityType: 'FUEL', entityId: f.fuelId },
    });
    expect((await f.amend('projectId', f.target.id)).status).toBe(409);
    expect((await f.amend('projectId', '')).status).toBe(409);
    expect(
      await prisma.amendment.count({
        where: { companyId, entityType: 'FUEL', entityId: f.fuelId },
      }),
    ).toBe(amendmentCount);
    expect(
      (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } }))
        .projectId,
    ).toBe(f.source.id);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
      ).currentSpend.toString(),
    ).toBe('0');
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/api/cost-entries/${costId}`)
          .set(auth(admin))
      ).status,
    ).toBe(204);
    expect((await f.amend('projectId', f.target.id)).status).toBe(201);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.source.id } })
      ).currentSpend.toString(),
    ).toBe('0');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
      ).currentSpend.toString(),
    ).toBe('20');
  });

  it('supports fuel cost without project and replays an existing key without revalidation', async () => {
    const f = await setupFuelLinkedCost();
    const withoutProject = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({ machineId: f.machineId, liters: '3', unitPrice: '2' });
    expect(withoutProject.status).toBe(201);
    const fuelId = withoutProject.body.data.id as string;
    const key = randomUUID();
    const body = {
      source: 'FUEL',
      sourceId: fuelId,
      amount: '6',
      category: 'FUEL',
      date: '2026-11-05',
      idempotencyKey: key,
    };
    const post = () =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send(body);
    expect(
      (await f.cost({ sourceId: fuelId, projectId: f.source.id })).status,
    ).toBe(409);
    const created = await post();
    expect(created.status).toBe(201);
    const blocked = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(admin))
      .send({
        entityType: 'FUEL',
        entityId: fuelId,
        field: 'projectId',
        newValue: f.source.id,
        reason: 'move linked fuel',
      });
    expect(blocked.status).toBe(409);
    // Simulate a legacy/external mutation. Existing receipt remains replayable.
    await prisma.fuelEntry.update({
      where: { id: fuelId },
      data: { projectId: f.source.id },
    });
    const replay = await post();
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(replay.body.data.projectId).toBeNull();
  });

  it('revalidates the fuel project after a concurrent update and rolls back the cost key', async () => {
    const f = await setupFuelLinkedCost();
    const key = randomUUID();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "FuelEntry" WHERE "id" = ${f.fuelId} FOR NO KEY UPDATE`;
        await tx.fuelEntry.update({
          where: { id: f.fuelId },
          data: { projectId: f.target.id },
        });
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = f
        .cost({ projectId: f.source.id, idempotencyKey: key })
        .then((r) => r);
      void posting.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'FuelEntry', 'FOR SHARE');
      release();
      await holder;
      expect((await posting).status).toBe(409);
      expect(
        await prisma.costEntry.count({
          where: { companyId, source: 'FUEL', sourceId: f.fuelId },
        }),
      ).toBe(0);
      expect(
        await prisma.costRequest.count({
          where: { companyId, idempotencyKey: key },
        }),
      ).toBe(0);
      expect(
        (await f.cost({ projectId: f.target.id, idempotencyKey: key })).status,
      ).toBe(201);
    } finally {
      release();
      await Promise.allSettled([holder, posting]);
    }
  });

  it('serializes linked fuel cost creation before a concurrent project amendment', async () => {
    const f = await setupFuelLinkedCost();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${f.source.id} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    let amendment: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = f
        .cost({ projectId: f.source.id, idempotencyKey: randomUUID() })
        .then((r) => r);
      void posting.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'Project', 'FOR NO KEY UPDATE');
      amendment = f.amend('projectId', f.target.id).then((r) => r);
      void amendment.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'FuelEntry', 'FOR NO KEY UPDATE');
      release();
      await holder;
      expect((await posting).status).toBe(201);
      expect((await amendment).status).toBe(409);
      expect(
        (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } }))
          .projectId,
      ).toBe(f.source.id);
      expect(
        await prisma.amendment.count({
          where: { companyId, entityType: 'FUEL', entityId: f.fuelId },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.project.findUniqueOrThrow({ where: { id: f.source.id } })
        ).currentSpend.toString(),
      ).toBe('15');
      expect(
        (
          await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
        ).currentSpend.toString(),
      ).toBe('0');
    } finally {
      release();
      await Promise.allSettled([holder, posting, amendment]);
    }
  });

  async function setupServiceCost() {
    const project = await prisma.project.create({
      data: { companyId, name: 'Linked service project', geofenceRadius: 100 },
    });
    const otherProject = await prisma.project.create({
      data: { companyId, name: 'Other service project', geofenceRadius: 100 },
    });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Linked service machine', type: 'TRUCK' });
    expect(machine.status).toBe(201);
    const machineId = machine.body.data.id as string;
    const service = await request(app.getHttpServer())
      .post('/api/services')
      .set(auth(admin))
      .send({ machineId, projectId: project.id });
    expect(service.status).toBe(201);
    const serviceId = service.body.data.id as string;
    const cost = (body: object) =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          source: 'SERVICE',
          sourceId: serviceId,
          amount: '15',
          category: 'SERVICE',
          date: '2026-11-05',
          ...body,
        });
    return { project, otherProject, machineId, serviceId, cost };
  }

  it('checks service source tenant and project while keeping existing replay and override semantics', async () => {
    const f = await setupServiceCost();
    const otherCompany = await prisma.company.create({
      data: {
        name: 'Foreign service cost',
        slug: `foreign-service-${randomUUID()}`,
      },
    });
    const foreignMachine = await prisma.machine.create({
      data: {
        companyId: otherCompany.id,
        name: 'Foreign service machine',
        type: 'TRUCK',
      },
    });
    const foreignService = await prisma.serviceRecord.create({
      data: { companyId: otherCompany.id, machineId: foreignMachine.id },
    });
    const key = randomUUID();
    const beforeAudit = await prisma.auditEvent.count({
      where: { companyId, action: 'COST_ENTRY_CREATED' },
    });
    expect(
      (
        await f.cost({
          sourceId: 'missing-service',
          projectId: f.project.id,
          idempotencyKey: key,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.cost({
          sourceId: foreignService.id,
          projectId: f.project.id,
          idempotencyKey: key,
        })
      ).status,
    ).toBe(404);
    expect(
      (await f.cost({ projectId: f.otherProject.id, idempotencyKey: key }))
        .status,
    ).toBe(409);
    expect((await f.cost({ idempotencyKey: key })).status).toBe(409);
    expect(
      await prisma.costRequest.count({
        where: { companyId, idempotencyKey: key },
      }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'COST_ENTRY_CREATED' },
      }),
    ).toBe(beforeAudit);
    const created = await f.cost({
      projectId: f.project.id,
      idempotencyKey: key,
    });
    expect(created.status).toBe(201);
    expect(
      (
        await prisma.serviceRecord.findUniqueOrThrow({
          where: { id: f.serviceId },
        })
      ).status,
    ).toBe('PLANNED');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })
      ).currentSpend.toString(),
    ).toBe('15');
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/services/${f.serviceId}/start`)
          .set(auth(admin))
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/services/${f.serviceId}/complete`)
          .set(auth(admin))
          .send({ totalCost: '30' })
      ).status,
    ).toBe(201);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })
      ).currentSpend.toString(),
    ).toBe('15');
    expect(
      (
        await prisma.costEntry.findUniqueOrThrow({
          where: { id: created.body.data.id as string },
        })
      ).amount.toString(),
    ).toBe('15');
    // Simulate a legacy/external edit to prove replay remains before the new validation.
    await prisma.serviceRecord.update({
      where: { id: f.serviceId },
      data: { projectId: f.otherProject.id },
    });
    const replay = await f.cost({
      projectId: f.project.id,
      idempotencyKey: key,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(created.body.data.id);
  });

  it('links an unassigned service only to an unassigned cost', async () => {
    const f = await setupServiceCost();
    const unassigned = await prisma.serviceRecord.create({
      data: { companyId, machineId: f.machineId },
    });
    expect(
      (await f.cost({ sourceId: unassigned.id, projectId: f.project.id }))
        .status,
    ).toBe(409);
    const created = await f.cost({ sourceId: unassigned.id });
    expect(created.status).toBe(201);
    expect(created.body.data.projectId).toBeNull();
  });

  it('revalidates the service project after a concurrent update and rolls back the cost key', async () => {
    const f = await setupServiceCost();
    const key = randomUUID();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ServiceRecord" WHERE "id" = ${f.serviceId} FOR NO KEY UPDATE`;
        await tx.serviceRecord.update({
          where: { id: f.serviceId },
          data: { projectId: f.otherProject.id },
        });
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = f
        .cost({ projectId: f.project.id, idempotencyKey: key })
        .then((r) => r);
      void posting.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'ServiceRecord', 'FOR SHARE');
      release();
      await holder;
      expect((await posting).status).toBe(409);
      expect(
        await prisma.costEntry.count({
          where: { companyId, source: 'SERVICE', sourceId: f.serviceId },
        }),
      ).toBe(0);
      expect(
        await prisma.costRequest.count({
          where: { companyId, idempotencyKey: key },
        }),
      ).toBe(0);
      expect(
        (await f.cost({ projectId: f.otherProject.id, idempotencyKey: key }))
          .status,
      ).toBe(201);
    } finally {
      release();
      await Promise.allSettled([holder, posting]);
    }
  });

  it('serializes a linked cost with service completion and counts the source once', async () => {
    const f = await setupServiceCost();
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/services/${f.serviceId}/start`)
          .set(auth(admin))
      ).status,
    ).toBe(201);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${f.project.id} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    let completion: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = f
        .cost({ projectId: f.project.id, idempotencyKey: randomUUID() })
        .then((r) => r);
      completion = request(app.getHttpServer())
        .post(`/api/services/${f.serviceId}/complete`)
        .set(auth(admin))
        .send({ totalCost: '30' })
        .then((r) => r);
      void posting.catch(() => undefined);
      void completion.catch(() => undefined);
      await waitForCostProjectLock(prisma, 2);
      release();
      await holder;
      expect((await posting).status).toBe(201);
      expect((await completion).status).toBe(201);
      expect(
        (
          await prisma.serviceRecord.findUniqueOrThrow({
            where: { id: f.serviceId },
          })
        ).totalCost?.toString(),
      ).toBe('30');
      expect(
        (
          await prisma.project.findUniqueOrThrow({
            where: { id: f.project.id },
          })
        ).currentSpend.toString(),
      ).toBe('15');
      expect(
        await prisma.costEntry.count({
          where: { companyId, source: 'SERVICE', sourceId: f.serviceId },
        }),
      ).toBe(1);
    } finally {
      release();
      await Promise.allSettled([holder, posting, completion]);
    }
  });

  it('replays concurrent keyed costs, rejects changed payload and retains the key after deletion', async () => {
    const idempotencyKey = randomUUID();
    const body = {
      idempotencyKey,
      amount: '12.50',
      category: 'OTHER',
      date: '2026-11-05',
      projectId,
      note: 'retry',
    };
    const post = (payload: object) =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send(payload);
    const before = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const result = await Promise.all(
      Array.from({ length: 4 }, () => post(body)),
    );
    expect(result.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const id = result[0].body.data.id as string;
    expect(result.every((r) => r.body.data.id === id)).toBe(true);
    const replay = await post({
      ...body,
      amount: '12.500',
      idempotencyKey: idempotencyKey.toUpperCase(),
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(id);
    for (const change of [
      { amount: '12.51' },
      { note: 'other' },
      { date: '2026-11-04' },
      { category: 'MATERIAL' },
      { projectId: null },
    ]) {
      expect((await post({ ...body, ...change })).status).toBe(409);
    }
    expect((await post({ ...body, idempotencyKey: 'invalid' })).status).toBe(
      400,
    );
    const after = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(after.currentSpend.minus(before.currentSpend).toFixed(2)).toBe(
      '12.50',
    );
    const deleted = await request(app.getHttpServer())
      .delete(`/api/cost-entries/${id}`)
      .set(auth(admin));
    expect(deleted.status).toBe(204);
    expect((await post(body)).status).toBe(409);
    const receipt = await prisma.costRequest.findUniqueOrThrow({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
    });
    expect(receipt.costEntryId).toBeNull();
  });

  it('serializes different concurrent cost payloads using the same key', async () => {
    const idempotencyKey = randomUUID();
    const post = (amount: string) =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          idempotencyKey,
          amount,
          category: 'OTHER',
          date: '2026-11-05',
        });
    const results = await Promise.all([post('2'), post('3')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const receipt = await prisma.costRequest.findUniqueOrThrow({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
    });
    expect(receipt.costEntryId).toBe(
      results.find((r) => r.status === 201)!.body.data.id,
    );
  });

  it('rolls back key claims on failure, preserves source conflicts and allows retry after lost response', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({ name: 'Key rollback', code: `K${randomUUID().slice(0, 8)}` });
    expect(project.status).toBe(201);
    const id = project.body.data.id as string;
    const post = (payload: object) =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send(payload);
    const base = { projectId: id, category: 'OTHER', date: '2026-11-05' };
    expect((await post({ ...base, amount: '9999999999.99' })).status).toBe(201);
    const key = randomUUID();
    expect(
      (await post({ ...base, amount: '0.01', idempotencyKey: key })).status,
    ).toBe(409);
    expect(
      await prisma.costRequest.findUnique({
        where: { companyId_idempotencyKey: { companyId, idempotencyKey: key } },
      }),
    ).toBeNull();
    expect(
      (await post({ ...base, amount: '0', idempotencyKey: key })).status,
    ).toBe(201);
    const sourceMachine = await prisma.machine.create({
      data: { companyId, name: 'Receipt service machine', type: 'TRUCK' },
    });
    const uniqueSource = (
      await prisma.serviceRecord.create({
        data: { companyId, machineId: sourceMachine.id },
      })
    ).id;
    const sourceBody = {
      amount: '1',
      category: 'OTHER',
      date: '2026-11-05',
      source: 'SERVICE',
      sourceId: uniqueSource,
    };
    expect((await post(sourceBody)).status).toBe(201);
    const conflictKey = randomUUID();
    expect(
      (await post({ ...sourceBody, idempotencyKey: conflictKey })).status,
    ).toBe(409);
    expect(
      await prisma.costRequest.findUnique({
        where: {
          companyId_idempotencyKey: { companyId, idempotencyKey: conflictKey },
        },
      }),
    ).toBeNull();
    const lost = {
      amount: '1',
      category: 'OTHER',
      date: '2026-11-05',
      idempotencyKey: randomUUID(),
    };
    const audit = jest
      .spyOn(app.get(AuditService), 'write')
      .mockRejectedValueOnce(new Error('simulated post-commit failure'));
    try {
      expect((await post(lost)).status).toBe(500);
      const retry = await post(lost);
      expect(retry.status).toBe(201);
      expect(
        await prisma.costEntry.count({
          where: { id: retry.body.data.id as string, companyId },
        }),
      ).toBe(1);
      expect(audit).toHaveBeenCalledTimes(1);
    } finally {
      audit.mockRestore();
    }
  });

  it('scopes cost idempotency keys to the selected company', async () => {
    const other = await prisma.company.create({
      data: { name: 'Cost isolation', slug: `cost-${randomUUID()}` },
    });
    const platform = await login(app, 'platform@gradix.local');
    expect(platform.status).toBe(200);
    const body = {
      amount: '1',
      category: 'OTHER',
      date: '2026-11-05',
      idempotencyKey: randomUUID(),
    };
    const first = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send(body);
    const second = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(platform.body.data.accessToken as string))
      .set('X-Company-Id', other.id)
      .send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
    expect(
      await prisma.costRequest.count({
        where: { idempotencyKey: body.idempotencyKey },
      }),
    ).toBe(2);
  });

  it('rejects non-finite decimal inputs across stock, costs, projects, fuel and quantities without writing', async () => {
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Finite decimal warehouse', type: 'YARD' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Finite decimal material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Finite decimal machine', type: 'TRUCK' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    expect(machine.status).toBe(201);
    const machineId = machine.body.data.id as string;
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const projectName = `Nonfinite-${randomUUID()}`;
    const costCountBefore = await prisma.costEntry.count({
      where: { companyId, projectId },
    });
    const quantityCountBefore = await prisma.quantityItem.count({
      where: { companyId, projectId },
    });
    const fuelCountBefore = await prisma.fuelEntry.count({
      where: { companyId, machineId },
    });
    const beforeProject = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    for (const value of [
      'Infinity',
      '-Infinity',
      'NaN',
      '1e999999999999999999',
      '1e-999999999999999999',
      '-1e-999999999999999999',
    ]) {
      const movement = await request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send({
          warehouseId,
          materialId,
          qty: value,
          idempotencyKey: randomUUID(),
        });
      expect(movement.status).toBe(400);
      expect(movement.body.error.code).toBe('VALIDATION_FAILED');
      expect(movement.body.error.message).toBe('qty must be a decimal');
      const cost = await request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          amount: value,
          category: 'OTHER',
          date: '2026-11-05',
          projectId,
        });
      expect(cost.status).toBe(400);
      expect(cost.body.error.code).toBe('VALIDATION_FAILED');
      expect(cost.body.error.message).toBe('amount must be a decimal');
      const project = await request(app.getHttpServer())
        .post('/api/projects')
        .set(auth(admin))
        .send({ name: projectName, plannedBudget: value });
      expect(project.status).toBe(400);
      expect(project.body.error.code).toBe('VALIDATION_FAILED');
      expect(project.body.error.message).toBe(
        'plannedBudget must be a decimal',
      );
      const quantity = await request(app.getHttpServer())
        .post(`/api/projects/${projectId}/quantities`)
        .set(auth(admin))
        .send({
          name: 'Nonfinite qty',
          unit: 'M3',
          plannedQty: '1',
          executedQty: value,
        });
      expect(quantity.status).toBe(400);
      expect(quantity.body.error.code).toBe('VALIDATION_FAILED');
      expect(quantity.body.error.message).toBe('executedQty must be a decimal');
      const fuel = await request(app.getHttpServer())
        .post('/api/fuel')
        .set(auth(admin))
        .send({ machineId, projectId, liters: value, unitPrice: '1' });
      expect(fuel.status).toBe(400);
      expect(fuel.body.error.code).toBe('VALIDATION_FAILED');
      expect(fuel.body.error.message).toBe('liters must be a decimal');
    }
    expect(
      await prisma.stockMovement.count({
        where: { companyId, warehouseId, materialId },
      }),
    ).toBe(0);
    expect(
      await prisma.project.count({ where: { companyId, name: projectName } }),
    ).toBe(0);
    expect(
      await prisma.costEntry.count({ where: { companyId, projectId } }),
    ).toBe(costCountBefore);
    expect(
      await prisma.quantityItem.count({ where: { companyId, projectId } }),
    ).toBe(quantityCountBefore);
    expect(
      await prisma.fuelEntry.count({ where: { companyId, machineId } }),
    ).toBe(fuelCountBefore);
    // Invalid requests cannot have modified this project's spend either.
    const project = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    expect(project.status).toBe(200);
    expect(Number(project.body.data.currentSpend)).toBe(
      Number(beforeProject.currentSpend),
    );
  });

  it('accepts exact cost amounts and rejects rounding, overflow and underflow without writes', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Exact cost project',
        code: `C${randomUUID().slice(0, 8)}`,
      });
    expect(project.status).toBe(201);
    const costProjectId = project.body.data.id as string;
    const post = (amount: string, linked: boolean) =>
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          amount,
          category: 'MATERIAL',
          date: '2026-11-05',
          ...(linked ? { projectId: costProjectId } : {}),
        });
    for (const [amount, expected] of [
      ['0', '0.00'],
      ['0e-999999999999999999', '0.00'],
      ['1e-2', '0.01'],
      ['1.2300', '1.23'],
    ]) {
      const result = await post(amount, true);
      expect(result.status).toBe(201);
      expect(result.body.data.amount).toBe(expected);
    }
    const boundary = await post('9999999999.990', false);
    expect(boundary.status).toBe(201);
    expect(boundary.body.data.amount).toBe('9999999999.99');
    const before = await prisma.costEntry.count({ where: { companyId } });
    const auditsBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'COST_ENTRY_CREATED' },
    });
    const spendBefore = await prisma.project.findUniqueOrThrow({
      where: { id: costProjectId },
      select: { currentSpend: true },
    });
    expect(spendBefore.currentSpend.toFixed(2)).toBe('1.24');
    for (const amount of [
      '-0.01',
      '0.001',
      '0.005',
      '1e-3',
      '9999999999.999',
      '10000000000',
      '1e-999999999999999999',
      '-1e-999999999999999999',
      '0x1p-999999999999999999',
    ]) {
      for (const linked of [false, true]) {
        const result = await post(amount, linked);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('VALIDATION_FAILED');
      }
    }
    expect(await prisma.costEntry.count({ where: { companyId } })).toBe(before);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'COST_ENTRY_CREATED' },
      }),
    ).toBe(auditsBefore);
    const spendAfter = await prisma.project.findUniqueOrThrow({
      where: { id: costProjectId },
      select: { currentSpend: true },
    });
    expect(spendAfter.currentSpend.toString()).toBe(
      spendBefore.currentSpend.toString(),
    );
  });

  it('rolls back direct and payroll costs when the project spend exceeds its column', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Spend limit project',
        code: `S${randomUUID().slice(0, 8)}`,
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const base = { projectId: id, category: 'MATERIAL', date: '2026-11-05' };
    const boundary = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({ ...base, amount: '9999999999.99' });
    expect(boundary.status).toBe(201);
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    const task = await prisma.task.create({
      data: { companyId, projectId: id, title: 'Spend payroll test' },
    });
    await prisma.timerSession.create({
      data: {
        companyId,
        userId: adminUser.id,
        taskId: task.id,
        startedAt: new Date('2026-11-04T08:00:00Z'),
        closedAt: new Date('2026-11-04T09:00:00Z'),
        durationMinutes: 60,
        hourlyRateSnapshot: '1.00',
        approvalStatus: 'APPROVED',
      },
    });
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'COST_ENTRY_CREATED' },
    });
    const overflow = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({ ...base, amount: '0.01' });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error.code).toBe('CONFLICT');
    const payroll = await request(app.getHttpServer())
      .post('/api/cost-entries/from-payroll')
      .set(auth(admin))
      .send({ projectId: id, year: 2026, month: 11 });
    expect(payroll.status).toBe(409);
    expect(payroll.body.error.code).toBe('CONFLICT');
    expect(await prisma.costEntry.count({ where: { projectId: id } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'COST_ENTRY_CREATED' },
      }),
    ).toBe(auditBefore);
    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.currentSpend.toFixed(2)).toBe('9999999999.99');
  });

  it('serializes project cost creates and removal before mutation', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Cost lock project',
        code: `L${randomUUID().slice(0, 8)}`,
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const base = { projectId: id, category: 'MATERIAL', date: '2026-11-05' };
    const initial = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({ ...base, amount: '5.00' });
    expect(initial.status).toBe(201);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    let removal: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      first = request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({ ...base, amount: '7.00' })
        .then((response) => response);
      second = request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({ ...base, amount: '11.00' })
        .then((response) => response);
      removal = request(app.getHttpServer())
        .delete(`/api/cost-entries/${initial.body.data.id as string}`)
        .set(auth(admin))
        .then((response) => response);
      void first.catch(() => undefined);
      void second.catch(() => undefined);
      void removal.catch(() => undefined);
      await waitForCostProjectLock(prisma, 3);
      expect(await prisma.costEntry.count({ where: { projectId: id } })).toBe(
        1,
      );
      release();
      const [a, b, c] = await Promise.all([first, second, removal]);
      expect([a.status, b.status, c.status]).toEqual([201, 201, 204]);
      expect(await prisma.costEntry.count({ where: { projectId: id } })).toBe(
        2,
      );
      const row = await prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.currentSpend.toFixed(2)).toBe('18.00');
    } finally {
      release();
      await Promise.allSettled([holder, first, second, removal]);
    }
  });

  it('allows only one concurrent removal of the same project cost', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Double remove project',
        code: `D${randomUUID().slice(0, 8)}`,
      });
    expect(project.status).toBe(201);
    const id = project.body.data.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        projectId: id,
        category: 'MATERIAL',
        date: '2026-11-05',
        amount: '7',
      });
    expect(created.status).toBe(201);
    const costId = created.body.data.id as string;
    const before = await prisma.auditEvent.count({
      where: { companyId, action: 'COST_ENTRY_REMOVED', entityId: costId },
    });
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/api/cost-entries/${costId}`)
        .set(auth(admin)),
      request(app.getHttpServer())
        .delete(`/api/cost-entries/${costId}`)
        .set(auth(admin)),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 404]);
    expect(await prisma.costEntry.count({ where: { id: costId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'COST_ENTRY_REMOVED', entityId: costId },
      }),
    ).toBe(before + 1);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id } })
      ).currentSpend.toFixed(2),
    ).toBe('0.00');
  });

  it('serializes payroll and direct costs competing for remaining project spend capacity', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({ name: 'Cost cap race', code: `R${randomUUID().slice(0, 8)}` });
    expect(project.status).toBe(201);
    const id = project.body.data.id as string;
    const base = { projectId: id, category: 'MATERIAL', date: '2026-11-05' };
    const initial = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({ ...base, amount: '9999999999.49' });
    expect(initial.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    const task = await prisma.task.create({
      data: { companyId, projectId: id, title: 'Payroll race' },
    });
    await prisma.timerSession.create({
      data: {
        companyId,
        userId: user.id,
        taskId: task.id,
        startedAt: new Date('2026-11-04T08:00:00Z'),
        closedAt: new Date('2026-11-04T09:00:00Z'),
        durationMinutes: 60,
        hourlyRateSnapshot: '0.50',
        approvalStatus: 'APPROVED',
      },
    });
    const [manual, payroll] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({ ...base, amount: '0.50' }),
      request(app.getHttpServer())
        .post('/api/cost-entries/from-payroll')
        .set(auth(admin))
        .send({ projectId: id, year: 2026, month: 11 }),
    ]);
    expect([manual.status, payroll.status].sort()).toEqual([201, 409]);
    expect(await prisma.costEntry.count({ where: { projectId: id } })).toBe(2);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id } })
      ).currentSpend.toFixed(2),
    ).toBe('9999999999.99');
  });

  it('does not create a cost for a project belonging to another company', async () => {
    const other = await prisma.company.create({
      data: { name: 'Other cost company', slug: `cost-${randomUUID()}` },
    });
    const project = await prisma.project.create({
      data: {
        companyId: other.id,
        name: 'Other cost project',
        geofenceRadius: 100,
        code: `O${randomUUID().slice(0, 8)}`,
      },
    });
    const result = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        projectId: project.id,
        category: 'MATERIAL',
        date: '2026-11-05',
        amount: '1',
      });
    expect(result.status).toBe(404);
    expect(
      await prisma.costEntry.count({ where: { projectId: project.id } }),
    ).toBe(0);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: project.id } })
      ).currentSpend.toFixed(2),
    ).toBe('0.00');
  });

  it('serializes cost, fuel and service completion before their project mutations', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({ name: 'Mixed spend race', code: `M${randomUUID().slice(0, 8)}` });
    expect(project.status).toBe(201);
    const id = project.body.data.id as string;
    const otherProject = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Independent spend project',
        code: `I${randomUUID().slice(0, 8)}`,
      });
    expect(otherProject.status).toBe(201);
    const otherProjectId = otherProject.body.data.id as string;
    const fuelMachine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Spend fuel machine', type: 'LOADER' });
    const serviceMachine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Spend service machine', type: 'LOADER' });
    expect(fuelMachine.status).toBe(201);
    expect(serviceMachine.status).toBe(201);
    const fuelMachineId = fuelMachine.body.data.id as string;
    const serviceMachineId = serviceMachine.body.data.id as string;
    const service = await request(app.getHttpServer())
      .post('/api/services')
      .set(auth(admin))
      .send({ machineId: serviceMachineId, projectId: id });
    expect(service.status).toBe(201);
    const serviceId = service.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/services/${serviceId}/start`)
          .set(auth(admin))
      ).status,
    ).toBe(201);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let cost: Promise<request.Response> | undefined;
    let fuel: Promise<request.Response> | undefined;
    let complete: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      cost = request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          projectId: id,
          category: 'MATERIAL',
          date: '2026-11-05',
          amount: '10',
        })
        .then((response) => response);
      fuel = request(app.getHttpServer())
        .post('/api/fuel')
        .set(auth(admin))
        .send({
          projectId: id,
          machineId: fuelMachineId,
          liters: '10',
          unitPrice: '2.50',
        })
        .then((response) => response);
      complete = request(app.getHttpServer())
        .post(`/api/services/${serviceId}/complete`)
        .set(auth(admin))
        .send({ totalCost: '30' })
        .then((response) => response);
      void cost.catch(() => undefined);
      void fuel.catch(() => undefined);
      void complete.catch(() => undefined);
      await waitForCostProjectLock(prisma, 3);
      expect(await prisma.costEntry.count({ where: { projectId: id } })).toBe(
        0,
      );
      expect(await prisma.fuelEntry.count({ where: { projectId: id } })).toBe(
        0,
      );
      expect(
        (
          await prisma.serviceRecord.findUniqueOrThrow({
            where: { id: serviceId },
          })
        ).status,
      ).toBe('IN_PROGRESS');
      expect(
        (
          await prisma.machine.findUniqueOrThrow({
            where: { id: serviceMachineId },
          })
        ).status,
      ).toBe('IN_SERVICE');
      const independent = await request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          projectId: otherProjectId,
          category: 'MATERIAL',
          date: '2026-11-05',
          amount: '1',
        });
      expect(independent.status).toBe(201);
      release();
      const [a, b, c] = await Promise.all([cost, fuel, complete]);
      expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
      expect(
        (
          await prisma.project.findUniqueOrThrow({ where: { id } })
        ).currentSpend.toFixed(2),
      ).toBe('65.00');
      expect(
        (
          await prisma.serviceRecord.findUniqueOrThrow({
            where: { id: serviceId },
          })
        ).status,
      ).toBe('COMPLETED');
    } finally {
      release();
      await Promise.allSettled([holder, cost, fuel, complete]);
    }
  });

  it('rolls back fuel and service completion when the project spend limit is exceeded', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Mixed spend overflow',
        code: `X${randomUUID().slice(0, 8)}`,
      });
    expect(project.status).toBe(201);
    const id = project.body.data.id as string;
    const cost = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        projectId: id,
        category: 'MATERIAL',
        date: '2026-11-05',
        amount: '9999999999.99',
      });
    expect(cost.status).toBe(201);
    const fuelMachine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Overflow fuel machine', type: 'LOADER' });
    const serviceMachine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Overflow service machine', type: 'LOADER' });
    expect(fuelMachine.status).toBe(201);
    expect(serviceMachine.status).toBe(201);
    const fuelMachineId = fuelMachine.body.data.id as string;
    const serviceMachineId = serviceMachine.body.data.id as string;
    const service = await request(app.getHttpServer())
      .post('/api/services')
      .set(auth(admin))
      .send({ projectId: id, machineId: serviceMachineId });
    expect(service.status).toBe(201);
    const serviceId = service.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/services/${serviceId}/start`)
          .set(auth(admin))
      ).status,
    ).toBe(201);
    const fuelAudit = await prisma.auditEvent.count({
      where: { companyId, action: 'FUEL_CREATED' },
    });
    const serviceAudit = await prisma.auditEvent.count({
      where: { companyId, action: 'SERVICE_COMPLETED' },
    });
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        projectId: id,
        machineId: fuelMachineId,
        liters: '1',
        unitPrice: '1',
      });
    const complete = await request(app.getHttpServer())
      .post(`/api/services/${serviceId}/complete`)
      .set(auth(admin))
      .send({ totalCost: '1' });
    expect([fuel.status, complete.status]).toEqual([409, 409]);
    expect([fuel.body.error.code, complete.body.error.code]).toEqual([
      'CONFLICT',
      'CONFLICT',
    ]);
    expect(await prisma.fuelEntry.count({ where: { projectId: id } })).toBe(0);
    expect(
      (
        await prisma.serviceRecord.findUniqueOrThrow({
          where: { id: serviceId },
        })
      ).status,
    ).toBe('IN_PROGRESS');
    expect(
      (
        await prisma.machine.findUniqueOrThrow({
          where: { id: serviceMachineId },
        })
      ).status,
    ).toBe('IN_SERVICE');
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_CREATED' },
      }),
    ).toBe(fuelAudit);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'SERVICE_COMPLETED' },
      }),
    ).toBe(serviceAudit);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id } })
      ).currentSpend.toFixed(2),
    ).toBe('9999999999.99');
  });

  it('keeps opposite fuel moves and concurrent edits consistent across projects', async () => {
    const createProject = async (name: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/projects')
        .set(auth(admin))
        .send({ name, code: `P${randomUUID().slice(0, 8)}` });
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    };
    const a = await createProject('Fuel move A');
    const b = await createProject('Fuel move B');
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Fuel move machine', type: 'LOADER' });
    expect(machine.status).toBe(201);
    const machineId = machine.body.data.id as string;
    const createFuel = async (projectId: string, liters: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/fuel')
        .set(auth(admin))
        .send({ projectId, machineId, liters, unitPrice: '2' });
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    };
    const fuelA = await createFuel(a, '5');
    const fuelB = await createFuel(b, '10');
    const amend = (entityId: string, field: string, newValue: string) =>
      request(app.getHttpServer())
        .post('/api/amendments')
        .set(auth(admin))
        .send({
          entityType: 'FUEL',
          entityId,
          field,
          newValue,
          reason: 'correct project or quantity',
        });
    const firstProject = [a, b].sort()[0];
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${firstProject} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      first = amend(fuelA, 'projectId', b).then((response) => response);
      second = amend(fuelB, 'projectId', a).then((response) => response);
      void first.catch(() => undefined);
      void second.catch(() => undefined);
      await waitForCostProjectLock(prisma, 2);
      expect(
        (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: fuelA } }))
          .projectId,
      ).toBe(a);
      expect(
        (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: fuelB } }))
          .projectId,
      ).toBe(b);
      release();
      const [one, two] = await Promise.all([first, second]);
      expect([one.status, two.status]).toEqual([201, 201]);
    } finally {
      release();
      await Promise.allSettled([holder, first, second]);
    }
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: a } })
      ).currentSpend.toFixed(2),
    ).toBe('20.00');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: b } })
      ).currentSpend.toFixed(2),
    ).toBe('10.00');
    let releaseFuel!: () => void;
    let readyFuel!: () => void;
    const fuelGate = new Promise<void>((resolve) => {
      releaseFuel = resolve;
    });
    const fuelLocked = new Promise<void>((resolve) => {
      readyFuel = resolve;
    });
    const fuelHolder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "FuelEntry" WHERE "id" = ${fuelA} FOR NO KEY UPDATE`;
        readyFuel();
        await fuelGate;
      },
      { timeout: 15000 },
    );
    let litersPending: Promise<request.Response> | undefined;
    let pricePending: Promise<request.Response> | undefined;
    let liters!: request.Response;
    let price!: request.Response;
    try {
      await Promise.race([fuelLocked, fuelHolder]);
      litersPending = amend(fuelA, 'liters', '7').then((response) => response);
      pricePending = amend(fuelA, 'unitPrice', '3').then(
        (response) => response,
      );
      void litersPending.catch(() => undefined);
      void pricePending.catch(() => undefined);
      await waitForCostProjectLock(prisma, 2, 'FuelEntry');
      releaseFuel();
      [liters, price] = await Promise.all([litersPending, pricePending]);
      expect([liters.status, price.status]).toEqual([201, 201]);
    } finally {
      releaseFuel();
      await Promise.allSettled([fuelHolder, litersPending, pricePending]);
    }
    const changed = await prisma.fuelEntry.findUniqueOrThrow({
      where: { id: fuelA },
    });
    expect(changed.projectId).toBe(b);
    expect(changed.liters.toString()).toBe('7');
    expect(changed.unitPrice.toString()).toBe('3');
    expect(changed.totalCost.toFixed(2)).toBe('21.00');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: b } })
      ).currentSpend.toFixed(2),
    ).toBe('21.00');
    expect(liters.body.data.oldValue).toBe('5');
    expect(price.body.data.oldValue).toBe('2');
  });

  it('validates exact fuel values and total cost without partial writes on create or amendment', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: 'Fuel precision project',
        code: `FP${randomUUID().slice(0, 8)}`,
      });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Fuel precision machine', type: 'LOADER' });
    expect(project.status).toBe(201);
    expect(machine.status).toBe(201);
    const ownProject = project.body.data.id as string;
    const machineId = machine.body.data.id as string;
    const create = (liters: string, unitPrice: string) =>
      request(app.getHttpServer())
        .post('/api/fuel')
        .set(auth(admin))
        .send({ machineId, projectId: ownProject, liters, unitPrice });
    const initialCount = await prisma.fuelEntry.count({
      where: { companyId, machineId },
    });
    const initialAudit = await prisma.auditEvent.count({
      where: { companyId, action: 'FUEL_CREATED' },
    });
    for (const [liters, price] of [
      ['0.0005', '1'],
      ['1e-999999999999999999', '1'],
      ['1000000000', '1'],
      ['1', '0.005'],
      ['1', '1e-999999999999999999'],
      ['1', '10000000000'],
      ['1.001', '9999999999.99'],
    ]) {
      const result = await create(liters, price);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(
      await prisma.fuelEntry.count({ where: { companyId, machineId } }),
    ).toBe(initialCount);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_CREATED' },
      }),
    ).toBe(initialAudit);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: ownProject } })
      ).currentSpend.toString(),
    ).toBe('0');
    const created = await create('0.00100', '5.000');
    expect(created.status).toBe(201);
    expect(created.body.data.liters).toBe('0.001');
    expect(created.body.data.unitPrice).toBe('5');
    expect(created.body.data.totalCost).toBe('0.01');
    const fuelId = created.body.data.id as string;
    const amend = (field: string, newValue: string) =>
      request(app.getHttpServer())
        .post('/api/amendments')
        .set(auth(admin))
        .send({
          entityType: 'FUEL',
          entityId: fuelId,
          field,
          newValue,
          reason: 'precision test',
        });
    const amendmentsBefore = await prisma.amendment.count({
      where: { companyId, entityType: 'FUEL', entityId: fuelId },
    });
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'FUEL_AMENDED', entityId: fuelId },
    });
    for (const [field, value] of [
      ['liters', '0.0005'],
      ['liters', '1000000000'],
      ['unitPrice', '0.001'],
      ['unitPrice', '1e-999999999999999999'],
      ['unitPrice', '10000000000'],
    ]) {
      const result = await amend(field, value);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(
      await prisma.amendment.count({
        where: { companyId, entityType: 'FUEL', entityId: fuelId },
      }),
    ).toBe(amendmentsBefore);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_AMENDED', entityId: fuelId },
      }),
    ).toBe(auditBefore);
    const first = await amend('liters', '2.500');
    expect(first.status).toBe(201);
    const second = await amend('unitPrice', '1.230');
    expect(second.status).toBe(201);
    const after = await prisma.fuelEntry.findUniqueOrThrow({
      where: { id: fuelId },
    });
    expect(after.liters.toString()).toBe('2.5');
    expect(after.unitPrice.toString()).toBe('1.23');
    expect(after.totalCost.toFixed(2)).toBe('3.08');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: ownProject } })
      ).currentSpend.toFixed(2),
    ).toBe('3.08');
    const beforeOverflow = await prisma.amendment.count({
      where: { companyId, entityType: 'FUEL', entityId: fuelId },
    });
    const beforeOverflowAudit = await prisma.auditEvent.count({
      where: { companyId, action: 'FUEL_AMENDED', entityId: fuelId },
    });
    expect((await amend('unitPrice', '9999999999.99')).status).toBe(400);
    expect(
      await prisma.amendment.count({
        where: { companyId, entityType: 'FUEL', entityId: fuelId },
      }),
    ).toBe(beforeOverflow);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_AMENDED', entityId: fuelId },
      }),
    ).toBe(beforeOverflowAudit);
    expect(
      (
        await prisma.fuelEntry.findUniqueOrThrow({ where: { id: fuelId } })
      ).totalCost.toFixed(2),
    ).toBe('3.08');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: ownProject } })
      ).currentSpend.toFixed(2),
    ).toBe('3.08');
    const bound = await create('1', '9999999999.99');
    // Project aggregate has other fuel; use an unassigned entry for column boundary instead.
    expect(bound.status).toBe(409);
    const unassigned = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({ machineId, liters: '1', unitPrice: '9999999999.99' });
    expect(unassigned.status).toBe(201);
    expect(unassigned.body.data.totalCost).toBe('9999999999.99');
  });

  it('rejects foreign and missing fuel amendment projects and rolls back overflowing moves', async () => {
    const createProject = async (name: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/projects')
        .set(auth(admin))
        .send({ name, code: `Q${randomUUID().slice(0, 8)}` });
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    };
    const source = await createProject('Fuel amendment source');
    const target = await createProject('Fuel amendment full target');
    const cap = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        projectId: target,
        category: 'MATERIAL',
        date: '2026-11-05',
        amount: '9999999999.99',
      });
    expect(cap.status).toBe(201);
    const foreignCompany = await prisma.company.create({
      data: { name: 'Foreign fuel project company', slug: `f-${randomUUID()}` },
    });
    const foreign = await prisma.project.create({
      data: {
        companyId: foreignCompany.id,
        name: 'Foreign fuel project',
        geofenceRadius: 100,
      },
    });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Fuel amendment machine', type: 'LOADER' });
    expect(machine.status).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        projectId: source,
        machineId: machine.body.data.id,
        liters: '5',
        unitPrice: '2',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const before = await prisma.amendment.count({
      where: { companyId, entityType: 'FUEL', entityId: fuelId },
    });
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'FUEL_AMENDED', entityId: fuelId },
    });
    for (const [targetId, status] of [
      [foreign.id, 404],
      ['missing-project-id', 404],
      [target, 409],
    ] as const) {
      const result = await request(app.getHttpServer())
        .post('/api/amendments')
        .set(auth(admin))
        .send({
          entityType: 'FUEL',
          entityId: fuelId,
          field: 'projectId',
          newValue: targetId,
          reason: 'correct project',
        });
      expect(result.status).toBe(status);
    }
    expect(
      (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: fuelId } }))
        .projectId,
    ).toBe(source);
    expect(
      await prisma.amendment.count({
        where: { companyId, entityType: 'FUEL', entityId: fuelId },
      }),
    ).toBe(before);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_AMENDED', entityId: fuelId },
      }),
    ).toBe(auditBefore);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: source } })
      ).currentSpend.toFixed(2),
    ).toBe('10.00');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: target } })
      ).currentSpend.toFixed(2),
    ).toBe('9999999999.99');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: foreign.id } })
      ).currentSpend.toFixed(2),
    ).toBe('0.00');
    const clear = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(admin))
      .send({
        entityType: 'FUEL',
        entityId: fuelId,
        field: 'projectId',
        newValue: '',
        reason: 'remove project',
      });
    expect(clear.status).toBe(201);
    expect(
      (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: fuelId } }))
        .projectId,
    ).toBeNull();
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: source } })
      ).currentSpend.toFixed(2),
    ).toBe('0.00');
  });

  it('validates explicit and inherited stock movement projects in the tenant without consuming failed keys', async () => {
    const other = await prisma.company.create({
      data: {
        name: 'Stock foreign project',
        slug: `stock-project-${randomUUID()}`,
      },
    });
    const foreign = await prisma.project.create({
      data: {
        companyId: other.id,
        name: 'Foreign stock project',
        geofenceRadius: 100,
        code: `F${randomUUID().slice(0, 8)}`,
      },
    });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Project scoped warehouse', type: 'SITE', projectId });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Project scoped material', unit: 'L' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const key = randomUUID();
    const body = { warehouseId, materialId, qty: '1', idempotencyKey: key };
    const post = (data: object) =>
      request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send(data);
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'STOCK_MOVEMENT' },
    });
    for (const invalid of [foreign.id, `missing-${randomUUID()}`]) {
      const response = await post({ ...body, projectId: invalid });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect((await post({ ...body, projectId: '' })).status).toBe(400);
    expect(
      await prisma.stockMovement.count({
        where: { companyId, warehouseId, materialId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'STOCK_MOVEMENT' },
      }),
    ).toBe(auditBefore);
    const valid = await post(body);
    expect(valid.status).toBe(201);
    expect(valid.body.data.projectId).toBe(projectId);
    const explicit = await post({
      ...body,
      projectId,
      idempotencyKey: randomUUID(),
    });
    expect(explicit.status).toBe(201);
    expect(explicit.body.data.projectId).toBe(projectId);
    // Simulate historical data outside the current API. Existing retry still replays,
    // but a new request cannot propagate the bad warehouse default.
    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: { projectId: foreign.id },
    });
    const replay = await post(body);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(valid.body.data.id);
    expect(replay.body.data.projectId).toBe(projectId);
    const rejected = await post({ ...body, idempotencyKey: randomUUID() });
    expect(rejected.status).toBe(404);
    expect(
      await prisma.stockMovement.count({
        where: { companyId, warehouseId, materialId },
      }),
    ).toBe(2);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'STOCK_MOVEMENT' },
      }),
    ).toBe(auditBefore + 2);
  });

  it('revalidates stock project tenant after waiting for a concurrent project change', async () => {
    const other = await prisma.company.create({
      data: {
        name: 'Stock lock other company',
        slug: `stock-lock-${randomUUID()}`,
      },
    });
    const project = await prisma.project.create({
      data: { companyId, name: 'Stock lock project', geofenceRadius: 100 },
    });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Stock lock warehouse', type: 'YARD' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Stock lock material', unit: 'L' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${project.id} FOR NO KEY UPDATE`;
        ready();
        await gate;
        await tx.project.update({
          where: { id: project.id },
          data: { companyId: other.id },
        });
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send({
          warehouseId,
          materialId,
          qty: '1',
          projectId: project.id,
          idempotencyKey: randomUUID(),
        })
        .then((response) => response);
      void posting.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'Project', 'FOR SHARE');
      release();
      await holder;
      const result = await posting;
      expect(result.status).toBe(404);
      expect(
        await prisma.stockMovement.count({
          where: { companyId, warehouseId, materialId },
        }),
      ).toBe(0);
    } finally {
      release();
      await Promise.allSettled([holder, posting]);
    }
  });

  async function setupAmendedFuelStock() {
    expect(
      (
        await request(app.getHttpServer())
          .put('/api/settings')
          .set(auth(admin))
          .send({ 'erp.allowNegativeStock': false })
      ).status,
    ).toBe(200);
    const project = await prisma.project.create({
      data: { companyId, name: 'Amended fuel project', geofenceRadius: 100 },
    });
    const target = await prisma.project.create({
      data: { companyId, name: 'Amended fuel target', geofenceRadius: 100 },
    });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Amendment fuel cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Amendment fuel material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Amendment fuel machine', type: 'TRUCK' });
    expect([warehouse.status, material.status, machine.status]).toEqual([
      201, 201, 201,
    ]);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/stock-movements')
          .set(auth(admin))
          .send({ warehouseId, materialId, qty: '10' })
      ).status,
    ).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId: project.id,
        liters: '5',
        unitPrice: '2',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const apply = () =>
      request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId });
    const created = await apply();
    expect(created.status).toBe(201);
    const amend = (field: string, newValue: string) =>
      request(app.getHttpServer())
        .post('/api/amendments')
        .set(auth(admin))
        .send({
          entityType: 'FUEL',
          entityId: fuelId,
          field,
          newValue,
          reason: 'correct fuel stock',
        });
    const balance = async () =>
      (
        await prisma.stockMovement.aggregate({
          where: { companyId, warehouseId, materialId },
          _sum: { qty: true },
        })
      )._sum.qty?.toString();
    return {
      project,
      target,
      warehouseId,
      materialId,
      fuelId,
      movementId: created.body.data.id as string,
      apply,
      amend,
      balance,
    };
  }

  it('adjusts applied fuel liters and project atomically with stock, replay and amendment history', async () => {
    const f = await setupAmendedFuelStock();
    const first = await f.amend('liters', '7');
    expect(first.status).toBe(201);
    expect(first.body.data.oldValue).toBe('5');
    expect(await f.balance()).toBe('3');
    expect(
      (
        await prisma.stockMovement.findUniqueOrThrow({
          where: { id: f.movementId },
        })
      ).qty.toString(),
    ).toBe('-7');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })
      ).currentSpend.toString(),
    ).toBe('14');
    const replay = await f.apply();
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(f.movementId);
    expect(replay.body.data.qty).toBe('-7');
    const second = await f.amend('projectId', f.target.id);
    expect(second.status).toBe(201);
    expect(second.body.data.oldValue).toBe(f.project.id);
    expect((await f.apply()).body.data.projectId).toBe(f.target.id);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })
      ).currentSpend.toString(),
    ).toBe('0');
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
      ).currentSpend.toString(),
    ).toBe('14');
    const before = await prisma.amendment.count({
      where: { companyId, entityType: 'FUEL', entityId: f.fuelId },
    });
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'FUEL_AMENDED', entityId: f.fuelId },
    });
    const rejected = await f.amend('liters', '11');
    expect(rejected.status).toBe(409);
    expect(await f.balance()).toBe('3');
    expect(
      (
        await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } })
      ).liters.toString(),
    ).toBe('7');
    expect(
      await prisma.amendment.count({
        where: { companyId, entityType: 'FUEL', entityId: f.fuelId },
      }),
    ).toBe(before);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_AMENDED', entityId: f.fuelId },
      }),
    ).toBe(auditBefore);
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
      ).currentSpend.toString(),
    ).toBe('14');
    expect((await f.amend('liters', '3')).status).toBe(201);
    expect(await f.balance()).toBe('7');
    expect((await f.amend('projectId', '')).status).toBe(201);
    expect((await f.apply()).body.data.projectId).toBeNull();
    expect(
      (
        await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
      ).currentSpend.toString(),
    ).toBe('0');
    expect(
      await prisma.stockMovement.count({ where: { fuelEntryId: f.fuelId } }),
    ).toBe(1);
  });

  it('allows configured negative stock and rolls back linked project overflow', async () => {
    const f = await setupAmendedFuelStock();
    try {
      expect(
        (
          await request(app.getHttpServer())
            .put('/api/settings')
            .set(auth(admin))
            .send({ 'erp.allowNegativeStock': true })
        ).status,
      ).toBe(200);
      expect((await f.amend('liters', '11')).status).toBe(201);
      expect(await f.balance()).toBe('-1');
      expect(
        (
          await prisma.stockMovement.findUniqueOrThrow({
            where: { id: f.movementId },
          })
        ).qty.toString(),
      ).toBe('-11');
      expect(
        (
          await request(app.getHttpServer())
            .put('/api/settings')
            .set(auth(admin))
            .send({ 'erp.allowNegativeStock': false })
        ).status,
      ).toBe(200);
      expect((await f.amend('liters', '10.5')).status).toBe(201);
      expect(await f.balance()).toBe('-0.5');
      const cap = await request(app.getHttpServer())
        .post('/api/cost-entries')
        .set(auth(admin))
        .send({
          projectId: f.target.id,
          category: 'MATERIAL',
          date: '2026-11-05',
          amount: '9999999999.99',
        });
      expect(cap.status).toBe(201);
      const count = await prisma.amendment.count({
        where: { entityType: 'FUEL', entityId: f.fuelId },
      });
      const auditCount = await prisma.auditEvent.count({
        where: { companyId, action: 'FUEL_AMENDED', entityId: f.fuelId },
      });
      expect((await f.amend('projectId', f.target.id)).status).toBe(409);
      expect(
        (
          await prisma.stockMovement.findUniqueOrThrow({
            where: { id: f.movementId },
          })
        ).projectId,
      ).toBe(f.project.id);
      expect(
        (await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } }))
          .projectId,
      ).toBe(f.project.id);
      expect(
        await prisma.amendment.count({
          where: { entityType: 'FUEL', entityId: f.fuelId },
        }),
      ).toBe(count);
      expect(
        await prisma.auditEvent.count({
          where: { companyId, action: 'FUEL_AMENDED', entityId: f.fuelId },
        }),
      ).toBe(auditCount);
      expect(
        (
          await prisma.project.findUniqueOrThrow({
            where: { id: f.project.id },
          })
        ).currentSpend.toString(),
      ).toBe('21');
      expect(
        (
          await prisma.project.findUniqueOrThrow({ where: { id: f.target.id } })
        ).currentSpend.toFixed(2),
      ).toBe('9999999999.99');
    } finally {
      await request(app.getHttpServer())
        .put('/api/settings')
        .set(auth(admin))
        .send({ 'erp.allowNegativeStock': false });
    }
  });

  it('serializes a concurrent apply-stock before the fuel amendment', async () => {
    const project = await prisma.project.create({
      data: {
        companyId,
        name: 'Concurrent apply amend project',
        geofenceRadius: 100,
      },
    });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Concurrent apply amend cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Concurrent apply amend material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Concurrent apply amend machine', type: 'TRUCK' });
    expect([warehouse.status, material.status, machine.status]).toEqual([
      201, 201, 201,
    ]);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/stock-movements')
          .set(auth(admin))
          .send({ warehouseId, materialId, qty: '10' })
      ).status,
    ).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId: project.id,
        liters: '5',
        unitPrice: '2',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${project.id} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let applying: Promise<request.Response> | undefined;
    let amendment: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      applying = request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId })
        .then((r) => r);
      void applying.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'Project', 'FOR SHARE');
      amendment = request(app.getHttpServer())
        .post('/api/amendments')
        .set(auth(admin))
        .send({
          entityType: 'FUEL',
          entityId: fuelId,
          field: 'liters',
          newValue: '7',
          reason: 'correct concurrently',
        })
        .then((r) => r);
      void amendment.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'FuelEntry', 'FOR NO KEY UPDATE');
      release();
      await holder;
      expect((await applying).status).toBe(201);
      expect((await amendment).status).toBe(201);
      const row = await prisma.stockMovement.findUniqueOrThrow({
        where: { fuelEntryId: fuelId },
      });
      expect(row.qty.toString()).toBe('-7');
      expect(
        (
          await prisma.fuelEntry.findUniqueOrThrow({ where: { id: fuelId } })
        ).liters.toString(),
      ).toBe('7');
      expect(
        (
          await prisma.stockMovement.aggregate({
            where: { companyId, warehouseId, materialId },
            _sum: { qty: true },
          })
        )._sum.qty?.toString(),
      ).toBe('3');
      expect(
        (
          await prisma.project.findUniqueOrThrow({ where: { id: project.id } })
        ).currentSpend.toString(),
      ).toBe('14');
    } finally {
      release();
      await Promise.allSettled([holder, applying, amendment]);
    }
  });

  it('fails closed on inconsistent or foreign stock links but permits unrelated amendments', async () => {
    const f = await setupAmendedFuelStock();
    const before = await prisma.amendment.count({
      where: { entityType: 'FUEL', entityId: f.fuelId },
    });
    await prisma.stockMovement.update({
      where: { id: f.movementId },
      data: { qty: '-4' },
    });
    expect((await f.amend('liters', '6')).status).toBe(409);
    expect((await f.amend('projectId', f.target.id)).status).toBe(409);
    expect(
      await prisma.amendment.count({
        where: { entityType: 'FUEL', entityId: f.fuelId },
      }),
    ).toBe(before);
    expect(
      (
        await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } })
      ).liters.toString(),
    ).toBe('5');
    expect((await f.amend('notes', 'document only')).status).toBe(201);
    await prisma.stockMovement.update({
      where: { id: f.movementId },
      data: { qty: '-5' },
    });
    const other = await prisma.company.create({
      data: {
        name: 'Amendment foreign',
        slug: `amend-foreign-${randomUUID()}`,
      },
    });
    await prisma.stockMovement.update({
      where: { id: f.movementId },
      data: { companyId: other.id },
    });
    expect((await f.amend('liters', '6')).status).toBe(409);
    expect(
      (
        await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } })
      ).liters.toString(),
    ).toBe('5');
    expect(
      (
        await prisma.stockMovement.findUniqueOrThrow({
          where: { id: f.movementId },
        })
      ).companyId,
    ).toBe(other.id);
  });

  it('serializes fuel amendments against competing stock consumption', async () => {
    const f = await setupAmendedFuelStock();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${f.project.id} FOR NO KEY UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let amendment: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      amendment = f.amend('liters', '8').then((response) => response);
      void amendment.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'Project', 'FOR NO KEY UPDATE');
      const competing = await request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send({
          warehouseId: f.warehouseId,
          materialId: f.materialId,
          qty: '-4',
        });
      expect(competing.status).toBe(201);
      release();
      await holder;
      expect((await amendment).status).toBe(409);
      expect(await f.balance()).toBe('1');
      expect(
        (
          await prisma.fuelEntry.findUniqueOrThrow({ where: { id: f.fuelId } })
        ).liters.toString(),
      ).toBe('5');
      expect(
        (
          await prisma.stockMovement.findUniqueOrThrow({
            where: { id: f.movementId },
          })
        ).qty.toString(),
      ).toBe('-5');
      expect(
        await prisma.amendment.count({
          where: { companyId, entityType: 'FUEL', entityId: f.fuelId },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.project.findUniqueOrThrow({
            where: { id: f.project.id },
          })
        ).currentSpend.toString(),
      ).toBe('10');
    } finally {
      release();
      await Promise.allSettled([holder, amendment]);
    }
  });

  it('apply-stock serializes concurrent retries at the exact available balance', async () => {
    const setting = await request(app.getHttpServer())
      .put('/api/settings')
      .set(auth(admin))
      .send({ 'erp.allowNegativeStock': false });
    expect(setting.status).toBe(200);
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Exact fuel balance cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Exact fuel balance material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Exact fuel balance machine', type: 'TRUCK' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    expect(machine.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const inbound = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({ warehouseId, materialId, qty: '7' });
    expect(inbound.status).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '7',
        unitPrice: '1',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'STOCK_MOVEMENT' },
    });
    const apply = () =>
      request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId });
    const responses = await Promise.all([apply(), apply(), apply()]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const ids = responses.map((r) => r.body.data.id as string);
    expect(new Set(ids).size).toBe(1);
    expect(responses[0].body.data.qty).toBe('-7');
    const balance = await prisma.stockMovement.aggregate({
      where: { companyId, warehouseId, materialId },
      _sum: { qty: true },
    });
    expect(balance._sum.qty?.toString()).toBe('0');
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'STOCK_MOVEMENT' },
      }),
    ).toBe(auditBefore + 1);
  });

  it('apply-stock waits for fuel edits and uses the committed liters and tenant project', async () => {
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Fuel lock cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Fuel lock material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Fuel lock machine', type: 'TRUCK' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    expect(machine.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/stock-movements')
          .set(auth(admin))
          .send({ warehouseId, materialId, qty: '30' })
      ).status,
    ).toBe(201);
    const target = await prisma.project.create({
      data: { companyId, name: 'Fuel apply target', geofenceRadius: 100 },
    });
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '5',
        unitPrice: '1',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "FuelEntry" WHERE "id" = ${fuelId} FOR NO KEY UPDATE`;
        await tx.fuelEntry.update({
          where: { id: fuelId },
          data: { liters: '9', totalCost: '9', projectId: target.id },
        });
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId })
        .then((response) => response);
      void posting.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'FuelEntry', 'FOR SHARE');
      release();
      await holder;
      const result = await posting;
      expect(result.status).toBe(201);
      expect(result.body.data.qty).toBe('-9');
      expect(result.body.data.projectId).toBe(target.id);
      const balance = await prisma.stockMovement.aggregate({
        where: { companyId, warehouseId, materialId },
        _sum: { qty: true },
      });
      expect(balance._sum.qty?.toString()).toBe('21');
    } finally {
      release();
      await Promise.allSettled([holder, posting]);
    }
  });

  it('apply-stock replays a committed movement after a lost response, even with changed payload', async () => {
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Fuel lost response cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Fuel lost response material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Fuel lost response machine', type: 'TRUCK' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    expect(machine.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/stock-movements')
          .set(auth(admin))
          .send({ warehouseId, materialId, qty: '5' })
      ).status,
    ).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '5',
        unitPrice: '1',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const post = (body: { warehouseId: string; materialId: string }) =>
      request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send(body);
    const audit = jest
      .spyOn(app.get(AuditService), 'write')
      .mockRejectedValueOnce(
        new Error('simulated fuel stock post-commit failure'),
      );
    try {
      expect((await post({ warehouseId, materialId })).status).toBe(500);
      const replay = await post({
        warehouseId: 'different-warehouse',
        materialId: 'different-material',
      });
      expect(replay.status).toBe(200);
      expect(replay.body.data.warehouseId).toBe(warehouseId);
      expect(replay.body.data.materialId).toBe(materialId);
      expect(
        await prisma.stockMovement.count({
          where: { companyId, fuelEntryId: fuelId },
        }),
      ).toBe(1);
      expect(audit).toHaveBeenCalledTimes(1);
    } finally {
      audit.mockRestore();
    }
  });

  it('apply-stock rolls back when the locked project changes tenant before commit', async () => {
    const other = await prisma.company.create({
      data: { name: 'Fuel race foreign', slug: `fuel-race-${randomUUID()}` },
    });
    const target = await prisma.project.create({
      data: { companyId, name: 'Fuel race project', geofenceRadius: 100 },
    });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Fuel project race cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Fuel project race material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Fuel project race machine', type: 'TRUCK' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    expect(machine.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/stock-movements')
          .set(auth(admin))
          .send({ warehouseId, materialId, qty: '5' })
      ).status,
    ).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId: target.id,
        liters: '5',
        unitPrice: '1',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const auditBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'STOCK_MOVEMENT' },
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${target.id} FOR NO KEY UPDATE`;
        await tx.project.update({
          where: { id: target.id },
          data: { companyId: other.id },
        });
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let posting: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      posting = request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId })
        .then((response) => response);
      void posting.catch(() => undefined);
      await waitForCostProjectLock(prisma, 1, 'Project', 'FOR SHARE');
      release();
      await holder;
      expect((await posting).status).toBe(404);
      expect(
        await prisma.stockMovement.count({
          where: { companyId, fuelEntryId: fuelId },
        }),
      ).toBe(0);
      expect(
        await prisma.auditEvent.count({
          where: { companyId, action: 'STOCK_MOVEMENT' },
        }),
      ).toBe(auditBefore);
      const balance = await prisma.stockMovement.aggregate({
        where: { companyId, warehouseId, materialId },
        _sum: { qty: true },
      });
      expect(balance._sum.qty?.toString()).toBe('5');
    } finally {
      release();
      await Promise.allSettled([holder, posting]);
    }
  });

  it('apply-stock rejects a legacy foreign fuel project but replays an existing movement', async () => {
    const other = await prisma.company.create({
      data: { name: 'Fuel apply foreign', slug: `fuel-apply-${randomUUID()}` },
    });
    const foreign = await prisma.project.create({
      data: {
        companyId: other.id,
        name: 'Fuel apply foreign project',
        geofenceRadius: 100,
      },
    });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Foreign fuel cistern', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Foreign fuel material', unit: 'L' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Foreign fuel machine', type: 'TRUCK' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    expect(machine.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/stock-movements')
          .set(auth(admin))
          .send({ warehouseId, materialId, qty: '5' })
      ).status,
    ).toBe(201);
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '5',
        unitPrice: '1',
      });
    expect(fuel.status).toBe(201);
    const fuelId = fuel.body.data.id as string;
    const apply = () =>
      request(app.getHttpServer())
        .post(`/api/fuel/${fuelId}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId });
    await prisma.fuelEntry.update({
      where: { id: fuelId },
      data: { projectId: foreign.id },
    });
    expect((await apply()).status).toBe(404);
    expect(
      await prisma.stockMovement.count({
        where: { companyId, fuelEntryId: fuelId },
      }),
    ).toBe(0);
    await prisma.fuelEntry.update({
      where: { id: fuelId },
      data: { projectId },
    });
    const created = await apply();
    expect(created.status).toBe(201);
    await prisma.fuelEntry.update({
      where: { id: fuelId },
      data: { projectId: foreign.id },
    });
    const replay = await apply();
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(replay.body.data.projectId).toBe(projectId);
    expect(
      await prisma.stockMovement.count({
        where: { companyId, fuelEntryId: fuelId },
      }),
    ).toBe(1);
  });

  it('TRUCK warehouse 400; apply-stock idempotent; negative 409 then flag 201', async () => {
    const truck = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Truck', type: 'TRUCK' });
    expect(truck.status).toBe(400);
    const cistern = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Cisterna', type: 'CISTERN' });
    expect(cistern.status).toBe(201);
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Dizel', unit: 'L' });
    const warehouseId = cistern.body.data.id as string;
    const materialId = material.body.data.id as string;
    const minus = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({ warehouseId, materialId, qty: '-5' });
    expect(minus.status).toBe(409);
    const inbound = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({ warehouseId, materialId, qty: '100' });
    expect(inbound.status).toBe(201);
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'ERP cistern', type: 'TRUCK' });
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '10',
        unitPrice: '1.00',
      });
    const first = await request(app.getHttpServer())
      .post(`/api/fuel/${fuel.body.data.id}/apply-stock`)
      .set(auth(admin))
      .send({ warehouseId, materialId });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer())
      .post(`/api/fuel/${fuel.body.data.id}/apply-stock`)
      .set(auth(admin))
      .send({ warehouseId, materialId });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    await request(app.getHttpServer())
      .put('/api/settings')
      .set(auth(admin))
      .send({ 'erp.allowNegativeStock': true });
    const empty = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Empty cistern', type: 'CISTERN' });
    const allowed = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({ warehouseId: empty.body.data.id, materialId, qty: '-1' });
    expect(allowed.status).toBe(201);
  });

  it('validates stock numeric(12,3) exactly while replaying old rounded keyed rows', async () => {
    const setting = await request(app.getHttpServer())
      .put('/api/settings')
      .set(auth(admin))
      .send({ 'erp.allowNegativeStock': false });
    expect(setting.status).toBe(200);
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Exact stock precision warehouse', type: 'YARD' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Exact stock precision material', unit: 'L' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const post = (qty: string, idempotencyKey?: string) =>
      request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send({
          warehouseId,
          materialId,
          qty,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });

    // Exactly representable quantities retain their value, including trailing zeroes and exponents.
    for (const qty of [
      '0.001000',
      '-1e-3',
      '999999999.999',
      '-999999999.999',
    ]) {
      const result = await post(qty, randomUUID());
      expect(result.status).toBe(201);
      expect(result.body.data.qty).toBe(new Prisma.Decimal(qty).toString());
    }
    const before = await prisma.stockMovement.count({
      where: { companyId, warehouseId, materialId },
    });
    expect(before).toBe(4);
    const auditsBefore = await prisma.auditEvent.count({
      where: { companyId, action: 'STOCK_MOVEMENT' },
    });
    for (const qty of [
      '0.0001',
      '0.0005',
      '-0.0005',
      '1e-4',
      '999999999.9999',
      '1000000000',
      '-1000000000',
      '1e-999999999999999999',
    ]) {
      for (const key of [undefined, randomUUID()]) {
        const result = await post(qty, key);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('VALIDATION_FAILED');
      }
    }
    expect(
      await prisma.stockMovement.count({
        where: { companyId, warehouseId, materialId },
      }),
    ).toBe(before);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'STOCK_MOVEMENT' },
      }),
    ).toBe(auditsBefore);

    // Emulate an old server: fingerprint is original 0.0005, DB stored rounded 0.001.
    const key = randomUUID();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([warehouseId, materialId, '0.0005', null]))
      .digest('hex');
    const legacy = await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId,
        materialId,
        qty: '0.001',
        idempotencyKey: key,
        requestFingerprint: fingerprint,
      },
    });
    const replay = await post('0.0005000', key);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(legacy.id);
    expect(replay.body.data.qty).toBe('0.001');
    const conflict = await post('0.001', key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('CONFLICT');
    const fresh = await post('0.0005', randomUUID());
    expect(fresh.status).toBe(400);
    expect(
      await prisma.stockMovement.count({
        where: { companyId, warehouseId, materialId },
      }),
    ).toBe(before + 1);
    expect(
      await prisma.auditEvent.count({
        where: { companyId, action: 'STOCK_MOVEMENT' },
      }),
    ).toBe(auditsBefore);
  });

  it('keyed movement replays after concurrent requests, before the negative-balance check', async () => {
    const setting = await request(app.getHttpServer())
      .put('/api/settings')
      .set(auth(admin))
      .send({ 'erp.allowNegativeStock': false });
    expect(setting.status).toBe(200);
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Idempotent movement warehouse', type: 'YARD' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Idempotent movement material', unit: 'L' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const seed = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({ warehouseId, materialId, qty: '10' });
    expect(seed.status).toBe(201);
    const key = randomUUID();
    const body = { warehouseId, materialId, qty: '-7', idempotencyKey: key };
    const post = (payload: object) =>
      request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send(payload);
    const results = await Promise.all([post(body), post(body)]);
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect(results[0].body.data).not.toHaveProperty('idempotencyKey');
    expect(results[0].body.data).not.toHaveProperty('requestFingerprint');
    const replay = await post({
      ...body,
      qty: '-7.000',
      idempotencyKey: key.toUpperCase(),
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(results[0].body.data.id);
    const conflict = await post({ ...body, qty: '-6' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('CONFLICT');
    const projectConflict = await post({ ...body, projectId });
    expect(projectConflict.status).toBe(409);
    const denied = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(worker))
      .send(body);
    expect(denied.status).toBe(403);
    const invalidKey = await post({ ...body, idempotencyKey: 'not-a-uuid' });
    expect(invalidKey.status).toBe(400);
    const movements = await prisma.stockMovement.findMany({
      where: { companyId, warehouseId, materialId },
    });
    expect(movements).toHaveLength(2);
    const balance = await request(app.getHttpServer())
      .get('/api/stock')
      .set(auth(admin));
    const item = (
      balance.body.data as Array<{
        warehouseId: string;
        materialId: string;
        qty: string;
      }>
    ).find(
      (row) => row.warehouseId === warehouseId && row.materialId === materialId,
    );
    expect(item?.qty).toBe('3');
    const audit = await prisma.auditEvent.count({
      where: {
        companyId,
        action: 'STOCK_MOVEMENT',
        entityId: results[0].body.data.id as string,
      },
    });
    expect(audit).toBe(1);
  });

  it('same key with concurrently different payloads cannot create two movements', async () => {
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Fingerprint race warehouse', type: 'YARD' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Fingerprint race material', unit: 'L' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const idempotencyKey = randomUUID();
    const post = (qty: string) =>
      request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send({ warehouseId, materialId, qty, idempotencyKey });
    const result = await Promise.all([post('5'), post('6')]);
    expect(result.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      await prisma.stockMovement.count({
        where: { companyId, warehouseId, materialId },
      }),
    ).toBe(1);
  });

  it('a lost post-commit response can be replayed with the same key', async () => {
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Lost response warehouse', type: 'YARD' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Lost response material', unit: 'L' });
    expect(warehouse.status).toBe(201);
    expect(material.status).toBe(201);
    const warehouseId = warehouse.body.data.id as string;
    const materialId = material.body.data.id as string;
    const body = {
      warehouseId,
      materialId,
      qty: '0.001',
      idempotencyKey: randomUUID(),
    };
    const post = () =>
      request(app.getHttpServer())
        .post('/api/stock-movements')
        .set(auth(admin))
        .send(body);
    const audit = jest
      .spyOn(app.get(AuditService), 'write')
      .mockRejectedValueOnce(new Error('simulated post-commit failure'));
    try {
      const first = await post();
      expect(first.status).toBe(500);
      const replay = await post();
      expect(replay.status).toBe(201);
      expect(
        await prisma.stockMovement.count({
          where: { companyId, warehouseId, materialId },
        }),
      ).toBe(1);
      expect(audit).toHaveBeenCalledTimes(1);
    } finally {
      audit.mockRestore();
    }
  });

  it('same movement key is independently scoped to each company', async () => {
    const other = await prisma.company.create({
      data: { name: 'Movement isolation', slug: `movement-${randomUUID()}` },
    });
    const platform = await login(app, 'platform@gradix.local');
    expect(platform.status).toBe(200);
    const platformAuth = auth(platform.body.data.accessToken as string);
    const wh = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(platformAuth)
      .set('X-Company-Id', other.id)
      .send({ name: 'Other warehouse', type: 'YARD' });
    const mat = await request(app.getHttpServer())
      .post('/api/materials')
      .set(platformAuth)
      .set('X-Company-Id', other.id)
      .send({ name: 'Other material', unit: 'L' });
    const localWh = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Local warehouse', type: 'YARD' });
    const localMat = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Local material', unit: 'L' });
    expect([wh.status, mat.status, localWh.status, localMat.status]).toEqual([
      201, 201, 201, 201,
    ]);
    const idempotencyKey = randomUUID();
    const local = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({
        warehouseId: localWh.body.data.id,
        materialId: localMat.body.data.id,
        qty: '1',
        idempotencyKey,
      });
    const remote = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(platformAuth)
      .set('X-Company-Id', other.id)
      .send({
        warehouseId: wh.body.data.id,
        materialId: mat.body.data.id,
        qty: '2',
        idempotencyKey,
      });
    expect([local.status, remote.status]).toEqual([201, 201]);
    expect(local.body.data.id).not.toBe(remote.body.data.id);
    expect(
      await prisma.stockMovement.count({ where: { idempotencyKey } }),
    ).toBe(2);
  });

  it('F-03: brisanje troška ostavlja COST_ENTRY_REMOVED trag i vraća spend', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    const spendBefore = Number(before.body.data.currentSpend);
    const created = await request(app.getHttpServer())
      .post('/api/cost-entries')
      .set(auth(admin))
      .send({
        amount: '40.00',
        category: 'MATERIAL',
        date: '2024-04-01',
        projectId,
      });
    expect(created.status).toBe(201);
    const costId = created.body.data.id as string;
    const afterCreate = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    expect(Number(afterCreate.body.data.currentSpend)).toBe(spendBefore + 40);
    const removed = await request(app.getHttpServer())
      .delete(`/api/cost-entries/${costId}`)
      .set(auth(admin));
    expect(removed.status).toBe(204);
    const audit = await prisma.auditEvent.findFirst({
      where: {
        companyId,
        action: 'COST_ENTRY_REMOVED',
        entityId: costId,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.payload).toMatchObject({
      amount: '40.00',
      category: 'MATERIAL',
      projectId,
    });
    const afterRemove = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    expect(Number(afterRemove.body.data.currentSpend)).toBe(spendBefore);
  });

  it('F-04: partneri i skladišta ostavljaju audit trag', async () => {
    const partner = await request(app.getHttpServer())
      .post('/api/partners')
      .set(auth(admin))
      .send({ type: 'SUPPLIER', name: 'Dobavljač audit' });
    expect(partner.status).toBe(201);
    await request(app.getHttpServer())
      .patch(`/api/partners/${partner.body.data.id as string}`)
      .set(auth(admin))
      .send({ note: 'izmijenjeno' });
    const warehouse = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Magacin audit', type: 'YARD' });
    expect(warehouse.status).toBe(201);
    const partnerAudit = await prisma.auditEvent.findMany({
      where: {
        companyId,
        entityType: 'Partner',
        entityId: partner.body.data.id as string,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(partnerAudit.map((row) => row.action)).toEqual([
      'PARTNER_CREATED',
      'PARTNER_UPDATED',
    ]);
    const warehouseAudit = await prisma.auditEvent.findFirst({
      where: {
        companyId,
        action: 'WAREHOUSE_CREATED',
        entityId: warehouse.body.data.id as string,
      },
    });
    expect(warehouseAudit).not.toBeNull();
  });

  it('F-02: paralelni apply-stock ne pada na unique i ne duplira pokret', async () => {
    const cistern = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(auth(admin))
      .send({ name: 'Cistern race', type: 'CISTERN' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Dizel race', unit: 'L' });
    const warehouseId = cistern.body.data.id as string;
    const materialId = material.body.data.id as string;
    await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(auth(admin))
      .send({ warehouseId, materialId, qty: '100' });
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Race cistern', type: 'TRUCK' });
    const fuel = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({
        machineId: machine.body.data.id,
        projectId,
        liters: '7',
        unitPrice: '1.00',
      });
    const apply = () =>
      request(app.getHttpServer())
        .post(`/api/fuel/${fuel.body.data.id}/apply-stock`)
        .set(auth(admin))
        .send({ warehouseId, materialId });
    const results = await Promise.all([apply(), apply(), apply()]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 200, 201]);
    const movements = await prisma.stockMovement.count({
      where: { companyId, fuelEntryId: fuel.body.data.id as string },
    });
    expect(movements).toBe(1);
  });
});

/** Observe database lock waits without logging SQL parameters or credentials. */
async function waitForCostProjectLock(
  prisma: PrismaService,
  minimum: number,
  table: 'Project' | 'FuelEntry' | 'ServiceRecord' = 'Project',
  lock = 'FOR NO KEY UPDATE',
): Promise<void> {
  const pattern = `%FROM "${table}"%${lock}%`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::integer AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE ${pattern}`;
    if (rows[0].waiting >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected spend lock wait did not occur');
}
