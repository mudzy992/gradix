import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  currentMonthRange,
  dateOnlyIso,
  parseDateOnly,
  readCompanyTimezone,
  tzDayUtcRange,
} from '../../common/scope/company-tz';

export type PayrollPeriodQuery = {
  year?: number;
  month?: number;
  from?: string;
  to?: string;
};

export type PayrollPeriod = {
  from: string;
  to: string;
  start: Date;
  end: Date;
  tz: string;
};

/** BE-13: granice godine — `year=0` ili `year=99999` su rušili upit (Prisma/Date). */
export const PAYROLL_YEAR_MIN = 1970;
export const PAYROLL_YEAR_MAX = 2999;

/** BE-13: gornja granica perioda (izvještaj/export), da se ne vuče decenija odjednom. */
export const PAYROLL_MAX_SPAN_DAYS = 366;

export function calendarMonthRange(
  year: number,
  month: number,
): { from: string; to: string } {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < PAYROLL_YEAR_MIN ||
    year > PAYROLL_YEAR_MAX
  ) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid year or month',
      400,
    );
  }
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextFirst = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const last = parseDateOnly(nextFirst);
  last.setUTCDate(last.getUTCDate() - 1);
  return { from, to: dateOnlyIso(last) };
}

export async function resolvePayrollPeriod(
  prisma: PrismaService,
  companyId: string,
  query: PayrollPeriodQuery,
): Promise<PayrollPeriod> {
  const tz = await readCompanyTimezone(prisma, companyId);
  const hasYear = query.year !== undefined;
  const hasMonth = query.month !== undefined;
  if (hasYear !== hasMonth) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'year and month are required together',
      400,
    );
  }
  const range = resolveDateRange(query, tz, hasYear && hasMonth);
  if (range.from > range.to) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'from must be <= to',
      400,
    );
  }
  assertPeriodSpan(range.from, range.to);
  return {
    from: range.from,
    to: range.to,
    start: tzDayUtcRange(range.from, tz).start,
    end: tzDayUtcRange(range.to, tz).end,
    tz,
  };
}

/**
 * BE-13 (F-05): period duži od `PAYROLL_MAX_SPAN_DAYS` se odbija (`400`) — export i
 * summary učitavaju sve sesije perioda u memoriju, pa neograničen `from`/`to` može
 * da obori proces. Godišnji izvještaj (366 dana) i dalje prolazi.
 */
export function assertPeriodSpan(from: string, to: string): void {
  const start = parseDateOnly(from).getTime();
  const end = parseDateOnly(to).getTime();
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > PAYROLL_MAX_SPAN_DAYS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `period must be at most ${PAYROLL_MAX_SPAN_DAYS} days`,
      400,
    );
  }
}

function resolveDateRange(
  query: PayrollPeriodQuery,
  tz: string,
  useYearMonth: boolean,
): { from: string; to: string } {
  if (useYearMonth) {
    return calendarMonthRange(query.year as number, query.month as number);
  }
  if (query.from || query.to) {
    if (!query.from || !query.to) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'from and to are required together',
        400,
      );
    }
    parseDateOnly(query.from);
    parseDateOnly(query.to);
    return { from: query.from, to: query.to };
  }
  return currentMonthRange(new Date(), tz);
}
