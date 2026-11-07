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
    expect(uploaded.body.data.path).toMatch(
      /^[a-z0-9]+\/\d{4}\/\d{2}\/.+\.png$/,
    );
    const companyId = logged.body.data.user.company.id as string;
    expect(uploaded.body.data.path.startsWith(`${companyId}/`)).toBe(true);

    // BE-11 (F-12): preuzimanje mora nositi tip i veličinu (prije: octet-stream) i
    // zaštitu od MIME sniffing-a, jer je sadržaj korisnički.
    const download = await request(app.getHttpServer())
      .get('/api/files')
      .query({ path: uploaded.body.data.path as string })
      .set(auth(token));
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-length']).toBe(String(PNG.length));
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects a path outside the company prefix', async () => {
    const logged = await login(app, 'admin@gradix.local');
    const response = await request(app.getHttpServer())
      .get('/api/files')
      .query({ path: 'other-company/2026/11/x.png' })
      .set(auth(logged.body.data.accessToken as string));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
