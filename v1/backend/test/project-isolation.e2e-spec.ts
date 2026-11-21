import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../generated/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { auth, login } from './helpers/auth';
import { createTestApp } from './helpers/create-app';

describe('TEST-01 project resource isolation (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('checks actual own and foreign project ids across all roles and selected platform tenants', async () => {
    const prisma = app.get(PrismaService);
    const seed = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@gradix.local' },
    });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const companyIds: string[] = [];
    const userIds: string[] = [];
    const projectIds: string[] = [];
    try {
      const a = await prisma.company.create({
        data: { name: 'Project isolation A', slug: `iso-a-${suffix}` },
      });
      companyIds.push(a.id);
      const b = await prisma.company.create({
        data: { name: 'Project isolation B', slug: `iso-b-${suffix}` },
      });
      companyIds.push(b.id);
      const pa = await prisma.project.create({
        data: { companyId: a.id, name: 'Own project', geofenceRadius: 50 },
      });
      projectIds.push(pa.id);
      const pb = await prisma.project.create({
        data: { companyId: b.id, name: 'Foreign project', geofenceRadius: 50 },
      });
      projectIds.push(pb.id);
      const http = request(app.getHttpServer());
      for (const role of Object.values(Role)) {
        const email = `project-iso-${role.toLowerCase()}-${suffix}@example.invalid`;
        const platform = role === 'PLATFORM_ADMIN';
        const user = await prisma.user.create({
          data: {
            email,
            firstName: 'Isolation',
            lastName: 'Test',
            companyId: platform ? null : a.id,
            passwordHash: seed.passwordHash,
            mustChangePassword: false,
            roles: { create: { role } },
          },
        });
        userIds.push(user.id);
        if (!platform)
          await prisma.projectAssignment.create({
            data: {
              companyId: a.id,
              projectId: pa.id,
              userId: user.id,
              role: 'WORKER',
            },
          });
        const logged = await login(app, email);
        expect(logged.status).toBe(200);
        const headers: Record<string, string> = auth(
          logged.body.data.accessToken as string,
        );
        if (platform) headers['X-Company-Id'] = a.id;
        const own = await http.get(`/api/projects/${pa.id}`).set(headers);
        expect([role, own.status, own.body.data?.id]).toEqual([
          role,
          200,
          pa.id,
        ]);
        const foreign = await http.get(`/api/projects/${pb.id}`).set(headers);
        expect([role, foreign.status, foreign.body.error?.code]).toEqual([
          role,
          404,
          'NOT_FOUND',
        ]);
        const foreignPatch = await http
          .patch(`/api/projects/${pb.id}`)
          .set(headers)
          .send({ name: 'Unexpected write' });
        const canWrite = [
          'PLATFORM_ADMIN',
          'SUPER_ADMIN',
          'ADMIN',
          'PROJECT_MANAGER',
        ].includes(role);
        expect([role, foreignPatch.status]).toEqual([
          role,
          canWrite ? 404 : 403,
        ]);
        const ownPatch = await http
          .patch(`/api/projects/${pa.id}`)
          .set(headers)
          .send({ name: `Updated by ${role}` });
        expect([role, ownPatch.status]).toEqual([role, canWrite ? 200 : 403]);
        if (canWrite)
          expect(ownPatch.body.data.name).toBe(`Updated by ${role}`);
        if (platform) {
          const selectedB = { ...headers, 'X-Company-Id': b.id };
          const ownB = await http.get(`/api/projects/${pb.id}`).set(selectedB);
          expect([ownB.status, ownB.body.data?.id]).toEqual([200, pb.id]);
          const foreignA = await http
            .get(`/api/projects/${pa.id}`)
            .set(selectedB);
          expect([foreignA.status, foreignA.body.error?.code]).toEqual([
            404,
            'NOT_FOUND',
          ]);
        }
      }
      expect(
        (await prisma.project.findUniqueOrThrow({ where: { id: pb.id } })).name,
      ).toBe('Foreign project');
    } finally {
      await prisma.auditEvent.deleteMany({
        where: { actorId: { in: userIds } },
      });
      await prisma.projectAssignment.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
  }, 120_000);
});
