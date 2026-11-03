import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Fleet logistics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let ss: string;
  let worker: string;
  let driver: string;
  let workerId: string;
  let driverId: string;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    ss = (await login(app, 'ss@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    driver = (await login(app, 'driver@gradix.local')).body.data.accessToken;
    workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id;
    driverId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(driver))
    ).body.data.id;
    const ssId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(ss))
    ).body.data.id;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `Fleet e2e ${Date.now()}`,
        code: `FL${Date.now().toString().slice(-6)}`,
        lat: '43.8563000',
        lng: '18.4131000',
        geofenceRadius: 200,
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
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: driverId, role: 'DRIVER' });
    const task = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(ss))
      .send({ projectId, title: 'Fleet timer', assigneeIds: [workerId] });
    taskId = task.body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('timer machineId: IDLE 200, garbage 400, mutex 409, hours += duration/60, geofence not 403', async () => {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Bager e2e', type: 'EXCAVATOR' });
    expect(machine.status).toBe(201);
    const machineId = machine.body.data.id as string;
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    await request(app.getHttpServer()).post('/api/timer/stop').set(auth(ss));
    const garbage = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, machineId: 'not-a-machine' });
    expect(garbage.status).toBe(400);
    const far = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, machineId, lat: '0.0000000', lng: '0.0000000' });
    expect(far.status).toBe(201);
    const clash = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(ss))
      .send({ taskId, machineId });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('MACHINE_IN_USE');
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const sessionId = far.body.data.id as string;
    const amended = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(ss))
      .send({
        entityType: 'TIMER',
        entityId: sessionId,
        field: 'durationMinutes',
        newValue: '60',
        reason: 'hours check',
      });
    expect(amended.status).toBe(201);
    const after = await request(app.getHttpServer())
      .get(`/api/machines/${machineId}`)
      .set(auth(admin));
    expect(Number(after.body.data.currentWorkingHours)).toBe(1);
  });

  it('trips: quantity required, ON_HOLD 409, complete without dest GPS, no PATCH (404), amend whitelist', async () => {
    const truck = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Kiper e2e', type: 'TRUCK' });
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Šljunak e2e', unit: 'M3' });
    const missingQty = await request(app.getHttpServer())
      .post('/api/trips')
      .set(auth(driver))
      .send({
        projectId,
        machineId: truck.body.data.id,
        materialId: material.body.data.id,
        originText: 'Gradilište',
      });
    expect(missingQty.status).toBe(400);
    await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/status`)
      .set(auth(admin))
      .send({ status: 'IN_PROGRESS' });
    await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/status`)
      .set(auth(admin))
      .send({ status: 'ON_HOLD' });
    const held = await request(app.getHttpServer())
      .post('/api/trips')
      .set(auth(driver))
      .send({
        projectId,
        machineId: truck.body.data.id,
        materialId: material.body.data.id,
        quantity: '12.5',
        originText: 'Gradilište',
      });
    expect(held.status).toBe(409);
    expect(held.body.error.code).toBe('PROJECT_ON_HOLD');
    await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}/status`)
      .set(auth(admin))
      .send({ status: 'IN_PROGRESS' });
    const trip = await request(app.getHttpServer())
      .post('/api/trips')
      .set(auth(driver))
      .send({
        projectId,
        machineId: truck.body.data.id,
        materialId: material.body.data.id,
        quantity: '12.5',
        originText: 'Gradilište',
      });
    expect(trip.status).toBe(201);
    const completed = await request(app.getHttpServer())
      .post(`/api/trips/${trip.body.data.id}/complete`)
      .set(auth(driver))
      .send({});
    expect(completed.status).toBe(201);
    // BE-10 / B9 (odluka vlasnika, opcija A): izmjena ture ne postoji — zapis je nepromjenjiv,
    // ispravke idu kroz `/amendments`. Ruta je uklonjena, pa je odgovor 404.
    const put = await request(app.getHttpServer())
      .patch(`/api/trips/${trip.body.data.id}`)
      .set(auth(driver))
      .send({ notes: 'nope' });
    expect(put.status).toBe(404);
    const qty = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(ss))
      .send({
        entityType: 'TRIP',
        entityId: trip.body.data.id,
        field: 'quantity',
        newValue: '13',
        reason: 'vagar uskladiti',
      });
    expect(qty.status).toBe(201);
    const badField = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(ss))
      .send({
        entityType: 'TRIP',
        entityId: trip.body.data.id,
        field: 'driverId',
        newValue: workerId,
        reason: 'should fail',
      });
    expect(badField.status).toBe(400);
  });

  it('fuel: projectId required when assigned; spend grows; receipt optional; DECOMMISSIONED 409', async () => {
    const idle = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Loader fuel', type: 'LOADER' });
    await request(app.getHttpServer())
      .post(`/api/machines/${idle.body.data.id}/assign`)
      .set(auth(admin))
      .send({ projectId, userId: driverId });
    const missing = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(driver))
      .send({ machineId: idle.body.data.id, liters: '10', unitPrice: '2.50' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('FUEL_PROJECT_REQUIRED');
    const before = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    const spendBefore = Number(before.body.data.currentSpend);
    const created = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(driver))
      .send({
        machineId: idle.body.data.id,
        projectId,
        liters: '10',
        unitPrice: '2.50',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.receiptPath).toBeNull();
    const after = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set(auth(admin));
    expect(Number(after.body.data.currentSpend)).toBe(spendBefore + 25);
    const dead = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Dead machine', type: 'OTHER' });
    await request(app.getHttpServer())
      .delete(`/api/machines/${dead.body.data.id}`)
      .set(auth(admin));
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const startDead = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, machineId: dead.body.data.id });
    expect(startDead.status).toBe(409);
    const tripDead = await request(app.getHttpServer())
      .post('/api/fuel')
      .set(auth(admin))
      .send({ machineId: dead.body.data.id, liters: '1', unitPrice: '1' });
    expect(tripDead.status).toBe(409);
  });

  it('picker DRIVER 200 without budget; WORKER 403', async () => {
    const driverPicker = await request(app.getHttpServer())
      .get('/api/projects/picker')
      .set(auth(driver));
    expect(driverPicker.status).toBe(200);
    const row = (
      driverPicker.body.data as { id: string; plannedBudget?: unknown }[]
    ).find((item) => item.id === projectId);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('plannedBudget');
    expect(row).not.toHaveProperty('currentSpend');
    expect(row).not.toHaveProperty('client');
    const workerPicker = await request(app.getHttpServer())
      .get('/api/projects/picker')
      .set(auth(worker));
    expect(workerPicker.status).toBe(403);
  });

  it('presence 5 min in / 31 min out, no coordinates; IoT missing key 401', async () => {
    const ping = await request(app.getHttpServer())
      .post('/api/locations/me')
      .set(auth(worker))
      .send({ lat: '43.8563000', lng: '18.4131000' });
    expect(ping.status).toBe(201);
    const present = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/presence`)
      .set(auth(ss));
    expect(present.status).toBe(200);
    const five = (
      present.body.data as { userId: string; lat?: unknown }[]
    ).find((row) => row.userId === workerId);
    expect(five).toBeDefined();
    expect(five).not.toHaveProperty('lat');
    expect(five).not.toHaveProperty('lng');
    await prisma.userLocation.updateMany({
      where: {
        userId: workerId,
        recordedAt: { gte: new Date(Date.now() - 60_000) },
      },
      data: { recordedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const stale = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/presence`)
      .set(auth(ss));
    const gone = (stale.body.data as { userId: string }[]).find(
      (row) => row.userId === workerId,
    );
    expect(gone).toBeUndefined();
    const iot = await request(app.getHttpServer())
      .post('/api/iot/gps')
      .send({ lat: '1', lng: '1' });
    expect(iot.status).toBe(401);
    expect(iot.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  /**
   * BE-10 (B10): flota, GPS uređaji, ture, gorivo i šifarnici su ranije bili **van audita**
   * (`AuditAction` je bio zatvoren enum). Ovaj test prolazi kroz sve pet servisa i čita
   * `AuditEvent` direktno iz baze — API za audit još ne postoji.
   */
  it('audit: flota, GPS, ture, gorivo i šifarnici se bilježe (B10)', async () => {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: 'Audit machine', type: 'TRUCK' });
    expect(machine.status).toBe(201);
    const machineId = machine.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/machines/${machineId}`)
      .set(auth(admin))
      .send({ name: 'Audit machine 2' });
    await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/assign`)
      .set(auth(admin))
      .send({ projectId, userId: driverId });
    await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/unassign`)
      .set(auth(admin));
    const device = await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices`)
      .set(auth(admin))
      .send({ name: 'Teltonika audit' });
    expect(device.status).toBe(201);
    const deviceId = device.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/machines/${machineId}/devices/${deviceId}`)
      .set(auth(admin))
      .send({ isActive: false });
    await request(app.getHttpServer())
      .post(`/api/machines/${machineId}/devices/${deviceId}/rotate`)
      .set(auth(admin));
    const material = await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth(admin))
      .send({ name: 'Audit material', unit: 'M3' });
    const materialId = material.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/materials/${materialId}`)
      .set(auth(admin))
      .send({ name: 'Audit material 2' });
    await request(app.getHttpServer())
      .delete(`/api/materials/${materialId}`)
      .set(auth(admin));
    const depot = await request(app.getHttpServer())
      .post('/api/depots')
      .set(auth(admin))
      .send({ name: 'Audit depot' });
    expect(depot.status).toBe(201);
    const depotId = depot.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/depots/${depotId}`)
      .set(auth(admin))
      .send({ name: 'Audit depot 2' });
    await request(app.getHttpServer())
      .delete(`/api/depots/${depotId}`)
      .set(auth(admin));
    // Tura i gorivo: audit akcije `TRIP_*` / `FUEL_CREATED` provjeravamo na postojećim
    // zapisima iz ranijih testova (isti `projectId`).
    const trip = await prisma.trip.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    expect(trip).not.toBeNull();
    const fuel = await prisma.fuelEntry.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    expect(fuel).not.toBeNull();

    const actions = async (entityType: string, entityId: string) =>
      (
        await prisma.auditEvent.findMany({ where: { entityType, entityId } })
      ).map((row) => row.action);

    expect(await actions('Machine', machineId)).toEqual(
      expect.arrayContaining([
        'MACHINE_CREATED',
        'MACHINE_UPDATED',
        'MACHINE_ASSIGNED',
        'MACHINE_UNASSIGNED',
      ]),
    );
    expect(await actions('GpsDevice', deviceId)).toEqual(
      expect.arrayContaining([
        'IOT_DEVICE_CREATED',
        'IOT_DEVICE_UPDATED',
        'IOT_DEVICE_ROTATED',
      ]),
    );
    expect(await actions('Material', materialId)).toEqual(
      expect.arrayContaining([
        'MATERIAL_CREATED',
        'MATERIAL_UPDATED',
        'MATERIAL_REMOVED',
      ]),
    );
    expect(await actions('Depot', depotId)).toEqual(
      expect.arrayContaining([
        'DEPOT_CREATED',
        'DEPOT_UPDATED',
        'DEPOT_REMOVED',
      ]),
    );
    expect(await actions('Trip', trip!.id)).toEqual(
      expect.arrayContaining(['TRIP_CREATED', 'TRIP_COMPLETED']),
    );
    expect(await actions('FuelEntry', fuel!.id)).toContain('FUEL_CREATED');
  });
});
