import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Phase 11 IoT fleet (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createMachine(name: string): Promise<string> {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name, type: 'EXCAVATOR' });
    expect(machine.status).toBe(201);
    return machine.body.data.id as string;
  }

  it('create device once, GET hides key, second device 409, ingest IOT', async () => {
    const machineId = await createMachine('IoT ingest');
    const created = await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices`)
      .set(auth(admin))
      .send({ name: 'Tracker A' });
    expect(created.status).toBe(201);
    const apiKey = created.body.data.apiKey as string;
    expect(apiKey.length).toBeGreaterThan(10);
    const listed = await request(app.getHttpServer())
      .get(`/api/machines/${machineId}/devices`)
      .set(auth(admin));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).not.toHaveProperty('apiKey');
    expect(listed.body.data[0]).not.toHaveProperty('apiKeyHash');
    expect(listed.body.data[0]).not.toHaveProperty('keyLookup');
    const dup = await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices`)
      .set(auth(admin))
      .send({ name: 'Tracker B' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('IOT_DEVICE_EXISTS');
    const ingest = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', apiKey)
      .send({ lat: '43.8563000', lng: '18.4131000' });
    expect(ingest.status).toBe(201);
    const machine = await request(app.getHttpServer())
      .get(`/api/machines/${machineId}`)
      .set(auth(admin));
    expect(machine.body.data.lastGpsSource).toBe('IOT');
    expect(JSON.stringify(machine.body.data)).not.toContain(apiKey);
    const record = await prisma.gpsRecord.findFirst({
      where: { machineId },
      orderBy: { recordedAt: 'desc' },
    });
    expect(record?.source).toBe('IOT');
  });

  it('bad key 401; rotate invalidates old key', async () => {
    const machineId = await createMachine('IoT rotate');
    const created = await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices`)
      .set(auth(admin))
      .send({ name: 'Tracker B' });
    const oldKey = created.body.data.apiKey as string;
    const deviceId = created.body.data.id as string;
    const missing = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .send({ lat: '43.8500000', lng: '18.4100000' });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    const bad = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', 'not-a-real-device-key-value')
      .send({ lat: '43.8500000', lng: '18.4100000' });
    expect(bad.status).toBe(401);
    const rotated = await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices/${deviceId}/rotate`)
      .set(auth(admin));
    expect(rotated.status).toBe(201);
    const newKey = rotated.body.data.apiKey as string;
    const listedAfter = await request(app.getHttpServer())
      .get(`/api/machines/${machineId}/devices`)
      .set(auth(admin));
    expect(listedAfter.body.data[0]).not.toHaveProperty('apiKey');
    const stale = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', oldKey)
      .send({ lat: '43.8510000', lng: '18.4110000' });
    expect(stale.status).toBe(401);
    const fresh = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', newKey)
      .send({ lat: '43.8510000', lng: '18.4110000' });
    expect(fresh.status).toBe(201);
  });

  it('inactive and decommissioned ingest 403; rate limit 429', async () => {
    const machineId = await createMachine('IoT throttle');
    const created = await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices`)
      .set(auth(admin))
      .send({ name: 'Tracker C' });
    const apiKey = created.body.data.apiKey as string;
    const deviceId = created.body.data.id as string;
    const first = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', apiKey)
      .send({ lat: '43.8520000', lng: '18.4120000' });
    expect(first.status).toBe(201);
    const burst = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', apiKey)
      .send({ lat: '43.8521000', lng: '18.4121000' });
    expect(burst.status).toBe(429);
    await prisma.machine.update({
      where: { id: machineId },
      data: { lastGpsAt: new Date(Date.now() - 10_000) },
    });
    await request(app.getHttpServer())
      .patch(`/api/machines/${machineId}/devices/${deviceId}`)
      .set(auth(admin))
      .send({ isActive: false });
    const inactive = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', apiKey)
      .send({ lat: '43.8530000', lng: '18.4130000' });
    expect(inactive.status).toBe(403);
    expect(inactive.body.error.code).toBe('FORBIDDEN');
    await request(app.getHttpServer())
      .patch(`/api/machines/${machineId}/devices/${deviceId}`)
      .set(auth(admin))
      .send({ isActive: true });
    const dead = await request(app.getHttpServer()).delete(`/api/machines/${machineId}`).set(auth(admin));
    expect(dead.status).toBe(200);
    const decommissioned = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .set('X-Device-Key', apiKey)
      .send({ lat: '43.8540000', lng: '18.4140000' });
    expect(decommissioned.status).toBe(403);
    expect(decommissioned.body.error.code).toBe('FORBIDDEN');
  });
});
