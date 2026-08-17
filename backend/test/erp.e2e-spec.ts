import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('Phase 10 erp-lite (e2e)', () => {
  let app: INestApplication<App>;
  let admin: string;
  let worker: string;
  let accountant: string;
  let projectId: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    accountant = (await login(app, 'accountant@gradix.local')).body.data.accessToken;
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(admin));
    companyId = me.body.data.company.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({ name: `ERP ${Date.now()}`, code: `ER${Date.now().toString().slice(-6)}`, client: 'JP Ceste' });
    projectId = created.body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('ACC read, ADMIN write, WORKER 403; client string without partner', async () => {
    const workerList = await request(app.getHttpServer()).get('/api/partners').set(auth(worker));
    expect(workerList.status).toBe(403);
    const accList = await request(app.getHttpServer()).get('/api/partners').set(auth(accountant));
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
      .send({ machineId: machine.body.data.id, projectId, liters: '10', unitPrice: '2.50' });
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
      .send({ machineId: machine.body.data.id, projectId, liters: '10', unitPrice: '1.00' });
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
});
