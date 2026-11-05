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
    const uniqueSource = `source-${randomUUID()}`;
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
  table: 'Project' | 'FuelEntry' = 'Project',
): Promise<void> {
  const pattern = `%FROM "${table}"%FOR NO KEY UPDATE%`;
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
