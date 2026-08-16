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

  it('GET /api/health', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.process).toBe('ok');
    expect(response.body.data.mysql).toBe('ok');
  });

  it('Swagger /api/docs', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs');
    expect(response.status).toBe(200);
  });
});
