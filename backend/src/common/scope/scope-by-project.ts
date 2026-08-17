import { Prisma } from '../../../generated/client';
import { AuthUser } from '../types/auth-user';
import { isCompanyWide } from './ops-roles';

export function scopeByCompany(actor: AuthUser): { companyId: string } {
  if (!actor.tenantCompanyId) {
    throw new Error('tenantCompanyId missing');
  }
  return { companyId: actor.tenantCompanyId };
}

export function projectListWhere(
  actor: AuthUser,
  filters: {
    status?: string;
    q?: string;
    archived?: boolean;
  },
): Prisma.ProjectWhereInput {
  const companyId = actor.tenantCompanyId!;
  const where: Prisma.ProjectWhereInput = {
    companyId,
    archivedAt: filters.archived ? { not: null } : null,
    ...(filters.status ? { status: filters.status as Prisma.EnumProjectStatusFilter['equals'] } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q } },
            { code: { contains: filters.q } },
            { locality: { contains: filters.q } },
          ],
        }
      : {}),
  };
  if (!isCompanyWide(actor)) {
    where.assignments = { some: { userId: actor.id } };
  }
  return where;
}
