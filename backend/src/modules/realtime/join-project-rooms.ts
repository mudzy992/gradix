import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '../../common/rbac/roles';

const WIDE: AppRole[] = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];

export async function joinScopedProjectRooms(
  client: Socket,
  prisma: PrismaService,
  user: { id: string; companyId: string | null; roles: { role: string }[] },
): Promise<void> {
  const roles = user.roles.map((item) => item.role as AppRole);
  const companyWide = roles.some((role) => WIDE.includes(role));
  client.data.companyId = user.companyId;
  client.data.companyWide = companyWide;
  if (!user.companyId) {
    return;
  }
  if (companyWide) {
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
