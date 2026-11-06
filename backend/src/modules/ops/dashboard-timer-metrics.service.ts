import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user';
import { requireTenantCompany } from '../../common/scope/tenant';
import { hasRole } from '../../common/scope/ops-roles';
import {
  calendarDateInTz,
  dateOnlyIso,
  parseDateOnly,
  readCompanyTimezone,
} from '../../common/scope/company-tz';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

type Bucket = { startAt: Date; endAt: Date; minutes: bigint; workers: bigint };
function shiftDay(day: string, offset: number) {
  const date = parseDateOnly(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateOnlyIso(date);
}

@Injectable()
export class TimerMetricsService {
  constructor(private readonly prisma: PrismaService) {}
  async get(actor: AuthUser, query: { limit?: number; cursor?: string }) {
    const companyId = requireTenantCompany(actor);
    if (!hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'))
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Timer metrics are available to tenant administrators',
        403,
      );
    const limit = query.limit ?? 7;
    if (!Number.isInteger(limit) || limit < 1 || limit > 30)
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 30',
        400,
      );
    const timezone = await readCompanyTimezone(this.prisma, companyId);
    const cursor = query.cursor ?? calendarDateInTz(new Date(), timezone);
    parseDateOnly(cursor);
    if (cursor < '1900-01-01' || cursor > '2100-12-31')
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'cursor must be between 1900-01-01 and 2100-12-31',
        400,
      );
    const start = shiftDay(cursor, -2 * limit);
    const last = shiftDay(cursor, -1);
    // Historical pause intervals are not retained. Entire approved duration is attributed to the local closing day, never apportioned as if exact daily work time were known.
    const buckets = await this.prisma.$queryRaw<Bucket[]>(Prisma.sql`
      SELECT day AT TIME ZONE ${timezone} AS "startAt",
             (day + interval '1 day') AT TIME ZONE ${timezone} AS "endAt",
             COALESCE(SUM(s."durationMinutes"), 0)::bigint AS minutes,
             COUNT(DISTINCT s."userId")::bigint AS workers
      FROM generate_series(${start}::date::timestamp, ${last}::date::timestamp, interval '1 day') AS days(day)
      LEFT JOIN "TimerSession" s ON s."companyId" = ${companyId}
        AND s."approvalStatus" = 'APPROVED' AND s."durationMinutes" IS NOT NULL
        AND s."closedAt" >= ((day AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND s."closedAt" < (((day + interval '1 day') AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND EXISTS (SELECT 1 FROM "Task" t JOIN "Project" p ON p.id = t."projectId"
          WHERE t.id = s."taskId" AND t."companyId" = ${companyId} AND p."companyId" = ${companyId} AND p."archivedAt" IS NULL)
      GROUP BY day ORDER BY day ASC
    `);
    const values = buckets.map((b) => ({
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      minutes: BigInt(b.minutes),
      workers: Number(b.workers),
    }));
    const sum = (items: typeof values) =>
      items.reduce((total, item) => total + item.minutes, 0n);
    const previous = sum(values.slice(0, limit));
    const current = sum(values.slice(limit));
    const delta = current - previous;
    return {
      timezone,
      limit,
      nextCursor:
        shiftDay(cursor, -limit) < '1900-01-01'
          ? null
          : shiftDay(cursor, -limit),
      currentMinutes: current.toString(),
      previousMinutes: previous.toString(),
      deltaMinutes: delta.toString(),
      deltaPercent:
        previous === 0n
          ? null
          : new Prisma.Decimal(delta.toString())
              .mul(100)
              .div(previous.toString())
              .toFixed(2),
      series: values
        .slice(limit)
        .map((v) => ({ ...v, minutes: v.minutes.toString() })),
    };
  }
}
