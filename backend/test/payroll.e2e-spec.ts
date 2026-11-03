import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import ExcelJS from 'exceljs';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Phase 9 payroll (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let ss: string;
  let worker: string;
  let accountant: string;
  let adminId: string;
  let ssId: string;
  let workerId: string;
  let companyId: string;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    ss = (await login(app, 'ss@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken;
    const adminMe = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(admin));
    adminId = adminMe.body.data.id as string;
    companyId = adminMe.body.data.company.id as string;
    ssId = (await request(app.getHttpServer()).get('/api/me').set(auth(ss)))
      .body.data.id as string;
    workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id as string;
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    await request(app.getHttpServer()).post('/api/timer/stop').set(auth(ss));
    await request(app.getHttpServer()).post('/api/timer/stop').set(auth(admin));
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `Pay ${Date.now()}`,
        code: `PY${Date.now().toString().slice(-6)}`,
      });
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: ssId, role: 'SS' });
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: workerId, role: 'WORKER' });
    const task = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(ss))
      .send({
        projectId,
        title: 'Pay timer',
        assigneeIds: [workerId, ssId, adminId],
      });
    taskId = task.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/users/${workerId}`)
      .set(auth(admin))
      .send({ hourlyRate: '20.00' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('new session PENDING; GPS not required; SS self 403; ADMIN self 200; worker list 403', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId });
    expect(started.status).toBe(201);
    expect(started.body.data.approvalStatus).toBe('PENDING');
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const liveId = started.body.data.id as string;
    const ssOk = await request(app.getHttpServer())
      .post(`/api/payroll/sessions/${liveId}/approve`)
      .set(auth(ss));
    expect(ssOk.status).toBe(200);
    const own = await insertSession({
      userId: ssId,
      startedAt: new Date('2023-10-02T08:00:00.000Z'),
      closedAt: new Date('2023-10-02T09:00:00.000Z'),
      durationMinutes: 60,
    });
    const selfSs = await request(app.getHttpServer())
      .post(`/api/payroll/sessions/${own.id}/approve`)
      .set(auth(ss));
    expect(selfSs.status).toBe(403);
    expect(selfSs.body.error.code).toBe('PAYROLL_SELF_APPROVE');
    const adminOwn = await insertSession({
      userId: adminId,
      startedAt: new Date('2023-10-03T08:00:00.000Z'),
      closedAt: new Date('2023-10-03T09:00:00.000Z'),
      durationMinutes: 60,
    });
    const selfAdmin = await request(app.getHttpServer())
      .post(`/api/payroll/sessions/${adminOwn.id}/approve`)
      .set(auth(admin));
    expect(selfAdmin.status).toBe(200);
    // BE-13 (F-01): odluka je atomska — druga odluka na istu sesiju je 409, ne
    // tiho prepisivanje (prije je `update` pregazio već donesenu odluku).
    const again = await request(app.getHttpServer())
      .post(`/api/payroll/sessions/${adminOwn.id}/reject`)
      .set(auth(admin))
      .send({ reason: 'too late' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
    const workerList = await request(app.getHttpServer())
      .get('/api/payroll/sessions')
      .set(auth(worker));
    expect(workerList.status).toBe(403);
  });

  it('pause not in export; PENDING/REJECTED not in total; xlsx', async () => {
    await insertSession({
      approvalStatus: 'APPROVED',
      startedAt: new Date('2023-11-10T08:00:00.000Z'),
      closedAt: new Date('2023-11-10T10:00:00.000Z'),
      durationMinutes: 90,
      pauseAccumMinutes: 30,
    });
    await insertSession({
      startedAt: new Date('2023-11-11T08:00:00.000Z'),
      closedAt: new Date('2023-11-11T09:00:00.000Z'),
      durationMinutes: 60,
    });
    await insertSession({
      approvalStatus: 'REJECTED',
      startedAt: new Date('2023-11-12T08:00:00.000Z'),
      closedAt: new Date('2023-11-12T10:00:00.000Z'),
      durationMinutes: 120,
    });
    const summary = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2023, month: 11 })
      .set(auth(accountant));
    expect(summary.status).toBe(200);
    expect(summary.body.data.approvedMinutes).toBe(90);
    expect(summary.body.data.approvedAmount).toBe('30.00');
    expect(summary.body.data.pendingCount).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.rejectedCount).toBeGreaterThanOrEqual(1);
    const exported = await request(app.getHttpServer())
      .get('/api/payroll/export')
      .query({ year: 2023, month: 11 })
      .set(auth(admin))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    expect(String(exported.headers['content-type'])).toContain('spreadsheetml');
    // BE-13 (F-06): ime fajla nosi period.
    expect(String(exported.headers['content-disposition'])).toContain(
      'payroll-2023-11-01_2023-11-30.xlsx',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    const durations = (workbook.worksheets[0].getColumn(5).values ?? []).slice(
      2,
      -1,
    );
    expect(durations).toContain(90);
    expect(durations).not.toContain(120);
    expect(durations).not.toContain(60);
  });

  it('Sarajevo month != UTC; overnight stays in startedAt month; amend APPROVED to PENDING', async () => {
    await insertSession({
      approvalStatus: 'APPROVED',
      startedAt: new Date('2026-07-31T22:30:00.000Z'),
      closedAt: new Date('2026-07-31T23:30:00.000Z'),
      durationMinutes: 60,
    });
    const august = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2026, month: 8 })
      .set(auth(admin));
    const july = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2026, month: 7 })
      .set(auth(admin));
    expect(august.body.data.approvedMinutes).toBeGreaterThanOrEqual(60);
    expect(july.body.data.approvedMinutes).toBe(0);
    await insertSession({
      approvalStatus: 'APPROVED',
      startedAt: new Date('2026-08-31T21:30:00.000Z'),
      closedAt: new Date('2026-08-31T23:00:00.000Z'),
      durationMinutes: 90,
    });
    const august2 = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2026, month: 8 })
      .set(auth(admin));
    const september = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2026, month: 9 })
      .set(auth(admin));
    expect(august2.body.data.approvedMinutes).toBeGreaterThanOrEqual(150);
    expect(september.body.data.approvedMinutes).toBe(0);
    const amended = await insertSession({
      approvalStatus: 'APPROVED',
      startedAt: new Date('2023-12-01T08:00:00.000Z'),
      closedAt: new Date('2023-12-01T09:00:00.000Z'),
      durationMinutes: 60,
    });
    const change = await request(app.getHttpServer())
      .post('/api/amendments')
      .set(auth(admin))
      .send({
        entityType: 'TIMER',
        entityId: amended.id,
        field: 'durationMinutes',
        newValue: '75',
        reason: 'Correct duration minutes',
      });
    expect(change.status).toBe(201);
    const listed = await request(app.getHttpServer())
      .get('/api/payroll/sessions')
      .query({ year: 2023, month: 12, status: 'PENDING' })
      .set(auth(admin));
    const row = (
      listed.body.data as {
        id: string;
        durationMinutes: number;
        approvalStatus: string;
      }[]
    ).find((item) => item.id === amended.id);
    expect(row?.approvalStatus).toBe('PENDING');
    expect(row?.durationMinutes).toBe(75);
  });

  it('B12: satnica je zamrznuta u trenutku zatvaranja sesije', async () => {
    // Stvarni put: `POST /api/timer/stop` mora upisati snapshot satnice.
    await request(app.getHttpServer())
      .patch(`/api/users/${workerId}`)
      .set(auth(admin))
      .send({ hourlyRate: '20.00' });
    const started = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId });
    expect(started.status).toBe(201);
    const stopped = await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    expect(stopped.status).toBe(201);
    const closed = await prisma.timerSession.findUniqueOrThrow({
      where: { id: started.body.data.id as string },
    });
    expect(closed.hourlyRateSnapshot?.toFixed(2)).toBe('20.00');

    // B12 (opcija A): povišica nakon obračuna ne mijenja već obračunate sate.
    const snapshotted = await insertSession({
      approvalStatus: 'APPROVED',
      startedAt: new Date('2024-05-02T08:00:00.000Z'),
      closedAt: new Date('2024-05-02T09:00:00.000Z'),
      durationMinutes: 60,
      hourlyRateSnapshot: '10.00',
    });
    const before = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2024, month: 5 })
      .set(auth(admin));
    expect(before.status).toBe(200);
    expect(before.body.data.approvedAmount).toBe('10.00');
    await request(app.getHttpServer())
      .patch(`/api/users/${workerId}`)
      .set(auth(admin))
      .send({ hourlyRate: '99.00' });
    const after = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2024, month: 5 })
      .set(auth(admin));
    expect(after.body.data.approvedAmount).toBe('10.00');
    expect(after.body.data.approvedMinutes).toBe(
      before.body.data.approvedMinutes,
    );
    // Iznos iz sesije bez snapshota (stari redovi) prati trenutnu satnicu.
    await insertSession({
      approvalStatus: 'APPROVED',
      startedAt: new Date('2024-05-03T08:00:00.000Z'),
      closedAt: new Date('2024-05-03T09:00:00.000Z'),
      durationMinutes: 60,
    });
    const legacy = await request(app.getHttpServer())
      .get('/api/payroll/summary')
      .query({ year: 2024, month: 5 })
      .set(auth(admin));
    expect(legacy.body.data.approvedAmount).toBe('109.00');
    // Vrati satnicu da kasniji testovi (ako ih bude) vide stabilno stanje.
    await request(app.getHttpServer())
      .patch(`/api/users/${workerId}`)
      .set(auth(admin))
      .send({ hourlyRate: '20.00' });
    expect(snapshotted.id).toBeTruthy();

    // ERP: izvoz plata u troškove koristi isti snapshot, ne trenutnu satnicu.
    const cost = await request(app.getHttpServer())
      .post('/api/cost-entries/from-payroll')
      .set(auth(admin))
      .send({ year: 2024, month: 5 });
    expect(cost.status).toBe(201);
    expect(cost.body.data.amount).toBe('109.00');
  });

  async function insertSession(input: {
    userId?: string;
    startedAt: Date;
    closedAt: Date;
    durationMinutes: number;
    pauseAccumMinutes?: number;
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
    hourlyRateSnapshot?: string;
  }) {
    return prisma.timerSession.create({
      data: {
        companyId,
        userId: input.userId ?? workerId,
        taskId,
        startedAt: input.startedAt,
        closedAt: input.closedAt,
        durationMinutes: input.durationMinutes,
        pauseAccumMinutes: input.pauseAccumMinutes ?? 0,
        approvalStatus: input.approvalStatus ?? 'PENDING',
        hourlyRateSnapshot: input.hourlyRateSnapshot ?? null,
      },
    });
  }
});
