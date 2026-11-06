import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { collectRoutes } from './helpers/route-inventory';

describe('OpenAPI snapshot gate', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('describes every inventoried method and matches the checked-in snapshot', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const doc = response.body as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, unknown> }>
      >;
    };
    expect(doc.paths).toBeDefined();
    for (const route of collectRoutes(app)) {
      const path = route.path.replace(/:([^/]+)/g, '{$1}');
      const operation = doc.paths[path]?.[route.method.toLowerCase()];
      expect(operation).toBeDefined();
      expect(Object.keys(operation.responses ?? {}).length).toBeGreaterThan(0);
    }
    const file = resolve(process.cwd(), '../docs/openapi.json');
    const generated = `${JSON.stringify(doc, null, 2)}\n`;
    if (process.env.OPENAPI_WRITE === '1') {
      if (process.env.CI)
        throw new Error('Snapshot regeneration is forbidden in CI');
      writeFileSync(file, generated);
    }
    const digest = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(digest(readFileSync(file, 'utf8'))).toBe(digest(generated));
  });
});
