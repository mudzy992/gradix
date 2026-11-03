import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';

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
