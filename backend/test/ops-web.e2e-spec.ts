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
    const ssId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(ss))
    ).body.data.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `P5 ${Date.now()}`,
        code: `P5${Date.now().toString().slice(-6)}`,
      });
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: ssId, role: 'SS' });
    // BE-11 (opcija A): radnik mora biti na projektu da bi tamo mogao prijaviti incident.
    const workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: workerId, role: 'WORKER' });
    date = new Date().toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('WORKER cannot list projects; dashboard has no spend', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(worker));
    expect(list.status).toBe(403);
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set(auth(worker));
    expect(dash.status).toBe(200);
    const keys = (dash.body.data.cards as { key: string }[]).map(
      (card) => card.key,
    );
    expect(keys).not.toContain('spend');
    expect(keys).toContain('myTasks');
    expect(dash.body.data.presence).toBeNull();
  });

  it('ADMIN dashboard cards include spend and unread', async () => {
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set(auth(admin));
    expect(dash.status).toBe(200);
    const keys = (dash.body.data.cards as { key: string }[]).map(
      (card) => card.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'activeProjects',
        'spend',
        'openTimers',
        'unread',
      ]),
    );
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
    expect(
      second.body.error.details.conflictData.incoming.workDescription,
    ).toBe('B');
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

  /**
   * BE-11 / odluka vlasnika (opcija A): prijavljivač vidi **svoje** prijave.
   * Prije je WORKER dobijao 403 i na listu i na vlastitu prijavu, iako je jedini
   * koji HSE prijave unosi. Tuđe prijave ostaju nevidljive (scope po `userId`).
   */
  it('HSE: radnik vidi samo vlastite prijave; tuđe ne vidi (opcija A)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'Near miss' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('OPEN');
    const ssIncidentId = created.body.data.id as string;

    const workerEmpty = await request(app.getHttpServer())
      .get('/api/incidents')
      .set(auth(worker));
    expect(workerEmpty.status).toBe(200);
    expect(
      (workerEmpty.body.data as { id: string }[]).map((row) => row.id),
    ).not.toContain(ssIncidentId);

    const own = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(worker))
      .send({ projectId, severity: 'MEDIUM', description: 'Klizav pod' });
    expect(own.status).toBe(201);
    const ownId = own.body.data.id as string;

    const workerList = await request(app.getHttpServer())
      .get('/api/incidents')
      .set(auth(worker));
    expect(workerList.status).toBe(200);
    const ids = (workerList.body.data as { id: string }[]).map((row) => row.id);
    expect(ids).toContain(ownId);
    expect(ids).not.toContain(ssIncidentId);

    // prijavljivač smije zatvoriti svoju prijavu, tuđu ne (404, ne 403 — ne otkriva postojanje)
    const ackOwn = await request(app.getHttpServer())
      .patch(`/api/incidents/${ownId}`)
      .set(auth(worker))
      .send({ status: 'ACK' });
    expect(ackOwn.status).toBe(200);
    expect(ackOwn.body.data.status).toBe('ACK');
    const patchForeign = await request(app.getHttpServer())
      .patch(`/api/incidents/${ssIncidentId}`)
      .set(auth(worker))
      .send({ status: 'CLOSED' });
    expect(patchForeign.status).toBe(404);

    const list = await request(app.getHttpServer())
      .get('/api/incidents')
      .set(auth(ss));
    expect(list.status).toBe(200);
    expect((list.body.data as { id: string }[]).map((row) => row.id)).toContain(
      ssIncidentId,
    );
  });

  /**
   * BE-11: PDF dnevnika je padao na 500 za bh. slova (`č`, `ć`, `đ` — WinAnsi ih ne
   * kodira) i sjekao je tekst na 110 znakova; sada se lomi i ide na više stranica.
   */
  it('diary: PDF sa bh. slovima i višerednim tekstom; radnik bez diary.read 403', async () => {
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const created = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({
        projectId,
        date: day,
        workDescription:
          'Čišćenje čelične konstrukcije i đžepova temelja.\nDrugi red — šljunak.',
        problemsNoted: 'Čekamo ćeramičara; žalba na buku.',
      });
    expect(created.status).toBe(201);
    const pdf = await request(app.getHttpServer())
      .post(`/api/diary/${created.body.data.id}/pdf`)
      .set(auth(ss))
      .send({});
    expect(pdf.status).toBe(201);
    expect(pdf.body.data.pdfUrl).toMatch(/\.pdf$/);
    const denied = await request(app.getHttpServer())
      .post(`/api/diary/${created.body.data.id}/pdf`)
      .set(auth(worker))
      .send({});
    expect(denied.status).toBe(403);
  });

  it('diary: temperatura i koordinate fotografije se validiraju (BE-11)', async () => {
    const day = new Date(Date.now() + 172_800_000).toISOString().slice(0, 10);
    const badTemp = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date: day, tempMin: 'abc' });
    expect(badTemp.status).toBe(400);
    const hugeTemp = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date: day, tempMax: '500' });
    expect(hugeTemp.status).toBe(400);
    const ok = await request(app.getHttpServer())
      .post('/api/diary')
      .set(auth(ss))
      .send({ projectId, date: day, tempMin: '-3.5', tempMax: '11.2' });
    expect(ok.status).toBe(201);
    const entryId = ok.body.data.id as string;
    const me = await request(app.getHttpServer()).get('/api/me').set(auth(ss));
    const companyId = me.body.data.company.id as string;
    const path = `${companyId}/2026/11/photo-${Date.now()}.png`;
    const halfCoords = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '43.85' });
    expect(halfCoords.status).toBe(400);
    const outOfRange = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '999', lng: '18.4' });
    expect(outOfRange.status).toBe(400);
    const first = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '43.85', lng: '18.41', caption: 'Temelj' });
    expect(first.status).toBe(201);
    // isti objekat dvaput (offline replay) → isti zapis, bez duplikata
    const again = await request(app.getHttpServer())
      .post(`/api/diary/${entryId}/photos`)
      .set(auth(ss))
      .send({ path, lat: '43.85', lng: '18.41', caption: 'Temelj' });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(first.body.data.id);
  });

  it('HSE: nevalidan status filter i nevalidne koordinate zadatka (BE-11)', async () => {
    const badStatus = await request(app.getHttpServer())
      .get('/api/incidents')
      .query({ status: 'BOGUS' })
      .set(auth(ss));
    expect(badStatus.status).toBe(400);
    const goodStatus = await request(app.getHttpServer())
      .get('/api/incidents')
      .query({ status: 'OPEN' })
      .set(auth(ss));
    expect(goodStatus.status).toBe(200);
    const badTask = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'x', taskId: 'nema' });
    expect(badTask.status).toBe(400);
    const halfCoords = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({ projectId, severity: 'LOW', description: 'x', lat: '43.85' });
    expect(halfCoords.status).toBe(400);
    const outOfRange = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({
        projectId,
        severity: 'LOW',
        description: 'x',
        lat: '43.85',
        lng: '999',
      });
    expect(outOfRange.status).toBe(400);
    const ok = await request(app.getHttpServer())
      .post('/api/incidents')
      .set(auth(ss))
      .send({
        projectId,
        severity: 'MEDIUM',
        description: 'Near miss',
        lat: '43.85',
        lng: '18.41',
      });
    expect(ok.status).toBe(201);
  });
});
