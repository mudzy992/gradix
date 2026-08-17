import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { hasRole } from '../../common/scope/ops-roles';
import { PrismaService } from '../prisma/prisma.service';

export function canReadPayroll(actor: AuthUser): boolean {
  return actor.permissions.includes('payroll.read');
}

export function canApprovePayroll(actor: AuthUser): boolean {
  return hasRole(
    actor,
    'SITE_SUPERVISOR',
    'PROJECT_MANAGER',
    'ADMIN',
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
  );
}

export function isPayrollAdmin(actor: AuthUser): boolean {
  return hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN');
}

export function assertCanListPayroll(actor: AuthUser): void {
  if (canReadPayroll(actor) || canApprovePayroll(actor)) {
    return;
  }
  throw new AppError(ERROR_CODES.FORBIDDEN, 'Payroll list not allowed', 403);
}

export async function payrollProjectIds(
  prisma: PrismaService,
  actor: AuthUser,
): Promise<string[] | null> {
  if (isPayrollAdmin(actor) || canReadPayroll(actor)) {
    return null;
  }
  const assigned = await prisma.projectAssignment.findMany({
    where: { userId: actor.id, project: { companyId: actor.tenantCompanyId ?? '' } },
    select: { projectId: true },
  });
  return assigned.map((row) => row.projectId);
}

export async function assertCanDecidePayroll(
  prisma: PrismaService,
  actor: AuthUser,
  session: { userId: string; task: { projectId: string } },
): Promise<void> {
  if (!canApprovePayroll(actor)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Payroll approve not allowed', 403);
  }
  if (!isPayrollAdmin(actor) && session.userId === actor.id) {
    throw new AppError(ERROR_CODES.PAYROLL_SELF_APPROVE, 'Cannot approve own session', 403);
  }
  if (isPayrollAdmin(actor)) {
    return;
  }
  const assigned = await prisma.projectAssignment.findFirst({
    where: { userId: actor.id, projectId: session.task.projectId },
  });
  if (!assigned) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Not assigned to project', 403);
  }
}
