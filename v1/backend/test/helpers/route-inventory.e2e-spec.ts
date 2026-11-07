import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../../generated/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { resolvePermissions } from '../../src/common/rbac/role-permissions';
import { login } from './auth';
import { createTestApp } from './create-app';
import {
  collectRoutes,
  makeMatrix,
  renderRouteCsv,
  renderMatrixCsv,
  roles,
  tenantContexts,
} from './route-inventory';

describe('TEST-01 runtime route inventory', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('collects effective Nest route metadata including public, tenant and permissions', () => {
    const routes = collectRoutes(app);
    expect(routes.length).toBeGreaterThan(100);
    expect(
      new Set(routes.map((route) => `${route.method} ${route.path}`)).size,
    ).toBe(routes.length);
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/api/auth/login',
          public: true,
        }),
        expect.objectContaining({
          method: 'GET',
          path: '/api/dashboard/projects',
          public: false,
          tenantRoute: true,
          permissions: ['projects.read'],
        }),
      ]),
    );
  });

  it('covers the registered Express controller paths and methods', () => {
    const express = app.getHttpAdapter().getInstance() as {
      router: {
        stack: { route?: { path: string; methods: Record<string, boolean> } }[];
      };
    };
    const registered = express.router.stack
      .flatMap(({ route }) => {
        if (
          !route ||
          !route.path.startsWith('/api/') ||
          route.path.startsWith('/api/docs')
        )
          return [];
        return Object.keys(route.methods).map(
          (method) => `${method.toUpperCase()} ${route.path}`,
        );
      })
      .sort();
    expect(
      collectRoutes(app)
        .map((route) => `${route.method} ${route.path}`)
        .sort(),
    ).toEqual(registered);
  });

  it('keeps checked-in generated inventories in sync with runtime routes', () => {
    const routes = collectRoutes(app);
    const inventoryPath = resolve(
      __dirname,
      '../../../AUDIT/ROUTE_INVENTORY.csv',
    );
    const matrixPath = resolve(__dirname, '../../../AUDIT/ROUTE_MATRIX.csv');
    if (process.env.ROUTE_INVENTORY_WRITE === '1') {
      writeFileSync(inventoryPath, renderRouteCsv(routes));
      writeFileSync(matrixPath, renderMatrixCsv(routes));
    }
    expect(readFileSync(inventoryPath, 'utf8')).toBe(renderRouteCsv(routes));
    expect(readFileSync(matrixPath, 'utf8')).toBe(renderMatrixCsv(routes));
  });

  it('requires an explicit reason for every public route exception', () => {
    const exceptions: Record<string, string> = {
      'POST /api/auth/forgot': 'Anonymous password recovery request.',
      'POST /api/auth/login': 'Anonymous credential exchange.',
      'POST /api/auth/refresh':
        'Refresh credential authenticates instead of an access JWT.',
      'POST /api/auth/reset':
        'Password reset token authenticates the operation.',
      'GET /api/health': 'Liveness probe.',
      'GET /api/ready': 'Readiness probe.',
      'POST /api/iot/gps':
        'Device-key authentication is separate from access JWT.',
      'GET /api/public/:slug': 'Public company profile.',
      'GET /api/public/:slug/projects': 'Published project listing.',
      'GET /api/public/assets/:id': 'Public asset stream.',
      'GET /api/settings/public': 'Public company settings by slug.',
    };
    const publicRoutes = collectRoutes(app)
      .filter((route) => route.public)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(Object.keys(exceptions).sort()).toEqual(publicRoutes);
    expect(
      Object.values(exceptions).every((reason) => reason.trim().length > 0),
    ).toBe(true);
  });

  it('rejects unauthenticated no-header requests to every non-public route', async () => {
    const failures: string[] = [];
    const agent = request(app.getHttpServer());
    const methods = {
      GET: agent.get.bind(agent),
      POST: agent.post.bind(agent),
      PUT: agent.put.bind(agent),
      PATCH: agent.patch.bind(agent),
      DELETE: agent.delete.bind(agent),
    };
    for (const route of collectRoutes(app).filter((item) => !item.public)) {
      const call = methods[route.method as keyof typeof methods];
      if (!call) throw new Error(`Unsupported request method ${route.method}`);
      const path = route.path.replace(
        /:[A-Za-z0-9_]+/g,
        'nonexistent-test-resource',
      );
      const response = await call(path);
      if (response.status !== 401)
        failures.push(`${route.method} ${route.path}: ${response.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('rejects a foreign company header for every company role and non-public route', async () => {
    const prisma = app.get(PrismaService);
    const seed = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    if (!seed.companyId) throw new Error('Demo admin must belong to a company');
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const foreign = await prisma.company.create({
      data: {
        name: 'Route matrix foreign test',
        slug: `route-matrix-${suffix}`,
      },
    });
    const created: string[] = [];
    const failures: string[] = [];
    try {
      const agent = request(app.getHttpServer());
      const methods = {
        GET: agent.get.bind(agent),
        POST: agent.post.bind(agent),
        PUT: agent.put.bind(agent),
        PATCH: agent.patch.bind(agent),
        DELETE: agent.delete.bind(agent),
      };
      for (const role of Object.values(Role).filter(
        (value) => value !== 'PLATFORM_ADMIN',
      )) {
        const email = `route-${role.toLowerCase()}-${suffix}@example.invalid`;
        const user = await prisma.user.create({
          data: {
            email,
            firstName: 'Route',
            lastName: 'Test',
            companyId: seed.companyId,
            passwordHash: seed.passwordHash,
            mustChangePassword: false,
            roles: { create: { role } },
          },
        });
        created.push(user.id);
        const logged = await login(app, email);
        expect(logged.status).toBe(200);
        expect(logged.body.data.user.roles).toContain(role);
        const token = logged.body.data.accessToken as string;
        for (const route of collectRoutes(app).filter((item) => !item.public)) {
          const call = methods[route.method as keyof typeof methods];
          if (!call)
            throw new Error(`Unsupported request method ${route.method}`);
          const path = route.path.replace(
            /:[A-Za-z0-9_]+/g,
            'nonexistent-test-resource',
          );
          const response = await call(path)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Company-Id', foreign.id);
          if (
            response.status !== 400 ||
            response.body?.error?.code !== 'TENANT_HEADER_FORBIDDEN'
          )
            failures.push(
              `${role} ${route.method} ${route.path}: ${response.status}`,
            );
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: created } } });
      await prisma.company.delete({ where: { id: foreign.id } });
    }
  }, 120_000);

  it('denies missing declared permissions for every applicable route and company role', async () => {
    const prisma = app.get(PrismaService);
    const seed = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    if (!seed.companyId) throw new Error('Demo admin must belong to a company');
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created: string[] = [];
    const failures: string[] = [];
    let checked = 0;
    const checkedRoutes = new Set<string>();
    try {
      const agent = request(app.getHttpServer());
      const methods = {
        GET: agent.get.bind(agent),
        POST: agent.post.bind(agent),
        PUT: agent.put.bind(agent),
        PATCH: agent.patch.bind(agent),
        DELETE: agent.delete.bind(agent),
      };
      for (const role of Object.values(Role).filter(
        (value) => value !== 'PLATFORM_ADMIN',
      )) {
        const email = `route-denied-${role.toLowerCase()}-${suffix}@example.invalid`;
        const user = await prisma.user.create({
          data: {
            email,
            firstName: 'Route',
            lastName: 'Denied',
            companyId: seed.companyId,
            passwordHash: seed.passwordHash,
            mustChangePassword: false,
            roles: { create: { role } },
          },
        });
        created.push(user.id);
        const logged = await login(app, email);
        expect(logged.status).toBe(200);
        const token = logged.body.data.accessToken as string;
        const granted: readonly string[] = resolvePermissions([role]);
        for (const route of collectRoutes(app).filter(
          (item) =>
            !item.public && item.permissions.some((p) => !granted.includes(p)),
        )) {
          const call = methods[route.method as keyof typeof methods];
          if (!call)
            throw new Error(`Unsupported request method ${route.method}`);
          const path = route.path.replace(
            /:[A-Za-z0-9_]+/g,
            'nonexistent-test-resource',
          );
          const response = await call(path).set(
            'Authorization',
            `Bearer ${token}`,
          );
          checked++;
          checkedRoutes.add(`${route.method} ${route.path}`);
          if (
            response.status !== 403 ||
            response.body?.error?.code !== 'FORBIDDEN' ||
            response.body?.data !== undefined
          )
            failures.push(
              `${role} ${route.method} ${route.path}: ${response.status}`,
            );
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(checkedRoutes.size).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: created } } });
    }
  }, 120_000);

  it('requires a real selected tenant for platform admins on tenant routes', async () => {
    const prisma = app.get(PrismaService);
    const seed = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    const email = `route-platform-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Route',
        lastName: 'Platform Test',
        passwordHash: seed.passwordHash,
        mustChangePassword: false,
        roles: { create: { role: 'PLATFORM_ADMIN' } },
      },
    });
    try {
      const logged = await login(app, email);
      expect(logged.status).toBe(200);
      expect(logged.body.data.user.roles).toContain('PLATFORM_ADMIN');
      const token = logged.body.data.accessToken as string;
      const agent = request(app.getHttpServer());
      const methods = {
        GET: agent.get.bind(agent),
        POST: agent.post.bind(agent),
        PUT: agent.put.bind(agent),
        PATCH: agent.patch.bind(agent),
        DELETE: agent.delete.bind(agent),
      };
      const failures: string[] = [];
      for (const route of collectRoutes(app).filter(
        (item) => !item.public && item.tenantRoute,
      )) {
        const call = methods[route.method as keyof typeof methods];
        if (!call)
          throw new Error(`Unsupported request method ${route.method}`);
        const path = route.path.replace(
          /:[A-Za-z0-9_]+/g,
          'nonexistent-test-resource',
        );
        const missing = await call(path).set(
          'Authorization',
          `Bearer ${token}`,
        );
        if (
          missing.status !== 403 ||
          missing.body?.error?.code !== 'TENANT_HEADER_REQUIRED'
        )
          failures.push(
            `missing ${route.method} ${route.path}: ${missing.status}`,
          );
        const unknown = await call(path)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Company-Id', 'nonexistent-test-company');
        if (unknown.status !== 404 || unknown.body?.error?.code !== 'NOT_FOUND')
          failures.push(
            `unknown ${route.method} ${route.path}: ${unknown.status}`,
          );
      }
      expect(failures).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 120_000);

  it('generates every role and tenant-header context without claiming test evidence', () => {
    const routes = collectRoutes(app);
    const matrix = makeMatrix(routes);
    expect(roles).toHaveLength(11);
    expect([...roles].filter((role) => role !== 'ANONYMOUS').sort()).toEqual(
      Object.values(Role).sort(),
    );
    expect(tenantContexts).toHaveLength(4);
    expect(matrix).toHaveLength(
      routes.length * roles.length * tenantContexts.length,
    );
    expect(matrix.every((row) => row.evidence === 'unassessed')).toBe(true);
    expect(
      new Set(
        matrix.map(
          (row) => `${row.method} ${row.path} ${row.role} ${row.tenantContext}`,
        ),
      ).size,
    ).toBe(matrix.length);
  });
});
