import { AppRole } from '../../common/rbac/roles';
import {
  canAssignRoles,
  canManageRoles,
} from '../../common/rbac/role-hierarchy';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { Prisma } from '../../../generated/client';

type RoleQueries = Pick<
  Prisma.TransactionClient,
  'user' | 'userRoleAssignment'
>;

export async function assertRoleChange(params: {
  actor: AuthUser;
  targetUserId: string;
  nextRoles: AppRole[];
  prisma: RoleQueries;
}): Promise<void> {
  const { actor, targetUserId, nextRoles, prisma } = params;
  if (nextRoles.length === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'At least one role is required',
      400,
    );
  }
  if (nextRoles.includes('PLATFORM_ADMIN')) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'PLATFORM_ADMIN cannot be assigned',
      403,
    );
  }
  if (!canAssignRoles(actor.roles, nextRoles)) {
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

/**
 * BE-03: sprečava eskalaciju kroz tuđi nalog — `users.write` (ADMIN) ne smije resetovati lozinku
 * ni mijenjati role/isActive korisniku koji ima SUPER_ADMIN (ili PLATFORM_ADMIN).
 */
export function assertCanManageTarget(
  actor: AuthUser,
  targetRoles: readonly AppRole[],
): void {
  if (!canManageRoles(actor.roles, targetRoles)) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Cannot manage a user with a higher role',
      403,
    );
  }
}

export async function assertNotLastSuper(
  prisma: RoleQueries,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.companyId || !user.isActive) {
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
