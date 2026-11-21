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

  it('company deactivation rolls back status if revocation fails', async () => {
    const { companyId, platformToken, refreshToken } =
      await companyWithSession(app);
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
    const failure = jest
      .spyOn(tokens, 'revokeCompanyInTransaction')
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
      expect(company.isActive).toBe(true);
      expect(token.revokedAt).toBeNull();
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

  it('company deactivation waits for in-progress rotation and revokes its child', async () => {
    const { companyId, platformToken, refreshToken } =
      await companyWithSession(app);
    const other = await companyWithSession(app);
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
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
        const hash = hashRefreshToken(refreshToken);
        await tx.$queryRaw`SELECT "id" FROM "RefreshToken" WHERE "tokenHash" = ${hash} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let rotation: ReturnType<AuthTokensService['rotate']> | undefined;
    let deactivation: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      rotation = tokens.rotate(refreshToken);
      void rotation.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%UPDATE%RefreshToken%');
      deactivation = request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false })
        .then((response) => response);
      void deactivation.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%FROM "Company"%FOR UPDATE%');
      release();
      const child = await rotation;
      expect((await deactivation).status).toBe(200);
      const row = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(child.refreshToken) },
        select: { revokedAt: true },
      });
      expect(row.revokedAt).not.toBeNull();
      const unrelated = await tokens.rotate(other.refreshToken);
      expect(unrelated.refreshToken).toEqual(expect.any(String));
    } finally {
      release();
      await Promise.allSettled([holder, rotation, deactivation]);
    }
  });

  it('token issuance waiting for company deactivation rechecks company state', async () => {
    const { companyId, platformToken, refreshToken, userId } =
      await companyWithSession(app);
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
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
        const hash = hashRefreshToken(refreshToken);
        await tx.$queryRaw`SELECT "id" FROM "RefreshToken" WHERE "tokenHash" = ${hash} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let deactivation: Promise<request.Response> | undefined;
    let issuance: ReturnType<AuthTokensService['issuePair']> | undefined;
    try {
      await Promise.race([locked, holder]);
      deactivation = request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false })
        .then((response) => response);
      void deactivation.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%UPDATE%RefreshToken%');
      issuance = tokens.issuePair(userId, user.passwordHash);
      void issuance.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%FROM "Company"%FOR SHARE%');
      release();
      expect((await deactivation).status).toBe(200);
      await expect(issuance).rejects.toMatchObject({
        code: 'AUTH_COMPANY_INACTIVE',
      });
    } finally {
      release();
      await Promise.allSettled([holder, deactivation, issuance]);
    }
  });

  it('a user inserted during deactivation cannot receive a token for the inactive company', async () => {
    const { companyId, platformToken, refreshToken } =
      await companyWithSession(app);
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
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
        const hash = hashRefreshToken(refreshToken);
        await tx.$queryRaw`SELECT "id" FROM "RefreshToken" WHERE "tokenHash" = ${hash} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let deactivation: Promise<request.Response> | undefined;
    let created: ReturnType<PrismaService['user']['create']> | undefined;
    try {
      await Promise.race([locked, holder]);
      deactivation = request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set(auth(platformToken))
        .send({ isActive: false })
        .then((response) => response);
      void deactivation.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%UPDATE%RefreshToken%');
      created = prisma.user.create({
        data: {
          email: `during-company-${randomUUID()}@example.test`,
          firstName: 'New',
          lastName: 'User',
          companyId,
          passwordHash: 'test-hash',
          roles: { create: { role: 'WORKER' } },
        },
      });
      void created.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%INSERT INTO%User%');
      release();
      expect((await deactivation).status).toBe(200);
      const user = await created;
      await expect(
        tokens.issuePair(user.id, user.passwordHash),
      ).rejects.toMatchObject({ code: 'AUTH_COMPANY_INACTIVE' });
    } finally {
      release();
      await Promise.allSettled([holder, deactivation, created]);
    }
  });

  it('protects the last active super admin from role removal and deactivation', async () => {
    const { companyId, platformToken, userId, refreshToken } =
      await companyWithSession(app);
    const headers = { ...auth(platformToken), 'X-Company-Id': companyId };
    const demote = await request(app.getHttpServer())
      .patch(`/api/users/${userId}`)
      .set(headers)
      .send({ roles: ['WORKER'] });
    expect(demote.status).toBe(403);
    const deactivate = await request(app.getHttpServer())
      .patch(`/api/users/${userId}`)
      .set(headers)
      .send({ isActive: false });
    expect(deactivate.status).toBe(403);
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true },
    });
    const token = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      select: { revokedAt: true },
    });
    expect(user.isActive).toBe(true);
    expect(user.roles.map((role) => role.role)).toContain('SUPER_ADMIN');
    expect(token.revokedAt).toBeNull();
  });

  it('serializes concurrent deactivation and demotion of two super admins', async () => {
    const { companyId, platformToken, userId } = await companyWithSession(app);
    const headers = { ...auth(platformToken), 'X-Company-Id': companyId };
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({
        email: `super-${randomUUID()}@example.test`,
        firstName: 'Second',
        lastName: 'Super',
        roles: ['SUPER_ADMIN'],
      });
    expect(created.status).toBe(201);
    const secondId = created.body.data.id as string;
    const prisma = app.get(PrismaService);
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
        await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      first = request(app.getHttpServer())
        .patch(`/api/users/${userId}`)
        .set(headers)
        .send({ isActive: false })
        .then((response) => response);
      second = request(app.getHttpServer())
        .patch(`/api/users/${secondId}`)
        .set(headers)
        .send({ roles: ['WORKER'] })
        .then((response) => response);
      void first.catch(() => undefined);
      void second.catch(() => undefined);
      await waitForCompanyQuery(prisma, '%FROM "Company"%FOR UPDATE%', 2);
      release();
      const [a, b] = await Promise.all([first, second]);
      expect([a.status, b.status].sort()).toEqual([200, 403]);
      const count = await prisma.userRoleAssignment.count({
        where: { role: 'SUPER_ADMIN', user: { companyId, isActive: true } },
      });
      expect(count).toBe(1);
    } finally {
      release();
      await Promise.allSettled([holder, first, second]);
    }
  });

  it('can remove the super role from an inactive user without harming the active one', async () => {
    const { companyId, platformToken } = await companyWithSession(app);
    const headers = { ...auth(platformToken), 'X-Company-Id': companyId };
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({
        email: `inactive-super-${randomUUID()}@example.test`,
        firstName: 'Inactive',
        lastName: 'Super',
        roles: ['SUPER_ADMIN'],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const deactivate = await request(app.getHttpServer())
      .patch(`/api/users/${id}`)
      .set(headers)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    const demote = await request(app.getHttpServer())
      .patch(`/api/users/${id}`)
      .set(headers)
      .send({ roles: ['WORKER'] });
    expect(demote.status).toBe(200);
    const prisma = app.get(PrismaService);
    const count = await prisma.userRoleAssignment.count({
      where: { role: 'SUPER_ADMIN', user: { companyId, isActive: true } },
    });
    expect(count).toBe(1);
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
    userId: logged.body.data.user.id as string,
  };
}

/** Observe lock interleavings without recording SQL arguments or tokens. */
async function waitForCompanyQuery(
  prisma: PrismaService,
  pattern: string,
  minimum = 1,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::integer AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE ${pattern}`;
    if (rows[0].waiting >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected company lock wait did not occur');
}
