import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { hashRefreshToken } from '../src/common/utils/password';
import { auth, login } from './helpers/auth';
import { createTestApp } from './helpers/create-app';

describe('D-059 refresh replay (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let email: string;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const seed = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    email = `refresh-replay-${randomUUID()}@example.invalid`;
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Refresh',
        lastName: 'Replay',
        companyId: seed.companyId,
        passwordHash: seed.passwordHash,
        mustChangePassword: false,
        roles: { create: { role: 'ADMIN' } },
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await app?.close();
  });
  const refresh = (token: string) =>
    request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: token });
  const signIn = async () => {
    const response = await login(app, email);
    expect(response.status).toBe(200);
    return response.body.data as { refreshToken: string; accessToken: string };
  };
  it('documents the refresh replay window and envelope in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation = document.paths['/api/auth/refresh']?.post;
    expect(operation?.description).toContain('20 seconds');
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.requestBody).toBeDefined();
  });
  it('returns the exact committed pair for a lost response without affecting another device', async () => {
    const a = await signIn();
    const b = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    const replay = await refresh(a.refreshToken);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect((await refresh(b.refreshToken)).status).toBe(200);
  });
  it('serializes concurrent requests to the same pair without creating two children', async () => {
    const a = await signIn();
    const [one, two] = await Promise.all([
      refresh(a.refreshToken),
      refresh(a.refreshToken),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body.data).toEqual(two.body.data);
    const parent = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(a.refreshToken) },
    });
    expect(
      await prisma.refreshToken.count({
        where: { userId, lineageKey: parent.lineageKey, revokedAt: null },
      }),
    ).toBe(1);
  });
  it('revokes only the reused family after the grace period', async () => {
    const a = await signIn();
    const b = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(a.refreshToken) },
      data: { revokedAt: new Date(Date.now() - 25_000) },
    });
    const stolen = await refresh(a.refreshToken);
    expect([stolen.status, stolen.body.error.code]).toEqual([
      401,
      'AUTH_REFRESH_REUSE',
    ]);
    expect((await refresh(first.body.data.refreshToken as string)).status).toBe(
      401,
    );
    expect((await refresh(b.refreshToken)).status).toBe(200);
  });
  it('never reissues an already rotated child', async () => {
    const a = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    const next = await refresh(first.body.data.refreshToken as string);
    expect(next.status).toBe(200);
    expect((await refresh(a.refreshToken)).status).toBe(401);
    expect((await refresh(next.body.data.refreshToken as string)).status).toBe(
      200,
    );
  });
  it('does not resurrect a family after logout using the parent', async () => {
    const a = await signIn();
    const b = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    const logout = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(auth(a.accessToken))
      .send({ refreshToken: a.refreshToken });
    expect(logout.status).toBe(200);
    expect((await refresh(a.refreshToken)).status).toBe(401);
    expect((await refresh(first.body.data.refreshToken as string)).status).toBe(
      401,
    );
    expect((await refresh(b.refreshToken)).status).toBe(200);
  });
  it('does not replay an expired parent even inside the grace window', async () => {
    const a = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(a.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await refresh(a.refreshToken)).status).toBe(401);
    expect((await refresh(first.body.data.refreshToken as string)).status).toBe(
      200,
    );
  });
  it('does not resurrect a family after logout-all', async () => {
    const a = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    const logout = await request(app.getHttpServer())
      .post('/api/auth/logout-all')
      .set(auth(a.accessToken));
    expect(logout.status).toBe(200);
    expect((await refresh(a.refreshToken)).status).toBe(401);
    expect((await refresh(first.body.data.refreshToken as string)).status).toBe(
      401,
    );
  });
  it('does not replay when the direct child has expired', async () => {
    const a = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    await prisma.refreshToken.update({
      where: {
        tokenHash: hashRefreshToken(first.body.data.refreshToken as string),
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh(a.refreshToken)).status).toBe(401);
  });
  it('does not replay after the account is disabled, even within the window', async () => {
    const a = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    try {
      expect((await refresh(a.refreshToken)).status).toBe(401);
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: true },
      });
    }
  });
  it('refuses replay with a different signing key without revoking another session', async () => {
    const a = await signIn();
    const b = await signIn();
    const first = await refresh(a.refreshToken);
    expect(first.status).toBe(200);
    const config = app.get(ConfigService);
    const differentKey = jest
      .spyOn(config, 'getOrThrow')
      .mockReturnValueOnce('different-replica-secret-for-test-only');
    try {
      expect((await refresh(a.refreshToken)).status).toBe(401);
    } finally {
      differentKey.mockRestore();
    }
    const recovered = await refresh(a.refreshToken);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data).toEqual(first.body.data);
    expect((await refresh(b.refreshToken)).status).toBe(200);
  });
  it('preserves conservative global revocation for an unlinked pre-family token', async () => {
    const a = await signIn();
    const b = await signIn();
    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(a.refreshToken) },
      data: { lineageKey: null, revokedAt: new Date(Date.now() - 25_000) },
    });
    const reuse = await refresh(a.refreshToken);
    expect([reuse.status, reuse.body.error.code]).toEqual([
      401,
      'AUTH_REFRESH_REUSE',
    ]);
    expect((await refresh(b.refreshToken)).status).toBe(401);
  });
});
