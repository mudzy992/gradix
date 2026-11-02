import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { EmailService } from '../src/modules/mail/email.service';

describe('Phase 7 polish (e2e)', () => {
  let app: INestApplication<App>;
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
    admin = (await login(app, 'admin@gradix.local')).body.data.accessToken;
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

  it('features.email=false keeps SMTP at 0', async () => {
    const email = app.get(EmailService);
    const before = email.smtpCalls;
    const response = await request(app.getHttpServer())
      .post('/api/auth/forgot')
      .send({ email: 'admin@gradix.local' });
    expect(response.status).toBe(200);
    expect(email.smtpCalls).toBe(before);
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
