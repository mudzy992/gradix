import { PrismaClient, Role } from '../generated/client';
import { seedDemoTrends } from './seed-demo-trends';

type SeedUser = {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
};

const OPS_USERS: SeedUser[] = [
  { email: 'pm@gradix.local', firstName: 'Demo', lastName: 'PM', role: 'PROJECT_MANAGER' },
  { email: 'ss@gradix.local', firstName: 'Demo', lastName: 'SS', role: 'SITE_SUPERVISOR' },
  { email: 'worker@gradix.local', firstName: 'Demo', lastName: 'Worker', role: 'WORKER' },
  { email: 'driver@gradix.local', firstName: 'Demo', lastName: 'Driver', role: 'DRIVER' },
  { email: 'op@gradix.local', firstName: 'Demo', lastName: 'Operator', role: 'MACHINE_OPERATOR' },
  { email: 'mechanic@gradix.local', firstName: 'Demo', lastName: 'Mechanic', role: 'MECHANIC' },
  { email: 'accountant@gradix.local', firstName: 'Demo', lastName: 'Accountant', role: 'ACCOUNTANT' },
];

export async function seedDemoOps(
  prisma: PrismaClient,
  input: { companyId: string; passwordHash: string },
): Promise<void> {
  const ids: Record<string, string> = {};
  for (const item of OPS_USERS) {
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: {
        firstName: item.firstName,
        lastName: item.lastName,
        passwordHash: input.passwordHash,
        mustChangePassword: false,
        isActive: true,
        companyId: input.companyId,
      },
      create: {
        email: item.email,
        firstName: item.firstName,
        lastName: item.lastName,
        passwordHash: input.passwordHash,
        mustChangePassword: false,
        companyId: input.companyId,
      },
    });
    await prisma.userRoleAssignment.deleteMany({ where: { userId: user.id } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, role: item.role } });
    ids[item.role] = user.id;
  }
  const existing = await prisma.project.findFirst({
    where: { companyId: input.companyId, code: 'DEMO-1' },
  });
  if (existing) {
    await seedDemoTrends(prisma, {
      companyId: input.companyId,
      projectId: existing.id,
      workerId: ids.WORKER,
      operatorId: ids.MACHINE_OPERATOR,
    });
    return;
  }
  const project = await prisma.project.create({
    data: {
      companyId: input.companyId,
      code: 'DEMO-1',
      name: 'Sarajevo obilaznica',
      locality: 'Sarajevo',
      geofenceRadius: 200,
      isPublic: true,
    },
  });
  const earth = await prisma.projectPhase.create({
    data: { companyId: input.companyId, projectId: project.id, name: 'Zemljani radovi', sortOrder: 0 },
  });
  const asphalt = await prisma.projectPhase.create({
    data: { companyId: input.companyId, projectId: project.id, name: 'Asfalt', sortOrder: 1 },
  });
  const tasks = await Promise.all([
    prisma.task.create({
      data: {
        companyId: input.companyId,
        projectId: project.id,
        phaseId: earth.id,
        title: 'Iskop kanala',
        status: 'ASSIGNED',
      },
    }),
    prisma.task.create({
      data: {
        companyId: input.companyId,
        projectId: project.id,
        phaseId: earth.id,
        title: 'Nasip',
        status: 'ASSIGNED',
      },
    }),
    prisma.task.create({
      data: {
        companyId: input.companyId,
        projectId: project.id,
        phaseId: asphalt.id,
        title: 'Asfaltiranje',
        status: 'PENDING',
      },
    }),
  ]);
  await prisma.taskAssignment.createMany({
    data: [
      { companyId: input.companyId, taskId: tasks[0].id, userId: ids.WORKER },
      { companyId: input.companyId, taskId: tasks[1].id, userId: ids.WORKER },
    ],
  });
  await prisma.projectAssignment.createMany({
    data: [
      { companyId: input.companyId, projectId: project.id, userId: ids.PROJECT_MANAGER, role: 'PM' },
      { companyId: input.companyId, projectId: project.id, userId: ids.SITE_SUPERVISOR, role: 'SS' },
      { companyId: input.companyId, projectId: project.id, userId: ids.WORKER, role: 'WORKER' },
    ],
  });
  await prisma.quantityItem.createMany({
    data: [
      {
        companyId: input.companyId,
        projectId: project.id,
        phaseId: earth.id,
        name: 'Iskop',
        unit: 'M3',
        plannedQty: 1200,
      },
      {
        companyId: input.companyId,
        projectId: project.id,
        phaseId: asphalt.id,
        name: 'Asfalt',
        unit: 'T',
        plannedQty: 80,
      },
    ],
  });
  await seedDemoTrends(prisma, {
    companyId: input.companyId,
    projectId: project.id,
    workerId: ids.WORKER,
    operatorId: ids.MACHINE_OPERATOR,
  });
}
