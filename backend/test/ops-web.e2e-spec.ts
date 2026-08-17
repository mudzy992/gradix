import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('Phase 5 dashboard diary HSE (e2e)', () => {
  let app: INestApplication<App>;
  let admin: string;
  let ss: string;
  let worker: string;
  let projectId: string;
  let date: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    ss = (await login(app, 'ss@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    const ssId = (await request(app.getHttpServer()).get('/api/me').set(auth(ss))).body.data
      .id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({ name: `P5 ${Date.now()}`, code: `P5${Date.now().toString().slice(-6)}` });
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: ssId, role: 'SS' });
    date = new Date().toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('WORKER cannot list projects; dashboard has no spend', async () => {
    const list = await request(app.getHttpServer()).get('/api/projects').set(auth(worker));
    expect(list.status).toBe(403);
    const dash = await request(app.getHttpServer()).get('/api/dashboard').set(auth(worker));
    expect(dash.status).toBe(200);
    const keys = (dash.body.data.cards as { key: string }[]).map((card) => card.key);
    expect(keys).not.toContain('spend');
    expect(keys).toContain('myTasks');
    expect(dash.body.data.presence).toBeNull();
  });

  it('ADMIN dashboard cards include spend and unread', async () => {
    const dash = await request(app.getHttpServer()).get('/api/dashboard').set(auth(admin));
    expect(dash.status).toBe(200);
    const keys = (dash.body.data.cards as { key: string }[]).map((card) => card.key);
    expect(keys).toEqual(expect.arrayContaining(['activeProjects', 'spend', 'openTimers', 'unread']));
  });

  it('second diary create same day returns DIARY_CONFLICT; resolve B', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date, workDescription: 'A' });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(admin))
      .send({ projectId, date, workDescription: 'B' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DIARY_CONFLICT');
    expect(second.body.error.details.conflictData.incoming.workDescription).toBe('B');
    const resolved = await request(app.getHttpServer())
      .post('/api/sync/resolve-conflict')
      .set(auth(ss))
      .send({
        entityType: 'DIARY',
        projectId,
        date,
        choice: 'B',
        incoming: { projectId, date, workDescription: 'B' },
      });
    expect(resolved.status).toBe(201);
    expect(resolved.body.data.workDescription).toBe('B');
  });

  it('SS creates incident; WORKER list 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'Near miss' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('OPEN');
    const workerList = await request(app.getHttpServer()).get('/api/incidents').set(auth(worker));
    expect(workerList.status).toBe(403);
    const list = await request(app.getHttpServer()).get('/api/incidents').set(auth(ss));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
  });
});
