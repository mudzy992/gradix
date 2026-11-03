import { Role } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import type { Prisma } from '../../../generated/client';

export async function userIdsWithRoles(
  prisma: PrismaService,
  companyId: string,
  roles: Role[],
): Promise<string[]> {
  const rows = await prisma.userRoleAssignment.findMany({
    where: { role: { in: roles }, user: { companyId, isActive: true } },
    select: { userId: true },
  });
  return [...new Set(rows.map((row) => row.userId))];
}

export async function notifyRoles(input: {
  prisma: PrismaService;
  notifications: NotificationsService;
  companyId: string;
  roles: Role[];
  extraUserIds?: string[];
  type: Prisma.NotificationCreateInput['type'];
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}): Promise<void> {
  const ids = new Set(
    await userIdsWithRoles(input.prisma, input.companyId, input.roles),
  );
  for (const extra of input.extraUserIds ?? []) {
    ids.add(extra);
  }
  // BE-16 (F-05): jedan `createMany` umjesto N `INSERT`-ova u nizu.
  await input.notifications.createForUsers({
    companyId: input.companyId,
    userIds: [...ids],
    type: input.type,
    title: input.title,
    message: input.message,
    data: input.data,
  });
}
