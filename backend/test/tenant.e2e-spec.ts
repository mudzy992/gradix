import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { AuthTokensService } from '../src/modules/auth/auth-tokens.service';
import { TimerForceCloseService } from '../src/modules/ops/timer-force-close.service';
import { hashRefreshToken } from '../src/common/utils/password';

describe('Tenant (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = `${Date.now()}`;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('PLATFORM_ADMIN without header gets 403 on users', async () => {
    const logged = await login(app, 'platform@gradix.local');
    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set(auth(logged.body.data.accessToken as string));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('TENANT_HEADER_REQUIRED');
  });

  it('WORKER with X-Company-Id gets 400', async () => {
    const admin = await login(app, 'admin@gradix.local');
    const worker = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(admin.body.data.accessToken as string))
      .send({
        email: `thead-${suffix}@gradix.local`,
        firstName: 'T',
        lastName: 'Head',
        roles: ['WORKER'],
      });
    const workerLogin = await login(
      app,
      `thead-${suffix}@gradix.local`,
      worker.body.data.temporaryPassword as string,
    );
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(workerLogin.body.data.accessToken as string))
      .send({
        currentPassword: worker.body.data.temporaryPassword,
        newPassword: 'TheadPass12',
      });
    const after = await login(
      app,
      `thead-${suffix}@gradix.local`,
      'TheadPass12',
    );
    const response = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(after.body.data.accessToken as string))
      .set('X-Company-Id', 'whatever');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TENANT_HEADER_FORBIDDEN');
  });

  it('ADMIN PATCH /company 200 and slug 409', async () => {
    const admin = await login(app, 'admin@gradix.local');
    const token = admin.body.data.accessToken as string;
    const ok = await request(app.getHttpServer())
      .patch('/api/company')
      .set(auth(token))
      .send({ city: 'Mostar' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.city).toBe('Mostar');
    const slug = await request(app.getHttpServer())
      .patch('/api/company')
      .set(auth(token))
      .send({ slug: 'hacked' });
    expect(slug.status).toBe(409);
    expect(slug.body.error.code).toBe('TENANT_SLUG_IMMUTABLE');
    const get = await request(app.getHttpServer())
      .get('/api/company')
      .set(auth(token));
    expect(get.status).toBe(200);
    expect(get.body.data.city).toBe('Mostar');
  });

  it('company inactive login is 401', async () => {
    const platform = await login(app, 'platform@gradix.local');
    const created = await request(app.getHttpServer())
      .post('/api/companies')
      .set(auth(platform.body.data.accessToken as string))
      .send({
        name: 'Inactive Co',
        slug: `inact-${suffix}`.slice(0, 40),
        admin: {
          email: `inact-admin-${suffix}@gradix.local`,
          firstName: 'In',
          lastName: 'Act',
        },
      });
    expect(created.status).toBe(201);
    const companyId = created.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/companies/${companyId}`)
      .set(auth(platform.body.data.accessToken as string))
      .send({ isActive: false });
    const denied = await login(
      app,
      `inact-admin-${suffix}@gradix.local`,
      created.body.data.temporaryPassword as string,
    );
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('AUTH_COMPANY_INACTIVE');
  });

  it('company revokes sessions before timer cleanup and retries cleanup', async () => {
    const { companyId, platformToken, refreshToken } =
      await companyWithSession(app);
    const prisma = app.get(PrismaService);
    const timers = app.get(TimerForceCloseService);
    const failure = jest
      .spyOn(timers, 'closeOpenForCompany')
      .mockRejectedValueOnce(new Error('test timer failure'));
    try {
      const first = await request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false });
      expect(first.status).toBe(500);
      const company = await prisma.company.findUniqueOrThrow({
        where: { id: companyId },
      });
      const token = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        select: { revokedAt: true },
      });
      expect(company.isActive).toBe(false);
      expect(token.revokedAt).not.toBeNull();
      const retry = await request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false });
      expect(retry.status).toBe(200);
      expect(failure).toHaveBeenCalledTimes(2);
      const reactivated = await request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: true });
      expect(reactivated.status).toBe(200);
      const refresh = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(refresh.status).toBe(401);
    } finally {
      failure.mockRestore();
    }
  });

  it('company retries session revocation after an earlier failure', async () => {
    const { companyId, platformToken, refreshToken } =
      await companyWithSession(app);
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
    const failure = jest
      .spyOn(tokens, 'revokeAll')
      .mockRejectedValueOnce(new Error('test revoke failure'));
    try {
      const first = await request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false });
      expect(first.status).toBe(500);
      const company = await prisma.company.findUniqueOrThrow({
        where: { id: companyId },
      });
      const token = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        select: { revokedAt: true },
      });
      expect(company.isActive).toBe(false);
      expect(token.revokedAt).toBeNull(); // no false claim of atomicity
      const retry = await request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false });
      expect(retry.status).toBe(200);
      const after = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        select: { revokedAt: true },
      });
      expect(after.revokedAt).not.toBeNull();
    } finally {
      failure.mockRestore();
    }
  });

  it('cross-tenant user is 404', async () => {
    const platform = await login(app, 'platform@gradix.local');
    const other = await request(app.getHttpServer())
      .post('/api/companies')
      .set(auth(platform.body.data.accessToken as string))
      .send({
        name: 'Other Co',
        slug: `other-${suffix}`.slice(0, 40),
        admin: {
          email: `other-admin-${suffix}@gradix.local`,
          firstName: 'O',
          lastName: 'Ther',
        },
      });
    const otherLogin = await login(
      app,
      `other-admin-${suffix}@gradix.local`,
      other.body.data.temporaryPassword as string,
    );
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(otherLogin.body.data.accessToken as string))
      .send({
        currentPassword: other.body.data.temporaryPassword,
        newPassword: 'OtherPass12',
      });
    const otherAfter = await login(
      app,
      `other-admin-${suffix}@gradix.local`,
      'OtherPass12',
    );
    const demoAdmin = await login(app, 'admin@gradix.local');
    const demoUsers = await request(app.getHttpServer())
      .get('/api/users')
      .set(auth(demoAdmin.body.data.accessToken as string));
    const demoUserId = demoUsers.body.data[0].id as string;
    const cross = await request(app.getHttpServer())
      .get(`/api/users/${demoUserId}`)
      .set(auth(otherAfter.body.data.accessToken as string));
    expect(cross.status).toBe(404);
  });
});

async function companyWithSession(app: INestApplication<App>) {
  const platform = await login(app, 'platform@gradix.local');
  expect(platform.status).toBe(200);
  const platformToken = platform.body.data.accessToken as string;
  const suffix = randomUUID();
  const email = `company-${suffix}@gradix.local`;
  const created = await request(app.getHttpServer())
    .post('/api/companies')
    .set(auth(platformToken))
    .send({
      name: 'Revocation test',
      slug: `c-${suffix}`,
      admin: { email, firstName: 'Company', lastName: 'Admin' },
    });
  expect(created.status).toBe(201);
  const logged = await login(
    app,
    email,
    created.body.data.temporaryPassword as string,
  );
  expect(logged.status).toBe(200);
  return {
    companyId: created.body.data.id as string,
    platformToken,
    refreshToken: logged.body.data.refreshToken as string,
  };
}
