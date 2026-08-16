import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Files (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects path traversal', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const response = await request(app.getHttpServer())
      .get('/api/files')
      .query({ path: '../secret.txt' })
      .set(auth(logged.body.data.accessToken as string));
    expect(response.status).toBe(400);
  });

  it('uploads a png under company prefix', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const token = logged.body.data.accessToken as string;
    const uploaded = await request(app.getHttpServer())
      .post('/api/files')
      .set(auth(token))
      .attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.path).toMatch(/^[a-z0-9]+\/\d{4}\/\d{2}\/.+\.png$/);
    const companyId = logged.body.data.user.company.id as string;
    expect(uploaded.body.data.path.startsWith(`${companyId}/`)).toBe(true);
  });
});
