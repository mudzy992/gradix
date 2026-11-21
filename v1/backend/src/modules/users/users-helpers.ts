import { Prisma } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { EMPLOYEE_CODE_PATTERN } from '../../common/constants';
import { readUniqueTarget } from '../../common/utils/prisma-errors';
import { requireTenantCompany } from '../../common/scope/tenant';
import { PrismaService } from '../prisma/prisma.service';

export function requireCompany(actor: AuthUser): string {
  return requireTenantCompany(actor);
}

export function assertPayrollWrite(actor: AuthUser): void {
  if (!actor.permissions.includes('payroll.write')) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'payroll.write required', 403);
  }
}

export function assertName(value?: string): void {
  if (value === undefined) {
    return;
  }
  if (value.length < 1 || value.length > 80) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Name must be 1–80 characters',
      400,
    );
  }
}

export function assertEmployeeCode(value?: string): void {
  if (!value) {
    return;
  }
  if (!EMPLOYEE_CODE_PATTERN.test(value)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid employeeCode',
      400,
    );
  }
}

export function throwUnique(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const haystack = readUniqueTarget(error.meta);
    if (haystack.includes('email')) {
      throw new AppError(
        ERROR_CODES.AUTH_EMAIL_TAKEN,
        'Email already taken',
        409,
      );
    }
    if (haystack.includes('phone')) {
      throw new AppError(
        ERROR_CODES.USER_PHONE_TAKEN,
        'Phone already taken',
        409,
      );
    }
    throw new AppError(ERROR_CODES.CONFLICT, 'Conflict', 409);
  }
  throw error;
}

export async function findScopedUser(
  prisma: PrismaService,
  actor: AuthUser,
  id: string,
) {
  const companyId = requireCompany(actor);
  const user = await prisma.user.findFirst({
    where: { id, companyId },
    include: { roles: true },
  });
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }
  return user;
}
