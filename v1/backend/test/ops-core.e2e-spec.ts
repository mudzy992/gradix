import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';

describe('Tasks timer quantities (e2e)', () => {
  let app: INestApplication<App>;
  let admin: string;
  let ss: string;
  let worker: string;
  let projectId: string;
  let assignedTaskId: string;
  let pendingTaskId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    ss = (await login(app, 'ss@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    const workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id as string;
    const ssId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(ss))
    ).body.data.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `Ops e2e ${Date.now()}`,
        code: `E2E${Date.now().toString().slice(-6)}`,
      });
    expect(created.status).toBe(201);
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: ssId, role: 'SS' });
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: workerId, role: 'WORKER' });
    const assigned = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(ss))
      .send({ projectId, title: 'Assigned e2e', assigneeIds: [workerId] });
    const pending = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(ss))
      .send({ projectId, title: 'Pending e2e' });
    assignedTaskId = assigned.body.data.id as string;
    pendingTaskId = pending.body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('garbage machineId 400; PENDING start 409; worker timer list 403; SS list 200', async () => {
    const bad = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId: assignedTaskId, machineId: 'x' });
    expect(bad.status).toBe(400);
    const pending = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(ss))
      .send({ taskId: pendingTaskId });
    expect(pending.status).toBe(409);
    const workerList = await request(app.getHttpServer())
      .get(`/api/timer?projectId=${projectId}`)
      .set(auth(worker));
    expect(workerList.status).toBe(403);
    const ssList = await request(app.getHttpServer())
      .get(`/api/timer?projectId=${projectId}`)
      .set(auth(ss));
    expect(ssList.status).toBe(200);
  });

  it('worker start/pause/stop; second start while open 409; complete ASSIGNED; PENDING complete 409', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId: assignedTaskId });
    expect(started.status).toBe(201);
    const again = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId: assignedTaskId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TIMER_ALREADY_OPEN');
    const paused = await request(app.getHttpServer())
      .post('/api/timer/pause')
      .set(auth(worker));
    expect(paused.status).toBe(201);
    const stillOpen = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId: assignedTaskId });
    expect(stillOpen.status).toBe(409);
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const workerComplete = await request(app.getHttpServer())
      .post(`/api/tasks/${assignedTaskId}/complete`)
      .set(auth(worker));
    expect(workerComplete.status).toBe(403);
    const pendingComplete = await request(app.getHttpServer())
      .post(`/api/tasks/${pendingTaskId}/complete`)
      .set(auth(ss));
    expect(pendingComplete.status).toBe(409);
    const fresh = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(ss))
      .send({
        projectId,
        title: 'Assigned no timer',
        assigneeIds: [
          (await request(app.getHttpServer()).get('/api/me').set(auth(worker)))
            .body.data.id,
        ],
      });
    const done = await request(app.getHttpServer())
      .post(`/api/tasks/${fresh.body.data.id}/complete`)
      .set(auth(ss));
    expect(done.status).toBe(201);
  });

  it('quantities: worker 403; SS executed OK; SS planned 403; executed>planned 200', async () => {
    const workerPost = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/quantities`)
      .set(auth(worker))
      .send({ name: 'x', unit: 'M3', plannedQty: '1' });
    expect(workerPost.status).toBe(403);
    const created = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/quantities`)
      .set(auth(admin))
      .send({ name: 'Šljunak', unit: 'M3', plannedQty: '10' });
    expect(created.status).toBe(201);
    const ssPlanned = await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/quantities/${created.body.data.id}`)
      .set(auth(ss))
      .send({ plannedQty: '20' });
    expect(ssPlanned.status).toBe(403);
    const ssExec = await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/quantities/${created.body.data.id}`)
      .set(auth(ss))
      .send({ executedQty: '15' });
    expect(ssExec.status).toBe(200);
    expect(Number(ssExec.body.data.executedQty)).toBe(15);
  });

  it('WORKER amend 403; open amend 409; SS closed OK', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId: assignedTaskId });
    const workerAmend = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(worker))
      .send({
        entityType: 'TIMER',
        entityId: started.body.data.id,
        field: 'durationMinutes',
        newValue: '5',
        reason: 'typo fix',
      });
    expect(workerAmend.status).toBe(403);
    const openAmend = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(ss))
      .send({
        entityType: 'TIMER',
        entityId: started.body.data.id,
        field: 'durationMinutes',
        newValue: '5',
        reason: 'typo fix',
      });
    expect(openAmend.status).toBe(409);
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const closed = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(ss))
      .send({
        entityType: 'TIMER',
        entityId: started.body.data.id,
        field: 'durationMinutes',
        newValue: '12',
        reason: 'typo fix',
      });
    expect(closed.status).toBe(201);
  });
});
