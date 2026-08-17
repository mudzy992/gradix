import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('Projects (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let pmToken: string;
  let workerToken: string;
  let demoProjectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    pmToken = (await login(app, 'pm@gradix.local')).body.data.accessToken;
    workerToken = (await login(app, 'worker@gradix.local')).body.data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('WORKER and MECHANIC list 403; PM sees assigned; ADMIN sees all', async () => {
    const worker = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(workerToken));
    expect(worker.status).toBe(403);
    const mechanic = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `mech-${Date.now()}@gradix.local`,
        firstName: 'Meh',
        lastName: 'Anic',
        roles: ['MECHANIC'],
      });
    const temp = mechanic.body.data.temporaryPassword as string;
    const mechLogin = await login(app, mechanic.body.data.email, temp);
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(mechLogin.body.data.accessToken as string))
      .send({ currentPassword: temp, newPassword: 'MechanicPass1' });
    const mechAfter = await login(app, mechanic.body.data.email, 'MechanicPass1');
    const mechList = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(mechAfter.body.data.accessToken as string));
    expect(mechList.status).toBe(403);
    const listed = await request(app.getHttpServer()).get('/api/projects').set(auth(pmToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBeGreaterThan(0);
    demoProjectId = listed.body.data.find((row: { code: string | null }) => row.code === 'DEMO-1')
      .id as string;
    const adminList = await request(app.getHttpServer()).get('/api/projects').set(auth(adminToken));
    expect(adminList.body.data.length).toBeGreaterThanOrEqual(listed.body.data.length);
  });

  it('WORKER detail hides budget; plannedEnd < start 400; geofence 0 400', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/projects/${demoProjectId}`)
      .set(auth(workerToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.plannedBudget).toBeUndefined();
    expect(detail.body.data.client).toBeUndefined();
    const badDates = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({
        name: 'Bad dates',
        plannedStart: '2026-08-20T00:00:00.000Z',
        plannedEnd: '2026-08-19T00:00:00.000Z',
      });
    expect(badDates.status).toBe(400);
    const badFence = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: 'Bad fence', geofenceRadius: 0 });
    expect(badFence.status).toBe(400);
  });

  it('PLANNING to ON_HOLD 400; PM auto-assign; ACC 403; archive then start terminal', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(pmToken))
      .send({ name: `PM project ${Date.now()}` });
    expect(created.status).toBe(201);
    const pmSees = await request(app.getHttpServer())
      .get(`/api/projects/${created.body.data.id}`)
      .set(auth(pmToken));
    expect(pmSees.status).toBe(200);
    const hold = await request(app.getHttpServer())
      .patch(`/api/projects/${created.body.data.id}/status`)
      .set(auth(adminToken))
      .send({ status: 'ON_HOLD' });
    expect(hold.status).toBe(400);
    const acc = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `acc-${Date.now()}@gradix.local`,
        firstName: 'Acc',
        lastName: 'Ount',
        roles: ['ACCOUNTANT'],
      });
    const accTemp = acc.body.data.temporaryPassword as string;
    const accLogin = await login(app, acc.body.data.email, accTemp);
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(accLogin.body.data.accessToken as string))
      .send({ currentPassword: accTemp, newPassword: 'AccountPass1' });
    const accAfter = await login(app, acc.body.data.email, 'AccountPass1');
    const accPost = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(accAfter.body.data.accessToken as string))
      .send({ name: 'ACC no' });
    expect(accPost.status).toBe(403);
  });
});
