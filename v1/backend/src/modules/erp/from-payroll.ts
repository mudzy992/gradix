import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { parseDateOnly } from '../../common/scope/company-tz';
import { payrollAmount, payrollRate } from '../payroll/payroll-amount';
import {
  calendarMonthRange,
  resolvePayrollPeriod,
} from '../payroll/payroll-period';
import { FromPayrollDto } from './costs.dto';

export async function buildPayrollCost(input: {
  prisma: PrismaService;
  companyId: string;
  dto: FromPayrollDto;
}): Promise<{
  amount: Prisma.Decimal;
  date: Date;
  sourceId: string;
  projectId: string | null;
}> {
  const period = await resolvePayrollPeriod(input.prisma, input.companyId, {
    year: input.dto.year,
    month: input.dto.month,
  });
  const month = calendarMonthRange(input.dto.year, input.dto.month);
  const rows = await input.prisma.timerSession.findMany({
    where: {
      companyId: input.companyId,
      closedAt: { not: null },
      startedAt: { gte: period.start, lt: period.end },
      approvalStatus: 'APPROVED',
      ...(input.dto.projectId
        ? { task: { projectId: input.dto.projectId } }
        : {}),
    },
    include: { user: { select: { hourlyRate: true } } },
  });
  let amount = new Prisma.Decimal(0);
  for (const row of rows) {
    amount = amount.add(
      payrollAmount(row.durationMinutes ?? 0, payrollRate(row)),
    );
  }
  const sourceId = input.dto.projectId
    ? `${month.from.slice(0, 7)}:${input.dto.projectId}`
    : month.from.slice(0, 7);
  return {
    amount: amount.toDecimalPlaces(2),
    date: parseDateOnly(month.from),
    sourceId,
    projectId: input.dto.projectId ?? null,
  };
}

export function mapCostConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new AppError(ERROR_CODES.CONFLICT, 'Cost entry already exists', 409);
  }
  throw error;
}
