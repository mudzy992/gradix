import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('decimal scale through HTTP and PostgreSQL', () => {
  let app: INestApplication<App>;
  let admin: string;
  let driver: string;
  let project: string;
  let machine: string;
  let material: string;
  let quantity: string;
  let tender: string;
  let adminId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    driver = (await login(app, 'driver@gradix.local')).body.data.accessToken;
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(admin));
    adminId = me.body.data.id as string;
    const driverId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(driver))
    ).body.data.id as string;
    const p = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({ name: 'Decimal scale e2e' });
    expect(p.status).toBe(201);
    project = p.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${project}/assignments`)
      .set(auth(admin))
      .send({ userId: driverId, role: 'DRIVER' });
    const m = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Decimal scale truck', type: 'TRUCK' });
    expect(m.status).toBe(201);
    machine = m.body.data.id as string;
    const mat = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Decimal scale gravel', unit: 'M3' });
    expect(mat.status).toBe(201);
    material = mat.body.data.id as string;
    const q = await request(app.getHttpServer())
      .post(`/api/projects/${project}/quantities`)
      .set(auth(admin))
      .send({ name: 'Quantity', unit: 'M3', plannedQty: '1' });
    expect(q.status).toBe(201);
    quantity = q.body.data.id as string;
    const t = await request(app.getHttpServer())
      .post('/api/tenders')
      .set(auth(admin))
      .send({ title: 'Decimal scale tender', client: 'Client' });
    expect(t.status).toBe(201);
    tender = t.body.data.id as string;
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    [
      'project create budget',
      'post',
      '/api/projects',
      { name: 'Bad budget', plannedBudget: '0.001' },
    ],
    [
      'project create lat',
      'post',
      '/api/projects',
      { name: 'Bad lat', lat: '0.00000001' },
    ],
    [
      'project create lng',
      'post',
      '/api/projects',
      { name: 'Bad lng', lng: '0.00000001' },
    ],
    [
      'project patch budget',
      'patch',
      '/api/projects/:project',
      { plannedBudget: '0.001' },
    ],
    [
      'project patch lat',
      'patch',
      '/api/projects/:project',
      { lat: '0.00000001' },
    ],
    [
      'project patch lng',
      'patch',
      '/api/projects/:project',
      { lng: '0.00000001' },
    ],
    [
      'quantity create planned',
      'post',
      '/api/projects/:project/quantities',
      { name: 'Bad qty', unit: 'M3', plannedQty: '1.0001' },
    ],
    [
      'quantity create executed',
      'post',
      '/api/projects/:project/quantities',
      { name: 'Bad qty', unit: 'M3', plannedQty: '1', executedQty: '1.0001' },
    ],
    [
      'quantity patch planned',
      'patch',
      '/api/projects/:project/quantities/:quantity',
      { plannedQty: '1.0001' },
    ],
    [
      'quantity patch executed',
      'patch',
      '/api/projects/:project/quantities/:quantity',
      { executedQty: '1.0001' },
    ],
    [
      'tender create',
      'post',
      '/api/tenders',
      { title: 'Bad', client: 'X', submittedValue: '1.001' },
    ],
    [
      'tender patch',
      'patch',
      '/api/tenders/:tender',
      { submittedValue: '1.001' },
    ],
    ['user patch rate', 'patch', '/api/users/:admin', { hourlyRate: '1.001' }],
    [
      'location lat',
      'post',
      '/api/locations/me',
      { lat: '43.00000001', lng: '18' },
    ],
    [
      'location lng',
      'post',
      '/api/locations/me',
      { lat: '43', lng: '18.00000001' },
    ],
    [
      'location accuracy',
      'post',
      '/api/locations/me',
      { lat: '43', lng: '18', accuracyM: '1.001' },
    ],
    [
      'diary minimum',
      'post',
      '/api/diary',
      { projectId: ':project', date: '2025-01-01', tempMin: '1.01' },
    ],
    [
      'diary maximum',
      'post',
      '/api/diary',
      { projectId: ':project', date: '2025-01-01', tempMax: '1.01' },
    ],
  ] as const)(
    '%s refuses excess decimal scale with 400',
    async (_name, method, rawPath, rawBody) => {
      const path = rawPath
        .replace(':project', project)
        .replace(':quantity', quantity)
        .replace(':tender', tender)
        .replace(':admin', adminId);
      const body = JSON.parse(
        JSON.stringify(rawBody).replace(':project', project),
      ) as object;
      const res = await request(app.getHttpServer())
        [method](path)
        .set(auth(admin))
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.message).toMatch(/decimal places|without rounding/);
    },
  );
  it.each(['quantity', 'weighQty'] as const)(
    'trip %s is strict, without silent PG rounding',
    async (field) => {
      const res = await request(app.getHttpServer())
        .post('/api/trips')
        .set(auth(driver))
        .send({
          projectId: project,
          machineId: machine,
          materialId: material,
          originText: 'Site',
          quantity: '1',
          [field]: '1.0001',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.message).toMatch(/3 decimal places/);
    },
  );
  it('accepts trailing zeros on trip quantity and returns a decimal string', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/trips')
      .set(auth(driver))
      .send({
        projectId: project,
        machineId: machine,
        materialId: material,
        originText: 'Site',
        quantity: '1.0000',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.quantity).toBe('1');
  });
  it('OpenAPI explains the decimal scale and batch contract', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info.description).toContain('trip quantity/weighQty');
    expect(res.body.info.description).toContain(
      'before processing any sync batch items',
    );
  });
  it('sync batch rejects excess scale before processing with the standard 400 envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(driver))
      .send({
        items: [
          {
            type: 'TRIP',
            localId: 'scale-test-1',
            deviceId: 'device-1',
            payload: { quantity: '1.0001' },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'quantity must have at most 3 decimal places',
    });
  });
});
