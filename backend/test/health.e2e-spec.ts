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

  it('GET /api/health/ready — readiness provjerava Postgres', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/health/ready',
    );
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.postgres.status).toBe('ok');
    expect(typeof response.body.checks.postgres.latencyMs).toBe('number');
  });

  it('Swagger /api/docs', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs');
    expect(response.status).toBe(200);
  });
});
