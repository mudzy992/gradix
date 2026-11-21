import { AuthUser } from '../types/auth-user';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * BE-04 — jedan način da se dobije tenant iz zahtjeva.
 *
 * Prije su četiri modula imala svoju kopiju (users-helpers, companies, settings,
 * scope-by-project) i različito ponašanje: 403 sa kodom, 500 iz golog `Error`-a ili
 * `undefined` koje u Prisma-i znači „bez filtera po firmi“.
 */
export function requireTenantCompany(actor: AuthUser): string {
  if (!actor.tenantCompanyId) {
    throw new AppError(
      ERROR_CODES.TENANT_HEADER_REQUIRED,
      'X-Company-Id is required',
      403,
    );
  }
  return actor.tenantCompanyId;
}
