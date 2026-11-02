import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Phase 8 public site (e2e)', () => {
  let app: INestApplication<App>;
  let admin: string;
  let worker: string;
  let projectId: string;
  const slug = 'demo';

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `P8 ${Date.now()}`,
        code: `P8${Date.now().toString().slice(-6)}`,
        locality: 'Zenica',
        lat: '44.2010000',
        lng: '17.9060000',
        plannedBudget: '50000',
      });
    projectId = created.body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('company DTO has no taxId; missing and foreign slug share NOT_FOUND', async () => {
    const ok = await request(app.getHttpServer()).get(`/api/public/${slug}`);
    expect(ok.status).toBe(200);
    const firm = ok.body.data as Record<string, unknown>;
    expect(firm.taxId).toBeUndefined();
    expect(firm.id).toBeUndefined();
    expect(firm.slug).toBe(slug);
    expect(firm).toHaveProperty('name');
    expect(firm).toHaveProperty('tagline');
    expect(firm).toHaveProperty('logoAssetId');
    expect(firm).toHaveProperty('contact');
    const missing = await request(app.getHttpServer()).get(
      '/api/public/no-such-slug',
    );
    const foreign = await request(app.getHttpServer()).get(
      '/api/public/other-co',
    );
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(foreign.body.error.code).toBe(missing.body.error.code);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
  });

  it('isPublic=false is omitted; public project DTO has no budget/spend/coords', async () => {
    const hidden = await request(app.getHttpServer()).get(
      `/api/public/${slug}/projects`,
    );
    expect(hidden.status).toBe(200);
    const before = hidden.body.data as { id: string }[];
    expect(before.some((row) => row.id === projectId)).toBe(false);
    const workerDenied = await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/public`)
      .set(auth(worker))
      .send({ isPublic: true });
    expect(workerDenied.status).toBe(403);
    expect(workerDenied.body.error.code).toBe('FORBIDDEN');
    const published = await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/public`)
      .set(auth(admin))
      .send({ isPublic: true });
    expect(published.status).toBe(200);
    expect(published.body.data.isPublic).toBe(true);
    const listed = await request(app.getHttpServer()).get(
      `/api/public/${slug}/projects`,
    );
    const row = (listed.body.data as Record<string, unknown>[]).find(
      (item) => item.id === projectId,
    );
    expect(row).toBeDefined();
    expect(row?.plannedBudget).toBeUndefined();
    expect(row?.currentSpend).toBeUndefined();
    expect(row?.progressPercent).toBeUndefined();
    expect(row?.lat).toBeUndefined();
    expect(row?.lng).toBeUndefined();
    expect(row?.workers).toBeUndefined();
    expect(row?.name).toBeDefined();
    expect(row?.locality).toBe('Zenica');
    expect(row?.status).toBeDefined();
    expect(row).toHaveProperty('coverAssetId');
  });

  it('cover streams by asset id, not path query', async () => {
    const uploaded = await request(app.getHttpServer())
      .post('/api/public/assets')
      .set(auth(admin))
      .field('kind', 'COVER')
      .field('projectId', projectId)
      .attach('file', PNG, { filename: 'cover.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    const assetId = uploaded.body.data.id as string;
    const stream = await request(app.getHttpServer()).get(
      `/api/public/assets/${assetId}`,
    );
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/image\/png/);
    expect(stream.body.length).toBeGreaterThan(0);
    const leaked = JSON.stringify(stream.body);
    expect(leaked).not.toContain('minio');
    const missingAsset = await request(app.getHttpServer()).get(
      '/api/public/assets/clxxxxxxxxxxxxxxxxxxxxxx',
    );
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.body.error.code).toBe('NOT_FOUND');
  });
});
