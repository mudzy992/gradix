import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../../generated/client';
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
