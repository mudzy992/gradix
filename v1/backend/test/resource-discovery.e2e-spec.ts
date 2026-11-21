import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../generated/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { auth, login } from './helpers/auth';
import { createTestApp } from './helpers/create-app';
import { discoverRouteResource } from './helpers/discover-route-resource';
import { collectRoutes, Route } from './helpers/route-inventory';
import { seedTenantFixtures } from './helpers/tenant-fixtures';

const route = (path: string): Route => ({
  method: 'GET',
  path,
  controller: 'test',
  handler: 'test',
  public: false,
  tenantRoute: true,
  permissions: [],
});

describe('TEST-01 route resource discovery', () => {
  it('walks parent and nested lists and refuses missing or empty lists', async () => {
    const inventory = [
      '/api/projects',
      '/api/projects/:id/phases',
      '/api/projects/:id/phases/:phaseId',
    ].map(route);
    const calls: string[] = [];
    const get = async (path: string) => {
      calls.push(path);
      return {
        status: 200,
        body: {
          data:
            path === '/api/projects'
              ? [{ id: 'project A' }]
              : [{ id: 'phase A' }],
        },
      };
    };
    expect(await discoverRouteResource(inventory[2], inventory, get)).toEqual({
      ok: true,
      path: '/api/projects/project%20A/phases/phase%20A',
      ids: ['project A', 'phase A'],
    });
    expect(calls).toEqual([
      '/api/projects',
      '/api/projects/project%20A/phases',
    ]);
    expect(
      await discoverRouteResource(
        route('/api/projects/:id/missing/:id'),
        inventory,
        get,
      ),
    ).toEqual({
      ok: false,
      reason: 'no GET list for /api/projects/:id/missing',
    });
    expect(
      await discoverRouteResource(inventory[2], inventory, async () => ({
        status: 200,
        body: { data: [] },
      })),
    ).toEqual({ ok: false, reason: 'list /api/projects empty or non-array' });
  });

  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('discovers real demo IDs and exercises permitted B readers without pretending skipped cases are covered', async () => {
    const inventory = collectRoutes(app);
    const demoLogin = await login(app, 'admin@gradix.local');
    expect(demoLogin.status).toBe(200);
    const demoHeaders = auth(demoLogin.body.data.accessToken as string);
    const fixture = await seedTenantFixtures(app, app.get(PrismaService));
    const http = request(app.getHttpServer());
    const blocked: string[] = [];
    const exercised: { path: string; roles: number }[] = [];
    try {
      for (const item of inventory.filter(
        (r) =>
          r.method === 'GET' &&
          r.tenantRoute &&
          !r.public &&
          r.path.includes(':'),
      )) {
        const a = await discoverRouteResource(item, inventory, (path) =>
          http.get(path).set(demoHeaders),
        );
        if (!a.ok) {
          blocked.push(`${item.path}: A ${a.reason}`);
          continue;
        }
        const b = await discoverRouteResource(item, inventory, (path) =>
          http.get(path).set(fixture.b.headers.SUPER_ADMIN),
        );
        if (!b.ok) {
          blocked.push(`${item.path}: B ${b.reason}`);
          continue;
        }
        const source = await http.get(a.path).set(demoHeaders);
        if (source.status !== 200) {
          expect(source.status === 401 || source.status >= 500).toBe(false);
          blocked.push(`${item.path}: A resource status ${source.status}`);
          continue;
        }
        let roles = 0;
        for (const role of Object.values(Role)) {
          const own = await http.get(b.path).set(fixture.b.headers[role]);
          if (own.status !== 200) {
            expect([item.path, role, [403, 404].includes(own.status)]).toEqual([
              item.path,
              role,
              true,
            ]);
            continue;
          }
          roles++;
          const foreign = await http.get(a.path).set(fixture.b.headers[role]);
          expect([
            item.path,
            role,
            [403, 404].includes(foreign.status),
          ]).toEqual([item.path, role, true]);
          expect(foreign.body.data).toBeUndefined();
          for (const id of a.ids)
            expect(JSON.stringify(foreign.body)).not.toContain(id);
        }
        if (!roles) blocked.push(`${item.path}: B has no 200 positive control`);
        else exercised.push({ path: item.path, roles });
      }
      expect(exercised.length).toBeGreaterThan(0);
      const plan: Record<string, { discoverable: number; blocked: number }> =
        {};
      const blockedPlans: string[] = [];
      for (const item of inventory.filter(
        (r) => r.tenantRoute && !r.public && r.path.includes(':'),
      )) {
        const result = await discoverRouteResource(item, inventory, (path) =>
          http.get(path).set(demoHeaders),
        );
        const count = plan[item.method] ?? { discoverable: 0, blocked: 0 };
        plan[item.method] = count;
        if (result.ok) count.discoverable++;
        else {
          count.blocked++;
          blockedPlans.push(`${item.method} ${item.path}: ${result.reason}`);
        }
      }
      process.stdout.write(
        `Discovery path-param plan ${JSON.stringify(plan)}\nDiscovery path-param blocked ${JSON.stringify(blockedPlans)}\n`,
      );
      process.stdout.write(
        `Discovery GET evidence ${JSON.stringify(exercised)}\nDiscovery blocked ${JSON.stringify(blocked)}\n`,
      );
    } finally {
      await fixture.cleanup();
    }
  }, 120_000);
});
