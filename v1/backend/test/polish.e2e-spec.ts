import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { EmailService } from '../src/modules/mail/email.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Phase 7 polish (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pm: string;
  let admin: string;
  let worker: string;
  let mechanic: string;
  let accountant: string;
  let companyId: string;
  let workerId: string;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    pm = (await login(app, 'pm@gradix.local')).body.data.accessToken;
    worker = (await login(app, 'worker@gradix.local')).body.data.accessToken;
    mechanic = (await login(app, 'mechanic@gradix.local')).body.data
      .accessToken;
    accountant = (await login(app, 'accountant@gradix.local')).body.data
      .accessToken;
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(admin));
    companyId = me.body.data.company.id as string;
    workerId = (
      await request(app.getHttpServer()).get('/api/me').set(auth(worker))
    ).body.data.id as string;
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(admin))
      .send({
        name: `P7 ${Date.now()}`,
        code: `P7${Date.now().toString().slice(-6)}`,
      });
    projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/assignments`)
      .set(auth(admin))
      .send({ userId: workerId, role: 'WORKER' });
    const task = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(admin))
      .send({ projectId, title: 'P7 timer', assigneeIds: [workerId] });
    taskId = task.body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('B1/D-013: email nikad ne prijavljuje lažni uspjeh', async () => {
    const email = app.get(EmailService);
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set(auth(admin));
    // Bez SMTP transporta `trySend` je iskren: `false`, i kad je flag uključen.
    expect(
      await email.trySend({
        companyId: me.body.data.company.id as string,
        to: 'nobody@gradix.local',
        subject: 'test',
        text: 'test',
      }),
    ).toBe(false);
    const response = await request(app.getHttpServer())
      .post('/api/auth/forgot')
      .send({ email: 'admin@gradix.local' });
    expect(response.status).toBe(200);
  });

  it('convert WON same company; attachments stay on tender; not WON is 409', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/tenders')
      .set(auth(admin))
      .send({ title: 'Bridge', client: 'JP Ceste', submittedValue: '10000' });
    expect(draft.status).toBe(201);
    const id = draft.body.data.id as string;
    const notWon = await request(app.getHttpServer())
      .post(`/api/tenders/${id}/convert`)
      .set(auth(admin));
    expect(notWon.status).toBe(409);
    expect(notWon.body.error.code).toBe('TENDER_INVALID_STATUS');
    await request(app.getHttpServer())
      .patch(`/api/tenders/${id}`)
      .set(auth(admin))
      .send({ status: 'SUBMITTED' });
    await request(app.getHttpServer())
      .patch(`/api/tenders/${id}`)
      .set(auth(admin))
      .send({ status: 'WON' });
    const attached = await request(app.getHttpServer())
      .post(`/api/tenders/${id}/attachments`)
      .set(auth(admin))
      .send({ path: `${companyId}/tender.pdf`, fileName: 'tender.pdf' });
    expect(attached.status).toBe(201);
    const converted = await request(app.getHttpServer())
      .post(`/api/tenders/${id}/convert`)
      .set(auth(admin));
    expect(converted.status).toBe(201);
    const project = converted.body.data.convertedProjectId as string;
    expect(project).toBeTruthy();
    const detail = await request(app.getHttpServer())
      .get(`/api/projects/${project}`)
      .set(auth(admin));
    expect(detail.body.data.companyId).toBe(companyId);
    const docs = await request(app.getHttpServer())
      .get(`/api/projects/${project}/documents`)
      .set(auth(admin));
    expect(docs.body.data).toEqual([]);
    const again = await request(app.getHttpServer())
      .post(`/api/tenders/${id}/convert`)
      .set(auth(admin));
    expect(again.status).toBe(409);
  });

  it('service start force-closes timer; machine IN_SERVICE; new start 409', async () => {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: `P7M ${Date.now()}`, type: 'EXCAVATOR' });
    const machineId = machine.body.data.id as string;
    const started = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, machineId });
    expect(started.status).toBe(201);
    const service = await request(app.getHttpServer())
      .post('/api/services')
      .set(auth(mechanic))
      .send({ machineId, projectId });
    const start = await request(app.getHttpServer())
      .post(`/api/services/${service.body.data.id}/start`)
      .set(auth(mechanic));
    expect(start.status).toBe(201);
    expect(start.body.data.status).toBe('IN_PROGRESS');
    const machineRow = await request(app.getHttpServer())
      .get(`/api/machines/${machineId}`)
      .set(auth(admin));
    expect(machineRow.body.data.status).toBe('IN_SERVICE');
    const blocked = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, machineId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('MACHINE_IN_SERVICE');
  });

  it('expired document does not block login or timer', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const doc = await request(app.getHttpServer())
      .post('/api/documents/company')
      .set(auth(admin))
      .send({
        type: 'insurance',
        filePath: `${companyId}/ins.pdf`,
        expiresAt: past,
      });
    expect(doc.status).toBe(201);
    const logged = await login(app, 'worker@gradix.local');
    expect(logged.status).toBe(200);
    const open = await request(app.getHttpServer())
      .get('/api/timer/me')
      .set(auth(worker));
    expect(open.status).toBe(200);
  });

  it('BE-15: neispravni datumi su 400 (tender submittedAt, dokument expiresAt)', async () => {
    const badTender = await request(app.getHttpServer())
      .post('/api/tenders')
      .set(auth(admin))
      .send({ title: 'Bad date', client: 'X', submittedAt: 'nije-datum' });
    expect(badTender.status).toBe(400);
    const badExpiry = await request(app.getHttpServer())
      .post('/api/documents/company')
      .set(auth(admin))
      .send({
        type: 'insurance',
        filePath: `${companyId}/bad.pdf`,
        expiresAt: '2026-02-31',
      });
    expect(badExpiry.status).toBe(400);
    // Ispravan datum prolazi i ostavlja audit trag.
    const ok = await request(app.getHttpServer())
      .post('/api/documents/company')
      .set(auth(admin))
      .send({
        type: 'insurance',
        filePath: `${companyId}/ok.pdf`,
        expiresAt: '2027-06-30',
      });
    expect(ok.status).toBe(201);
    const audit = await prisma.auditEvent.findFirst({
      where: {
        companyId,
        action: 'DOCUMENT_CREATED',
        entityId: ok.body.data.id as string,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('BE-15: paralelna konverzija tendera pravi jedan projekat', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/tenders')
      .set(auth(admin))
      .send({
        title: 'Race bridge',
        client: 'JP Ceste',
        submittedValue: '5000',
      });
    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/tenders/${id}`)
      .set(auth(admin))
      .send({ status: 'SUBMITTED' });
    await request(app.getHttpServer())
      .patch(`/api/tenders/${id}`)
      .set(auth(admin))
      .send({ status: 'WON' });
    const convert = () =>
      request(app.getHttpServer())
        .post(`/api/tenders/${id}/convert`)
        .set(auth(admin));
    const results = await Promise.all([convert(), convert(), convert()]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 409, 409]);
    const projects = await prisma.project.count({
      where: { companyId, name: 'Race bridge' },
    });
    expect(projects).toBe(1);
    const converted = await prisma.auditEvent.count({
      where: { companyId, action: 'TENDER_CONVERTED', entityId: id },
    });
    expect(converted).toBe(1);
  });

  it('BE-15: servis — tuđi projekat 400, dupli complete 409, mašina vraćena', async () => {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: `P15M ${Date.now()}`, type: 'EXCAVATOR' });
    const machineId = machine.body.data.id as string;
    const foreign = await request(app.getHttpServer())
      .post('/api/services')
      .set(auth(mechanic))
      .send({ machineId, projectId: 'cnot-a-real-project' });
    expect(foreign.status).toBe(400);
    const service = await request(app.getHttpServer())
      .post('/api/services')
      .set(auth(mechanic))
      .send({ machineId, projectId });
    expect(service.status).toBe(201);
    const serviceId = service.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/services/${serviceId}/start`)
      .set(auth(mechanic));
    const completions = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/services/${serviceId}/complete`)
        .set(auth(mechanic))
        .send({ totalCost: '120.00' }),
      request(app.getHttpServer())
        .post(`/api/services/${serviceId}/complete`)
        .set(auth(mechanic))
        .send({ totalCost: '120.00' }),
    ]);
    // Tačan kod drugog zahtjeva zavisi od toga da li je pročitao stanje prije ili
    // poslije commit-a: `400` (već završen) ili `409` (izgubio atomski claim).
    const statuses = completions.map((row) => row.status).sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
    const machineRow = await request(app.getHttpServer())
      .get(`/api/machines/${machineId}`)
      .set(auth(admin));
    expect(['ACTIVE', 'IDLE']).toContain(machineRow.body.data.status as string);
  });

  it('BE-15: reporti — obrnut period 400, > 366 dana 400, export ima period u imenu', async () => {
    const reversed = await request(app.getHttpServer())
      .get('/api/reports/project-spend')
      .query({ from: '2026-05-10', to: '2026-05-01' })
      .set(auth(admin));
    expect(reversed.status).toBe(400);
    const tooLong = await request(app.getHttpServer())
      .get('/api/reports/project-spend')
      .query({ from: '2024-01-01', to: '2026-01-01' })
      .set(auth(admin));
    expect(tooLong.status).toBe(400);
    const exported = await request(app.getHttpServer())
      .get('/api/reports/project-spend/export')
      .query({ from: '2026-05-01', to: '2026-05-31' })
      .set(auth(accountant));
    expect(exported.status).toBe(200);
    expect(String(exported.headers['content-disposition'])).toContain(
      'report-project-spend-2026-05-01_2026-05-31.xlsx',
    );
  });

  it('BE-15: machine-hours je scopiran po projektima korisnika', async () => {
    const machine = await request(app.getHttpServer())
      .post('/api/machines')
      .set(auth(admin))
      .send({ name: `P15 hours ${Date.now()}`, type: 'LOADER' });
    const machineId = machine.body.data.id as string;
    const machineName = machine.body.data.name as string;
    const started = await request(app.getHttpServer())
      .post('/api/timer/start')
      .set(auth(worker))
      .send({ taskId, machineId });
    expect(started.status).toBe(201);
    await request(app.getHttpServer())
      .post('/api/timer/stop')
      .set(auth(worker));
    const asAdmin = await request(app.getHttpServer())
      .get('/api/reports/machine-hours')
      .set(auth(admin));
    expect(asAdmin.status).toBe(200);
    const adminMachines = (asAdmin.body.data.rows as { machine: string }[]).map(
      (row) => row.machine,
    );
    expect(adminMachines).toContain(machineName);
    // PM nije dodijeljen na ovaj projekat — njegov izvještaj ne smije sadržavati
    // sate sa projekata na koje nema pristup.
    const asPm = await request(app.getHttpServer())
      .get('/api/reports/machine-hours')
      .set(auth(pm));
    expect(asPm.status).toBe(200);
    const pmMachines = (asPm.body.data.rows as { machine: string }[]).map(
      (row) => row.machine,
    );
    expect(pmMachines).not.toContain(machineName);
  });

  it('GET /reports/custom is REPORT_UNKNOWN; ACC reports ok, dispatch 403', async () => {
    const unknown = await request(app.getHttpServer())
      .get('/api/reports/custom')
      .set(auth(admin));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('REPORT_UNKNOWN');
    const report = await request(app.getHttpServer())
      .get('/api/reports/project-spend')
      .set(auth(accountant));
    expect(report.status).toBe(200);
    const dispatch = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(accountant))
      .send({ projectId, title: 'nope' });
    expect(dispatch.status).toBe(403);
  });
});
