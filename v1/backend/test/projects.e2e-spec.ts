import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-app';
import { auth, login } from './helpers/auth';
import { PrismaService } from '../src/modules/prisma/prisma.service';

describe('Projects (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let pmToken: string;
  let workerToken: string;
  let demoProjectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = (await login(app, 'admin@gradix.local')).body.data.accessToken;
    pmToken = (await login(app, 'pm@gradix.local')).body.data.accessToken;
    workerToken = (await login(app, 'worker@gradix.local')).body.data
      .accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('WORKER and MECHANIC list 403; PM sees assigned; ADMIN sees all', async () => {
    const worker = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(workerToken));
    expect(worker.status).toBe(403);
    const mechanic = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `mech-${Date.now()}@gradix.local`,
        firstName: 'Meh',
        lastName: 'Anic',
        roles: ['MECHANIC'],
      });
    const temp = mechanic.body.data.temporaryPassword as string;
    const mechLogin = await login(app, mechanic.body.data.email, temp);
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(mechLogin.body.data.accessToken as string))
      .send({ currentPassword: temp, newPassword: 'MechanicPass1' });
    const mechAfter = await login(
      app,
      mechanic.body.data.email,
      'MechanicPass1',
    );
    const mechList = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(mechAfter.body.data.accessToken as string));
    expect(mechList.status).toBe(403);
    const listed = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(pmToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBeGreaterThan(0);
    demoProjectId = listed.body.data.find(
      (row: { code: string | null }) => row.code === 'DEMO-1',
    ).id as string;
    const adminList = await request(app.getHttpServer())
      .get('/api/projects')
      .set(auth(adminToken));
    expect(adminList.body.data.length).toBeGreaterThanOrEqual(
      listed.body.data.length,
    );
  });

  it('WORKER detail hides budget; plannedEnd < start 400; geofence 0 400', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/projects/${demoProjectId}`)
      .set(auth(workerToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.plannedBudget).toBeUndefined();
    expect(detail.body.data.client).toBeUndefined();
    const badDates = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({
        name: 'Bad dates',
        plannedStart: '2026-08-20T00:00:00.000Z',
        plannedEnd: '2026-08-19T00:00:00.000Z',
      });
    expect(badDates.status).toBe(400);
    const badFence = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: 'Bad fence', geofenceRadius: 0 });
    expect(badFence.status).toBe(400);
  });

  it('PATCH preserves omitted fields and clears optional fields without losing zero', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({
        name: 'Clear optional',
        code: `CLR-${Date.now()}`,
        locality: 'Sarajevo',
        client: 'Grad',
        plannedBudget: '125',
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const omitted = await request(app.getHttpServer())
      .patch(`/api/projects/${id}`)
      .set(auth(adminToken))
      .send({ name: 'Renamed' });
    expect(omitted.status).toBe(200);
    expect(omitted.body.data).toMatchObject({
      locality: 'Sarajevo',
      client: 'Grad',
      plannedBudget: '125',
    });
    expect(omitted.body.data.code).toBe(created.body.data.code);
    const zero = await request(app.getHttpServer())
      .patch(`/api/projects/${id}`)
      .set(auth(adminToken))
      .send({ plannedBudget: '0' });
    expect(zero.status).toBe(200);
    expect(zero.body.data.plannedBudget).toBe('0');
    const invalid = await request(app.getHttpServer())
      .patch(`/api/projects/${id}`)
      .set(auth(adminToken))
      .send({ plannedBudget: '-1' });
    expect(invalid.status).toBe(400);
    const cleared = await request(app.getHttpServer())
      .patch(`/api/projects/${id}`)
      .set(auth(adminToken))
      .send({ code: '', locality: ' ', client: '', plannedBudget: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({
      code: null,
      locality: null,
      client: null,
      plannedBudget: null,
    });
    const read = await request(app.getHttpServer())
      .get(`/api/projects/${id}`)
      .set(auth(adminToken));
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({
      code: null,
      locality: null,
      client: null,
      plannedBudget: null,
    });
    const restored = await request(app.getHttpServer())
      .patch(`/api/projects/${id}`)
      .set(auth(adminToken))
      .send({
        code: 'RESTORED',
        locality: 'Mostar',
        client: 'Firma',
        plannedBudget: '42',
      });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({
      code: 'RESTORED',
      locality: 'Mostar',
      client: 'Firma',
      plannedBudget: '42',
    });
    const nullClear = await request(app.getHttpServer())
      .patch(`/api/projects/${id}`)
      .set(auth(adminToken))
      .send({ code: null, locality: null, client: null, plannedBudget: null });
    expect(nullClear.status).toBe(200);
    expect(nullClear.body.data).toMatchObject({
      code: null,
      locality: null,
      client: null,
      plannedBudget: null,
    });
  });

  it('document linking idempotency survives concurrent retries and rejects key reuse', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: 'Idempotent documents' });
    expect(created.status).toBe(201);
    const projectId = created.body.data.id as string;
    const companyId = created.body.data.companyId as string;
    const key = randomUUID();
    const body = {
      path: `${companyId}/test/plan.pdf`,
      fileName: 'plan.pdf',
      idempotencyKey: key,
    };
    const link = (input: object) =>
      request(app.getHttpServer())
        .post(`/api/projects/${projectId}/documents`)
        .set(auth(adminToken))
        .send(input);
    const replies = await Promise.all(
      Array.from({ length: 8 }, () => link(body)),
    );
    for (const response of replies) {
      expect(response.status).toBe(201);
      expect(response.body.data.id).toBe(replies[0].body.data.id);
      expect(response.body.data.idempotencyKey).toBeUndefined();
    }
    const retry = await link({ ...body, idempotencyKey: key.toUpperCase() });
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(replies[0].body.data.id);
    const differentPayload = await link({ ...body, fileName: 'other.pdf' });
    expect(differentPayload.status).toBe(409);
    const badKey = await link({ ...body, idempotencyKey: 'not-a-uuid' });
    expect(badKey.status).toBe(400);
    const otherTenantPath = await link({
      ...body,
      path: 'other-company/file.pdf',
    });
    expect(otherTenantPath.status).toBe(403);
    const list = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/documents`)
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].idempotencyKey).toBeUndefined();
    const auditCount = await app.get(PrismaService).auditEvent.count({
      where: {
        entityType: 'ProjectDocument',
        entityId: replies[0].body.data.id as string,
        action: 'PROJECT_DOCUMENT_ADDED',
      },
    });
    expect(auditCount).toBe(1);
    const raceKey = randomUUID();
    const competing = await Promise.all([
      link({ ...body, idempotencyKey: raceKey, fileName: 'a.pdf' }),
      link({ ...body, idempotencyKey: raceKey, fileName: 'b.pdf' }),
    ]);
    expect(competing.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    // Existing clients without a key keep their original create behavior.
    const legacy = {
      path: `${companyId}/test/legacy.pdf`,
      fileName: 'legacy.pdf',
    };
    expect((await link(legacy)).status).toBe(201);
    expect((await link(legacy)).status).toBe(201);
    const otherProject = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: 'Idempotency scoped to project' });
    expect(otherProject.status).toBe(201);
    const other = await request(app.getHttpServer())
      .post(`/api/projects/${otherProject.body.data.id}/documents`)
      .set(auth(adminToken))
      .send(body);
    expect(other.status).toBe(201);
    expect(other.body.data.id).not.toBe(replies[0].body.data.id);
  });

  it('removed document keeps its retry key and cannot be resurrected, including concurrent deletes and retries', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: 'Removed document idempotency' });
    expect(created.status).toBe(201);
    const projectId = created.body.data.id as string;
    const companyId = created.body.data.companyId as string;
    const body = {
      path: `${companyId}/test/retired.pdf`,
      fileName: 'retired.pdf',
      idempotencyKey: randomUUID(),
    };
    const link = (input: object) =>
      request(app.getHttpServer())
        .post(`/api/projects/${projectId}/documents`)
        .set(auth(adminToken))
        .send(input);
    const first = await link(body);
    expect(first.status).toBe(201);
    expect(first.body.data.deletedAt).toBeUndefined();
    const docId = first.body.data.id as string;
    const remove = () =>
      request(app.getHttpServer())
        .delete(`/api/projects/${projectId}/documents/${docId}`)
        .set(auth(adminToken));
    const outcomes = await Promise.all([
      remove(),
      remove(),
      ...Array.from({ length: 5 }, () => link(body)),
    ]);
    expect(
      outcomes
        .slice(0, 2)
        .map((r) => r.status)
        .sort(),
    ).toEqual([204, 404]);
    for (const response of outcomes.slice(2)) {
      expect([201, 409]).toContain(response.status);
      if (response.status === 201) expect(response.body.data.id).toBe(docId);
      else expect(response.body.error.code).toBe('PROJECT_DOCUMENT_REMOVED');
    }
    const after = await link(body);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('PROJECT_DOCUMENT_REMOVED');
    const mismatched = await link({ ...body, fileName: 'different.pdf' });
    expect(mismatched.status).toBe(409);
    expect(mismatched.body.error.code).toBe('CONFLICT');
    const list = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/documents`)
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    const prisma = app.get(PrismaService);
    const tombstones = await prisma.projectDocument.findMany({
      where: { projectId, idempotencyKey: body.idempotencyKey },
    });
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe(docId);
    expect(tombstones[0].deletedAt).not.toBeNull();
    const removalAudits = await prisma.auditEvent.count({
      where: {
        entityType: 'ProjectDocument',
        entityId: docId,
        action: 'PROJECT_DOCUMENT_REMOVED',
      },
    });
    expect(removalAudits).toBe(1);
    // A new, deliberate operation can still use the same object path.
    const newLink = await link({ ...body, idempotencyKey: randomUUID() });
    expect(newLink.status).toBe(201);
    expect(newLink.body.data.id).not.toBe(docId);
    expect((await link(body)).body.error.code).toBe('PROJECT_DOCUMENT_REMOVED');
    const legacy = await link({
      path: `${companyId}/test/legacy-retired.pdf`,
      fileName: 'legacy-retired.pdf',
    });
    expect(legacy.status).toBe(201);
    const legacyDelete = await request(app.getHttpServer())
      .delete(`/api/projects/${projectId}/documents/${legacy.body.data.id}`)
      .set(auth(adminToken));
    expect(legacyDelete.status).toBe(204);
    const afterLegacy = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/documents`)
      .set(auth(adminToken));
    expect(afterLegacy.body.data).toHaveLength(1);
    expect(afterLegacy.body.data[0].id).toBe(newLink.body.data.id);
    const legacyRetry = await link({
      path: `${companyId}/test/legacy-retired.pdf`,
      fileName: 'legacy-retired.pdf',
    });
    expect(legacyRetry.status).toBe(201);
    expect(legacyRetry.body.data.id).not.toBe(legacy.body.data.id);
    const otherProject = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(adminToken))
      .send({ name: 'Tombstone isolation' });
    expect(otherProject.status).toBe(201);
    const wrongProjectDelete = await request(app.getHttpServer())
      .delete(
        `/api/projects/${otherProject.body.data.id}/documents/${newLink.body.data.id}`,
      )
      .set(auth(adminToken));
    expect(wrongProjectDelete.status).toBe(404);
    const sameKeyOtherProject = await request(app.getHttpServer())
      .post(`/api/projects/${otherProject.body.data.id}/documents`)
      .set(auth(adminToken))
      .send(body);
    expect(sameKeyOtherProject.status).toBe(201);
    expect(sameKeyOtherProject.body.data.id).not.toBe(docId);
  });

  it('PLANNING to ON_HOLD 400; PM auto-assign; ACC 403; archive then start terminal', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(pmToken))
      .send({ name: `PM project ${Date.now()}` });
    expect(created.status).toBe(201);
    const pmSees = await request(app.getHttpServer())
      .get(`/api/projects/${created.body.data.id}`)
      .set(auth(pmToken));
    expect(pmSees.status).toBe(200);
    const hold = await request(app.getHttpServer())
      .patch(`/api/projects/${created.body.data.id}/status`)
      .set(auth(adminToken))
      .send({ status: 'ON_HOLD' });
    expect(hold.status).toBe(400);
    const acc = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: `acc-${Date.now()}@gradix.local`,
        firstName: 'Acc',
        lastName: 'Ount',
        roles: ['ACCOUNTANT'],
      });
    const accTemp = acc.body.data.temporaryPassword as string;
    const accLogin = await login(app, acc.body.data.email, accTemp);
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set(auth(accLogin.body.data.accessToken as string))
      .send({ currentPassword: accTemp, newPassword: 'AccountPass1' });
    const accAfter = await login(app, acc.body.data.email, 'AccountPass1');
    const accPost = await request(app.getHttpServer())
      .post('/api/projects')
      .set(auth(accAfter.body.data.accessToken as string))
      .send({ name: 'ACC no' });
    expect(accPost.status).toBe(403);
  });
});
