import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '../../common/rbac/roles';

const WIDE: AppRole[] = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
  'ACCOUNTANT',
];

export async function joinScopedProjectRooms(
  client: Socket,
  prisma: PrismaService,
  user: { id: string; companyId: string | null; roles: { role: string }[] },
): Promise<void> {
  const roles = user.roles.map((item) => item.role as AppRole);
  const companyWide = roles.some((role) => WIDE.includes(role));
  const data = client.data as {
    companyId: string | null;
    companyWide: boolean;
  };
  data.companyId = user.companyId;
  data.companyWide = companyWide;
  if (!user.companyId) {
    return;
  }
  if (companyWide) {
    // BE-16 (F-03): firma-wide korisnici ulaze u jednu sobu, da dodjela nove sobe
    // projekta ne mora prolaziti kroz sve socket-e procesa.
    await client.join(`companywide:${user.companyId}`);
    const projects = await prisma.project.findMany({
      where: { companyId: user.companyId },
      select: { id: true },
    });
    for (const project of projects) {
      await client.join(`project:${project.id}`);
    }
    return;
  }
  const assigned = await prisma.projectAssignment.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  const tasked = await prisma.taskAssignment.findMany({
    where: { userId: user.id },
    select: { task: { select: { projectId: true } } },
  });
  const ids = new Set([
    ...assigned.map((row) => row.projectId),
    ...tasked.map((row) => row.task.projectId),
  ]);
  for (const projectId of ids) {
    await client.join(`project:${projectId}`);
  }
}
