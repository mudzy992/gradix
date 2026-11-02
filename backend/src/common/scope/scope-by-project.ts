import { Prisma } from '../../../generated/client';
import { AuthUser } from '../types/auth-user';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import { isCompanyWide } from './ops-roles';

/**
 * BE-03: tenant se nikad ne izvodi „napamet“. Ranije je nedostajući `tenantCompanyId` bacao
 * goli `Error` (500), a `projectListWhere` ga je kršio sa `!` — u Prisma-i bi
 * `companyId: undefined` značilo **bez filtera po firmi** (curenje između firmi).
 */
export function scopeByCompany(actor: AuthUser): { companyId: string } {
  return { companyId: requireTenant(actor) };
}

function requireTenant(actor: AuthUser): string {
  if (!actor.tenantCompanyId) {
    throw new AppError(
      ERROR_CODES.TENANT_HEADER_REQUIRED,
      'X-Company-Id is required',
      403,
    );
  }
  return actor.tenantCompanyId;
}

export function projectListWhere(
  actor: AuthUser,
  filters: {
    status?: string;
    q?: string;
    archived?: boolean;
  },
): Prisma.ProjectWhereInput {
  const companyId = requireTenant(actor);
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
