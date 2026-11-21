import { Prisma } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { canReadPayroll } from './payroll-access';
import { PayrollPeriod } from './payroll-period';

export const PAYROLL_INCLUDE = {
  user: { select: { firstName: true, lastName: true, hourlyRate: true } },
  task: {
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { id: true, name: true } },
    },
  },
} as const;

export function payrollSessionWhere(input: {
  companyId: string;
  actor: AuthUser;
  period: PayrollPeriod;
  projectIds: string[] | null;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}): Prisma.TimerSessionWhereInput {
  const scopedPending = !canReadPayroll(input.actor);
  return {
    companyId: input.companyId,
    closedAt: { not: null },
    startedAt: { gte: input.period.start, lt: input.period.end },
    approvalStatus: scopedPending ? 'PENDING' : input.status,
    ...(input.projectIds
      ? { task: { projectId: { in: input.projectIds } } }
      : {}),
  };
}
