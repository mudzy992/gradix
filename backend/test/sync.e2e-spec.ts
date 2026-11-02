import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Sync push pull catalog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let worker: string;
  let driver: string;
  let workerId: string;
  let driverId: string;
  let projectId: string;
  let taskId: string;
  let truckId: string;
  let materialId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    driver = (await login(app, 'driver@gradix.local')).body.data.accessToken;
    workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id;
    driverId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(driver))
    ).body.data.id;
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `Sync e2e ${Date.now()}`,
        code: `SY${Date.now().toString().slice(-6)}`,
      });
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: workerId, role: 'WORKER' });
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: driverId, role: 'DRIVER' });
    const task = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(admin))
      .send({ projectId, title: 'Sync timer', assigneeIds: [workerId] });
    taskId = task.body.data.id as string;
    const truck = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Sync truck', type: 'TRUCK' });
    truckId = truck.body.data.id as string;
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Sync gravel', unit: 'M3' });
    materialId = material.body.data.id as string;
  });

  afterAll(async () => {
    if (driverId) {
      await prisma.userRoleAssignment.deleteMany({
        where: { userId: driverId, role: 'WORKER' },
      });
    }
    await app?.close();
  });

  it('online timer startedAt 400; offline push accepts client clock and rejects +10min', async () => {
    const online = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, startedAt: new Date().toISOString() });
    expect(online.status).toBe(400);
    expect(online.body.error.code).toBe('VALIDATION_FAILED');
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const localId = `timer-${Date.now()}`;
    const pushed = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(worker))
      .send({
        items: [
          {
            type: 'TIMER',
            localId,
            deviceId: 'e2e-phone',
            action: 'start',
            payload: { taskId, startedAt },
          },
        ],
      });
    expect(pushed.status).toBe(200);
    expect(pushed.body.data.results[0].ok).toBe(true);
    const again = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(worker))
      .send({
        items: [
          {
            type: 'TIMER',
            localId,
            deviceId: 'e2e-phone',
            action: 'start',
            payload: { taskId, startedAt },
          },
        ],
      });
    expect(again.body.data.results[0].serverId).toBe(
      pushed.body.data.results[0].serverId,
    );
    const future = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(worker))
      .send({
        items: [
          {
            type: 'TIMER',
            localId: `future-${Date.now()}`,
            deviceId: 'e2e-phone',
            payload: {
              taskId,
              startedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            },
          },
        ],
      });
    expect(future.body.data.results[0].ok).toBe(false);
    expect(future.body.data.results[0].code).toBe('VALIDATION_FAILED');
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
  });

  it('driver cannot push timer; catalog has ttl 24h; decommissioned trip 409; duplicate trip localId', async () => {
    const driverTimer = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(driver))
      .send({
        items: [
          {
            type: 'TIMER',
            localId: `drv-${Date.now()}`,
            deviceId: 'e2e-phone',
            payload: { taskId, startedAt: new Date().toISOString() },
          },
        ],
      });
    expect(driverTimer.body.data.results[0].code).toBe('FORBIDDEN');
    const catalog = await request(app.getHttpServer())
      .get('/api/sync/catalog')
      .set(auth(driver));
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.ttlHours).toBe(24);
    expect(catalog.body.data.pulledAt).toBeDefined();
    expect(Array.isArray(catalog.body.data.projects)).toBe(true);
    const dead = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Dead truck', type: 'TRUCK' });
    await request(app.getHttpServer())
      .delete(`/api/machines/${dead.body.data.id}`)
      .set(auth(admin));
    const held = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(driver))
      .send({
        items: [
          {
            type: 'TRIP',
            localId: `dead-${Date.now()}`,
            deviceId: 'e2e-phone',
            payload: {
              projectId,
              machineId: dead.body.data.id,
              materialId,
              quantity: '3',
              originText: 'Site',
            },
          },
        ],
      });
    expect(held.body.data.results[0].ok).toBe(false);
    expect(held.body.data.results[0].code).toBe('CONFLICT');
    const localId = `trip-${Date.now()}`;
    const body = {
      items: [
        {
          type: 'TRIP',
          localId,
          deviceId: 'e2e-phone',
          payload: {
            projectId,
            machineId: truckId,
            materialId,
            quantity: '8',
            originText: 'Quarry',
          },
        },
      ],
    };
    const first = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(driver))
      .send(body);
    const second = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(driver))
      .send(body);
    expect(first.body.data.results[0].ok).toBe(true);
    expect(second.body.data.results[0].serverId).toBe(
      first.body.data.results[0].serverId,
    );
    const pulled = await request(app.getHttpServer())
      .post('/api/sync/pull')
      .set(auth(driver))
      .send({ since: new Date(0).toISOString() });
    expect(pulled.status).toBe(200);
    expect(
      pulled.body.data.trips.some(
        (row: { localId: string }) => row.localId === localId,
      ),
    ).toBe(true);
  });

  it('DRIVER+WORKER can push timer after dual role', async () => {
    await prisma.userRoleAssignment.create({
      data: { userId: driverId, role: 'WORKER' },
    });
    const dual = await login(app, 'driver@gradix.local');
    const token = dual.body.data.accessToken as string;
    await request(app.getHttpServer())
      .post(`/api/tasks/${taskId}/assignees`)
      .set(auth(admin))
      .send({ userId: driverId });
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const pushed = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set(auth(token))
      .send({
        items: [
          {
            type: 'TIMER',
            localId: `dual-${Date.now()}`,
            deviceId: 'e2e-phone',
            payload: { taskId, startedAt },
          },
        ],
      });
    expect(pushed.body.data.results[0].ok).toBe(true);
    await request(app.getHttpServer()).post('/api/timer/stop').set(auth(token));
    await prisma.userRoleAssignment.deleteMany({
      where: { userId: driverId, role: 'WORKER' },
    });
  });
});
