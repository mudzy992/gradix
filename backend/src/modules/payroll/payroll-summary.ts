import { Prisma } from '../../../generated/client';
import { payrollAmount } from './payroll-amount';
import { PAYROLL_INCLUDE } from './payroll-query';

type ClosedRow = Prisma.TimerSessionGetPayload<{ include: typeof PAYROLL_INCLUDE }>;

export type PayrollSummary = {
  from: string;
  to: string;
  tz: string;
  approvedMinutes: number;
  approvedAmount: string;
  pendingMinutes: number;
  pendingCount: number;
  rejectedCount: number;
};

export function buildPayrollSummary(
  from: string,
  to: string,
  tz: string,
  rows: ClosedRow[],
): PayrollSummary {
  let approvedMinutes = 0;
  let approvedAmount = new Prisma.Decimal(0);
  let pendingMinutes = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  for (const row of rows) {
    const minutes = row.durationMinutes ?? 0;
    if (row.approvalStatus === 'APPROVED') {
      approvedMinutes += minutes;
      approvedAmount = approvedAmount.add(payrollAmount(minutes, row.user.hourlyRate));
    } else if (row.approvalStatus === 'PENDING') {
      pendingMinutes += minutes;
      pendingCount += 1;
    } else {
      rejectedCount += 1;
    }
  }
  return {
    from,
    to,
    tz,
    approvedMinutes,
    approvedAmount: approvedAmount.toFixed(2),
    pendingMinutes,
    pendingCount,
    rejectedCount,
  };
}
