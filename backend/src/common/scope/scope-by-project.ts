import { Prisma } from '../../../generated/client';
import { AuthUser } from '../types/auth-user';
import { requireTenantCompany } from './tenant';
import { isCompanyWide } from './ops-roles';

/**
 * BE-03/BE-04: tenant se nikad ne izvodi „napamet“ — nedostajući `tenantCompanyId` je 403,
 * a ne `undefined` (koje u Prisma-i znači „bez filtera po firmi“).
 */
export function scopeByCompany(actor: AuthUser): { companyId: string } {
  return { companyId: requireTenantCompany(actor) };
}

export function projectListWhere(
  actor: AuthUser,
  filters: {
    status?: string;
    q?: string;
    archived?: boolean;
  },
): Prisma.ProjectWhereInput {
  const companyId = requireTenantCompany(actor);
  const where: Prisma.ProjectWhereInput = {
    companyId,
    archivedAt: filters.archived ? { not: null } : null,
    ...(filters.status
      ? { status: filters.status as Prisma.EnumProjectStatusFilter['equals'] }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { code: { contains: filters.q, mode: 'insensitive' } },
            { locality: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  if (!isCompanyWide(actor)) {
    where.assignments = { some: { userId: actor.id } };
  }
  return where;
}
