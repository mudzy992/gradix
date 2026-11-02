import { AppRole } from '../../common/rbac/roles';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export async function assertRoleChange(params: {
  actor: AuthUser;
  targetUserId: string;
  nextRoles: AppRole[];
  prisma: PrismaService;
}): Promise<void> {
  const { actor, targetUserId, nextRoles, prisma } = params;
  if (nextRoles.length === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'At least one role is required',
      400,
    );
  }
  const actorIsPlatform = actor.roles.includes('PLATFORM_ADMIN');
  const actorIsSuper = actor.roles.includes('SUPER_ADMIN');
  if (nextRoles.includes('PLATFORM_ADMIN')) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'PLATFORM_ADMIN cannot be assigned',
      403,
    );
  }
  if (nextRoles.includes('SUPER_ADMIN') && !actorIsPlatform && !actorIsSuper) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Cannot assign SUPER_ADMIN', 403);
  }
  const current = await prisma.userRoleAssignment.findMany({
    where: { userId: targetUserId },
  });
  const hadSuper = current.some((item) => item.role === 'SUPER_ADMIN');
  const keepsSuper = nextRoles.includes('SUPER_ADMIN');
  if (hadSuper && !keepsSuper) {
    await assertNotLastSuper(prisma, targetUserId);
  }
}

async function assertNotLastSuper(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.companyId) {
    return;
  }
  const count = await prisma.userRoleAssignment.count({
    where: {
      role: 'SUPER_ADMIN',
      user: { companyId: user.companyId, isActive: true },
    },
  });
  if (count <= 1) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Cannot remove the last SUPER_ADMIN',
      403,
    );
  }
}
