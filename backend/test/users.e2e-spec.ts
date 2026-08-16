import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('Users (e2e)', () => {
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

  it('create without firstName is 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: `nfn-${suffix}@gradix.local`, lastName: 'X', roles: ['WORKER'] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('empty roles is 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `empty-${suffix}@gradix.local`,
        firstName: 'A',
        lastName: 'B',
        roles: [],
      });
    expect(response.status).toBe(400);
  });

  it('temp password once and mustChangePassword blocks', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `force-${suffix}@gradix.local`,
        firstName: 'Force',
        lastName: 'Change',
        roles: ['ADMIN'],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.temporaryPassword).toEqual(expect.any(String));
    const id = created.body.data.id as string;
    const listed = await request(app.getHttpServer())
      .get(`/api/users/${id}`)
      .set(auth(adminToken));
    expect(listed.body.data.temporaryPassword).toBeUndefined();
    const firstLogin = await login(
      app,
      `force-${suffix}@gradix.local`,
      created.body.data.temporaryPassword as string,
    );
    expect(firstLogin.status).toBe(200);
    const blocked = await request(app.getHttpServer())
      .get('/api/users')
      .set(auth(firstLogin.body.data.accessToken as string));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(firstLogin.body.data.accessToken as string));
    expect(me.status).toBe(200);
  });

  it('inactive email stays taken', async () => {
    const email = `gone-${suffix}@gradix.local`;
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email, firstName: 'Gone', lastName: 'User', roles: ['WORKER'] });
    await request(app.getHttpServer())
      .patch(`/api/users/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    const again = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email, firstName: 'New', lastName: 'User', roles: ['WORKER'] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('AUTH_EMAIL_TAKEN');
  });

  it('limit 101 is PAGINATION_LIMIT', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users?limit=101')
      .set(auth(adminToken));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PAGINATION_LIMIT');
  });
});

