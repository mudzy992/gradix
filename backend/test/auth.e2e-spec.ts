import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, decodeJwt, login } from './helpers/auth';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /me shape and JWT sub-only', async () => {
    const logged = await login(app, 'admin@gradix.local');
    expect(logged.status).toBe(200);
    const token = logged.body.data.accessToken as string;
    const payload = decodeJwt(token);
    expect(payload.sub).toBeDefined();
    expect(payload.role).toBeUndefined();
    expect(payload.roles).toBeUndefined();
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body.data.firstName).toBe('Demo');
    expect(me.body.data.lastName).toBe('Admin');
    expect(me.body.data.roles).toContain('SUPER_ADMIN');
    expect(me.body.data.permissions).toEqual(expect.any(Array));
    expect(me.body.data.company).toEqual(
      expect.objectContaining({ name: 'Demo Gradnja', slug: 'demo' }),
    );
    expect(me.body.data).toHaveProperty('hourlyRate');
    expect(me.body.data.mustChangePassword).toBe(false);
    expect(me.body.data.locale).toBe('bs');
    expect(me.body.data).toHaveProperty('employeeCode');
  });

  it('forgot always 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/forgot')
      .send({ email: 'nobody@example.com' });
    expect(response.status).toBe(200);
  });

  it('refresh reuse revokes all', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const first = logged.body.data.refreshToken as string;
    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    const reuse = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('AUTH_REFRESH_REUSE');
    const revokedRotation = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken });
    expect(revokedRotation.status).toBe(401);
  });

  it('concurrent use of one refresh token yields one rotation and detects reuse', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const token = logged.body.data.refreshToken as string;
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: token }),
      request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: token }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 401]);
    const winner = first.status === 200 ? first : second;
    const loser = first.status === 401 ? first : second;
    expect(loser.body.error.code).toBe('AUTH_REFRESH_REUSE');
    // Reuse revokes even the winning rotation; neither concurrent caller may
    // keep a second live refresh credential after the response pair completes.
    const after = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: winner.body.data.refreshToken });
    expect(after.status).toBe(401);
  });

  it('logout is not logout-all', async () => {
    const a = await login(app, 'admin@gradix.local');
    const b = await login(app, 'admin@gradix.local');
    const tokenA = a.body.data.accessToken as string;
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(auth(tokenA))
      .send({ refreshToken: a.body.data.refreshToken });
    const still = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: b.body.data.refreshToken });
    expect(still.status).toBe(200);
    await request(app.getHttpServer())
      .post('/api/auth/logout-all')
      .set(auth(b.body.data.accessToken as string));
    const gone = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: still.body.data.refreshToken });
    expect(gone.status).toBe(401);
  });

  it('password 9 chars returns AUTH_PASSWORD_TOO_SHORT', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const response = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(logged.body.data.accessToken as string))
      .send({
        currentPassword: process.env.SEED_PASSWORD,
        newPassword: 'shortnine',
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('AUTH_PASSWORD_TOO_SHORT');
  });
});
