import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health — liveness bez envelope-a i bez baze', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(response.status).toBe(200);
    // BE-18: infrastrukturni ugovor je ravan JSON (`status`), ne `{ data: ... }`.
    expect(response.body.success).toBeUndefined();
    expect(response.body.data).toBeUndefined();
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('GET /api/ready — readiness: Postgres, MinIO i migracije (INF-05)', async () => {
    const response = await request(app.getHttpServer()).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.postgres.status).toBe('ok');
    expect(typeof response.body.checks.postgres.latencyMs).toBe('number');
    // MinIO je u testovima in-memory (`MemoryMinioService`) — provjera i dalje prolazi.
    expect(response.body.checks.storage.status).toBe('ok');
    expect(response.body.checks.migrations.status).toBe('ok');
    expect(response.body.checks.migrations.applied).toBeGreaterThanOrEqual(
      response.body.checks.migrations.expected,
    );
  });

  it('INF-04: korelacioni ID — validan se vraća, neispravan se zamjenjuje', async () => {
    const echoed = await request(app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', 'nginx-abc-123');
    expect(echoed.headers['x-request-id']).toBe('nginx-abc-123');
    const replaced = await request(app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', 'neispravan id sa razmacima');
    expect(replaced.headers['x-request-id']).not.toBe(
      'neispravan id sa razmacima',
    );
    expect(String(replaced.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Swagger /api/docs', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs');
    expect(response.status).toBe(200);
  });
});
