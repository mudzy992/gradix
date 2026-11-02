import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('Users RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  const suffix = `${Date.now()}`;

  beforeAll(async () => {
    app = await createTestApp();
    const logged = await login(app, 'admin@gradix.local');
    adminToken = logged.body.data.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('WORKER cannot POST users; WORKER+ADMIN can', async () => {
    const worker = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `worker-${suffix}@gradix.local`,
        firstName: 'W',
        lastName: 'One',
        roles: ['WORKER'],
      });
    const workerLogin = await login(
      app,
      `worker-${suffix}@gradix.local`,
      worker.body.data.temporaryPassword as string,
    );
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(workerLogin.body.data.accessToken as string))
      .send({
        currentPassword: worker.body.data.temporaryPassword,
        newPassword: 'WorkerPass1',
      });
    const afterChange = await login(
      app,
      `worker-${suffix}@gradix.local`,
      'WorkerPass1',
    );
    const forbidden = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(afterChange.body.data.accessToken as string))
      .send({
        email: `nope-${suffix}@gradix.local`,
        firstName: 'N',
        lastName: 'O',
        roles: ['WORKER'],
      });
    expect(forbidden.status).toBe(403);
    const combo = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `combo-${suffix}@gradix.local`,
        firstName: 'Combo',
        lastName: 'User',
        roles: ['WORKER', 'ADMIN'],
      });
    expect(combo.status).toBe(201);
    const comboLogin = await login(
      app,
      `combo-${suffix}@gradix.local`,
      combo.body.data.temporaryPassword as string,
    );
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(comboLogin.body.data.accessToken as string))
      .send({
        currentPassword: combo.body.data.temporaryPassword,
        newPassword: 'ComboPass12',
      });
    const comboAfter = await login(
      app,
      `combo-${suffix}@gradix.local`,
      'ComboPass12',
    );
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(comboAfter.body.data.accessToken as string))
      .send({
        email: `ok-${suffix}@gradix.local`,
        firstName: 'Ok',
        lastName: 'User',
        roles: ['WORKER'],
      });
    expect(created.status).toBe(201);
  });

  it('hourlyRate write needs payroll.write', async () => {
    const target = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `rate-${suffix}@gradix.local`,
        firstName: 'Rate',
        lastName: 'User',
        roles: ['WORKER'],
      });
    const workerUser = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `wrate-${suffix}@gradix.local`,
        firstName: 'W',
        lastName: 'Rate',
        roles: ['WORKER'],
      });
    const wLogin = await login(
      app,
      `wrate-${suffix}@gradix.local`,
      workerUser.body.data.temporaryPassword as string,
    );
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(wLogin.body.data.accessToken as string))
      .send({
        currentPassword: workerUser.body.data.temporaryPassword,
        newPassword: 'WratePass12',
      });
    const wAfter = await login(
      app,
      `wrate-${suffix}@gradix.local`,
      'WratePass12',
    );
    const denied = await request(app.getHttpServer())
      .patch(`/api/users/${target.body.data.id}`)
      .set(auth(wAfter.body.data.accessToken as string))
      .send({ hourlyRate: '10.00' });
    expect(denied.status).toBe(403);
    const allowed = await request(app.getHttpServer())
      .patch(`/api/users/${target.body.data.id}`)
      .set(auth(adminToken))
      .send({ hourlyRate: '12.50' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.hourlyRate).toBe('12.50');
  });

  it('reset-password returns temp once', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `reset-${suffix}@gradix.local`,
        firstName: 'Reset',
        lastName: 'User',
        roles: ['WORKER'],
      });
    const reset = await request(app.getHttpServer())
      .post(`/api/users/${created.body.data.id}/reset-password`)
      .set(auth(adminToken));
    expect(reset.status).toBe(201);
    expect(reset.body.data.temporaryPassword).toEqual(expect.any(String));
  });
});
