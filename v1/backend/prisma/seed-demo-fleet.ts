import { PrismaClient } from '../generated/client';

export async function seedDemoFleet(
  prisma: PrismaClient,
  input: { companyId: string; projectId: string; driverId: string },
): Promise<void> {
  const truck = await prisma.machine.findFirst({
    where: { companyId: input.companyId, code: 'CAM-1' },
  });
  if (!truck) {
    await prisma.machine.create({
      data: {
        companyId: input.companyId,
        name: 'Kiper 1',
        code: 'CAM-1',
        type: 'TRUCK',
      },
    });
  }
  const gravel = await prisma.material.findFirst({
    where: { companyId: input.companyId, name: 'Šljunak' },
  });
  if (!gravel) {
    await prisma.material.create({
      data: { companyId: input.companyId, name: 'Šljunak', unit: 'M3' },
    });
  }
  const depot = await prisma.depot.findFirst({
    where: { companyId: input.companyId, name: 'Deponija Ilidža' },
  });
  if (!depot) {
    await prisma.depot.create({
      data: {
        companyId: input.companyId,
        name: 'Deponija Ilidža',
        qrToken: `demo-depot-${input.companyId.slice(0, 8)}`,
      },
    });
  }
  const assigned = await prisma.projectAssignment.findFirst({
    where: { projectId: input.projectId, userId: input.driverId },
  });
  if (!assigned) {
    await prisma.projectAssignment.create({
      data: {
        companyId: input.companyId,
        projectId: input.projectId,
        userId: input.driverId,
        role: 'DRIVER',
      },
    });
  }
}
