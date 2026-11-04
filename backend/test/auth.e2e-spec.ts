import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, decodeJwt, login } from './helpers/auth';
import { AuthTokensService } from '../src/modules/auth/auth-tokens.service';
import { TimerForceCloseService } from '../src/modules/ops/timer-force-close.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { hashRefreshToken } from '../src/common/utils/password';

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

  it('logout-all waits for an in-progress rotation and revokes the new token', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const token = logged.body.data.refreshToken as string;
    const userId = logged.body.data.user.id as string;
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
    // Block the old token row so rotation holds the user lock before creating
    // the child. Revoke-all must wait for that lock, then see the new row.
    const holder = prisma.$transaction(
      async (tx) => {
        const hash = hashRefreshToken(token);
        await tx.$queryRaw`SELECT "id" FROM "RefreshToken" WHERE "tokenHash" = ${hash} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let rotation: ReturnType<AuthTokensService['rotate']> | undefined;
    let revocation: Promise<void> | undefined;
    try {
      await Promise.race([locked, holder]);
      rotation = tokens.rotate(token);
      void rotation.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%UPDATE%RefreshToken%');
      revocation = tokens.revokeAll(userId);
      void revocation.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%FROM "User"%FOR UPDATE%');
      release();
      const rotated = await rotation;
      await revocation;
      await expect(tokens.rotate(rotated.refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSE',
      });
    } finally {
      release();
      await Promise.allSettled([holder, rotation, revocation]);
    }
  });

  it.each([
    { change: 'password', expected: 'AUTH_INVALID_CREDENTIALS' },
    { change: 'active', expected: 'AUTH_ACCOUNT_INACTIVE' },
  ])(
    'rechecks $change after waiting to issue a login token',
    async ({ change, expected }) => {
      const prisma = app.get(PrismaService);
      const tokens = app.get(AuthTokensService);
      const oldHash = 'test-hash-before-change';
      const user = await prisma.user.create({
        data: {
          firstName: 'Race',
          lastName: 'Test',
          email: `auth-race-${change}-${randomUUID()}@example.test`,
          passwordHash: oldHash,
          roles: { create: { role: 'WORKER' } },
        },
      });
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
          await tx.user.update({
            where: { id: user.id },
            data:
              change === 'password'
                ? { passwordHash: 'test-hash-after-change' }
                : { isActive: false },
          });
          ready();
          await gate;
        },
        { timeout: 15000 },
      );
      let issuing: ReturnType<AuthTokensService['issuePair']> | undefined;
      try {
        await Promise.race([locked, holder]);
        issuing = tokens.issuePair(user.id, oldHash);
        void issuing.catch(() => undefined);
        await waitForBlockedQuery(prisma, '%FROM "User"%FOR UPDATE%');
        release();
        await expect(issuing).rejects.toMatchObject({ code: expected });
        expect(
          await prisma.refreshToken.count({ where: { userId: user.id } }),
        ).toBe(0);
      } finally {
        release();
        await Promise.allSettled([holder, issuing]);
      }
    },
  );

  it('single logout of an older token revokes its rotated family but not another login', async () => {
    const first = await login(app, 'admin@gradix.local');
    const other = await login(app, 'admin@gradix.local');
    const userId = first.body.data.user.id as string;
    const firstToken = first.body.data.refreshToken as string;
    const otherToken = other.body.data.refreshToken as string;
    const tokens = app.get(AuthTokensService);
    const prisma = app.get(PrismaService);
    const child = await tokens.rotate(firstToken);
    const grandchild = await tokens.rotate(child.refreshToken);
    const loggedOut = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(auth(first.body.data.accessToken as string))
      .send({ refreshToken: firstToken });
    expect(loggedOut.status).toBe(200);
    const row = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(grandchild.refreshToken) },
      select: { revokedAt: true },
    });
    expect(row.revokedAt).not.toBeNull();
    // Inspect/rotate the other family before trying the revoked one: reuse of
    // any revoked token intentionally still triggers the global theft policy.
    const untouched = await tokens.rotate(otherToken);
    expect(untouched.refreshToken).toEqual(expect.any(String));
    await tokens.logout(userId, firstToken); // idempotent repeated logout
  });

  it('legacy token gets a family on rotation and can later log out its child', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const token = logged.body.data.refreshToken as string;
    const userId = logged.body.data.user.id as string;
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
    const legacy = await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(token) },
      data: { lineageKey: null },
      select: { id: true },
    });
    const child = await tokens.rotate(token);
    const parent = await prisma.refreshToken.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { lineageKey: true },
    });
    const childRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(child.refreshToken) },
      select: { lineageKey: true },
    });
    expect(parent.lineageKey).toBe(legacy.id);
    expect(childRow.lineageKey).toBe(legacy.id);
    await tokens.logout(userId, token);
    const after = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(child.refreshToken) },
      select: { revokedAt: true },
    });
    expect(after.revokedAt).not.toBeNull();
  });

  it('single logout cannot revoke a token belonging to another user', async () => {
    const admin = await login(app, 'admin@gradix.local');
    const worker = await login(app, 'worker@gradix.local');
    const adminToken = admin.body.data.refreshToken as string;
    const tokens = app.get(AuthTokensService);
    await tokens.logout(worker.body.data.user.id as string, adminToken);
    const stillActive = await tokens.rotate(adminToken);
    expect(stillActive.refreshToken).toEqual(expect.any(String));
  });

  it('single logout waits for a concurrent rotation and revokes its child', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const independent = await login(app, 'admin@gradix.local');
    const token = logged.body.data.refreshToken as string;
    const userId = logged.body.data.user.id as string;
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
        const hash = hashRefreshToken(token);
        await tx.$queryRaw`SELECT "id" FROM "RefreshToken" WHERE "tokenHash" = ${hash} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let rotation: ReturnType<AuthTokensService['rotate']> | undefined;
    let logout: Promise<void> | undefined;
    try {
      await Promise.race([locked, holder]);
      rotation = tokens.rotate(token);
      void rotation.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%UPDATE%RefreshToken%');
      logout = tokens.logout(userId, token);
      void logout.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%FROM "User"%FOR UPDATE%');
      release();
      const child = await rotation;
      await logout;
      const row = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(child.refreshToken) },
        select: { revokedAt: true },
      });
      expect(row.revokedAt).not.toBeNull();
      const other = await tokens.rotate(
        independent.body.data.refreshToken as string,
      );
      expect(other.refreshToken).toEqual(expect.any(String));
    } finally {
      release();
      await Promise.allSettled([holder, rotation, logout]);
    }
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

  it('concurrent password changes cannot both use the old verified password', async () => {
    const admin = await login(app, 'admin@gradix.local');
    const email = `pw-race-${randomUUID()}@gradix.local`;
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(admin.body.data.accessToken as string))
      .send({
        email,
        firstName: 'Password',
        lastName: 'Race',
        roles: ['WORKER'],
      });
    expect(created.status).toBe(201);
    const oldPassword = created.body.data.temporaryPassword as string;
    const logged = await login(app, email, oldPassword);
    expect(logged.status).toBe(200);
    const userId = created.body.data.id as string;
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
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    try {
      await Promise.race([locked, holder]);
      const change = (newPassword: string) =>
        request(app.getHttpServer())
          .post('/api/auth/change-password')
          .set(auth(logged.body.data.accessToken as string))
          .send({ currentPassword: oldPassword, newPassword })
          .then((response) => response);
      first = change('FirstNewPass12');
      second = change('SecondNewPass12');
      void first.catch(() => undefined);
      void second.catch(() => undefined);
      // Both already verified the old hash and now wait on the same user row.
      await waitForBlockedQuery(prisma, '%FROM "User"%FOR UPDATE%', 2);
      release();
      const [a, b] = await Promise.all([first, second]);
      expect([a.status, b.status].sort()).toEqual([200, 401]);
      const winningPassword =
        a.status === 200 ? 'FirstNewPass12' : 'SecondNewPass12';
      expect((await login(app, email, oldPassword)).status).toBe(401);
      expect((await login(app, email, winningPassword)).status).toBe(200);
      const oldRow = await prisma.refreshToken.findUniqueOrThrow({
        where: {
          tokenHash: hashRefreshToken(logged.body.data.refreshToken as string),
        },
        select: { revokedAt: true },
      });
      expect(oldRow.revokedAt).not.toBeNull();
    } finally {
      release();
      await Promise.allSettled([holder, first, second]);
    }
  });

  it('password change prevents a waiting rotation from issuing a live token', async () => {
    const admin = await login(app, 'admin@gradix.local');
    const email = `pw-rotate-${randomUUID()}@gradix.local`;
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(admin.body.data.accessToken as string))
      .send({
        email,
        firstName: 'Password',
        lastName: 'Rotate',
        roles: ['WORKER'],
      });
    expect(created.status).toBe(201);
    const logged = await login(
      app,
      email,
      created.body.data.temporaryPassword as string,
    );
    const userId = created.body.data.id as string;
    const refreshToken = logged.body.data.refreshToken as string;
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
    let change: Promise<boolean> | undefined;
    let rotation: ReturnType<AuthTokensService['rotate']> | undefined;
    try {
      await Promise.race([locked, holder]);
      change = tokens.replacePassword(
        userId,
        'test-new-hash',
        false,
        user.passwordHash,
      );
      void change.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%UPDATE%RefreshToken%');
      rotation = tokens.rotate(refreshToken);
      void rotation.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%FROM "User"%FOR UPDATE%');
      release();
      expect(await change).toBe(true);
      await expect(rotation).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSE',
      });
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(after.passwordHash).toBe('test-new-hash');
    } finally {
      release();
      await Promise.allSettled([holder, change, rotation]);
    }
  });

  it('rolls back password replacement when session revocation fails', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const userId = logged.body.data.user.id as string;
    const refreshToken = logged.body.data.refreshToken as string;
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const tokens = app.get(AuthTokensService);
    // Inject a failure at the actual transaction's revocation step; the user
    // update must roll back in PostgreSQL rather than only failing the response.
    const internal = tokens as unknown as {
      revokeAllInTransaction: (...args: never[]) => Promise<void>;
    };
    const failure = jest
      .spyOn(internal, 'revokeAllInTransaction')
      .mockRejectedValueOnce(new Error('test revocation failure'));
    try {
      await expect(
        tokens.replacePassword(
          userId,
          'test-hash-not-committed',
          false,
          user.passwordHash,
        ),
      ).rejects.toThrow('test revocation failure');
    } finally {
      failure.mockRestore();
    }
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(after.passwordHash).toBe(user.passwordHash);
    const stillActive = await tokens.rotate(refreshToken);
    expect(stillActive.refreshToken).toEqual(expect.any(String));
  });

  it('user deactivation waits for rotation and atomically revokes the session', async () => {
    const { adminToken, userId, refreshToken } = await createWorkerSession(app);
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
    let rotation: ReturnType<AuthTokensService['rotate']> | undefined;
    try {
      await Promise.race([locked, holder]);
      deactivation = request(app.getHttpServer())
        .patch(`/api/users/${userId}`)
        .set(auth(adminToken))
        .send({ isActive: false })
        .then((response) => response);
      void deactivation.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%UPDATE%RefreshToken%');
      rotation = tokens.rotate(refreshToken);
      void rotation.catch(() => undefined);
      await waitForBlockedQuery(prisma, '%FROM "User"%FOR UPDATE%');
      release();
      expect((await deactivation).status).toBe(200);
      await expect(rotation).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSE',
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.isActive).toBe(false);
      const reactivated = await request(app.getHttpServer())
        .patch(`/api/users/${userId}`)
        .set(auth(adminToken))
        .send({ isActive: true });
      expect(reactivated.status).toBe(200);
      const row = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        select: { revokedAt: true },
      });
      expect(row.revokedAt).not.toBeNull();
    } finally {
      release();
      await Promise.allSettled([holder, deactivation, rotation]);
    }
  });

  it('deactivation rolls back on revocation failure and retries post-commit timer cleanup', async () => {
    const { adminToken, userId, refreshToken } = await createWorkerSession(app);
    const prisma = app.get(PrismaService);
    const tokens = app.get(AuthTokensService);
    const timers = app.get(TimerForceCloseService);
    const revokeFailure = jest
      .spyOn(tokens, 'revokeAllInTransaction')
      .mockRejectedValueOnce(new Error('test revoke failure'));
    try {
      const failed = await request(app.getHttpServer())
        .patch(`/api/users/${userId}`)
        .set(auth(adminToken))
        .send({ isActive: false });
      expect(failed.status).toBe(500);
    } finally {
      revokeFailure.mockRestore();
    }
    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const activeToken = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      select: { revokedAt: true },
    });
    expect(unchanged.isActive).toBe(true);
    expect(activeToken.revokedAt).toBeNull();

    const timerFailure = jest
      .spyOn(timers, 'closeOpenForUser')
      .mockRejectedValueOnce(new Error('test timer failure'));
    try {
      const failed = await request(app.getHttpServer())
        .patch(`/api/users/${userId}`)
        .set(auth(adminToken))
        .send({ isActive: false });
      expect(failed.status).toBe(500);
      const inactive = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      const revoked = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        select: { revokedAt: true },
      });
      expect(inactive.isActive).toBe(false);
      expect(revoked.revokedAt).not.toBeNull();
      const retry = await request(app.getHttpServer())
        .patch(`/api/users/${userId}`)
        .set(auth(adminToken))
        .send({ isActive: false });
      expect(retry.status).toBe(200);
      expect(timerFailure).toHaveBeenCalledTimes(2);
    } finally {
      timerFailure.mockRestore();
    }
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

async function createWorkerSession(app: INestApplication<App>) {
  const admin = await login(app, 'admin@gradix.local');
  expect(admin.status).toBe(200);
  const adminToken = admin.body.data.accessToken as string;
  const email = `deactivate-${randomUUID()}@gradix.local`;
  const created = await request(app.getHttpServer())
    .post('/api/users')
    .set(auth(adminToken))
    .send({
      email,
      firstName: 'Deactivation',
      lastName: 'Test',
      roles: ['WORKER'],
    });
  expect(created.status).toBe(201);
  const logged = await login(
    app,
    email,
    created.body.data.temporaryPassword as string,
  );
  expect(logged.status).toBe(200);
  return {
    adminToken,
    userId: created.body.data.id as string,
    refreshToken: logged.body.data.refreshToken as string,
  };
}

/** Observe the actual PostgreSQL lock wait; no token or SQL parameters are logged. */
async function waitForBlockedQuery(
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
  throw new Error('Expected database lock wait did not occur');
}
