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

export type TaskMetricsQuery = { cursor?: string; limit?: number };
type Bucket = {
  day: string;
  startAt: Date;
  endAt: Date;
  count: bigint | number;
};
function shiftDay(date: string, days: number): string {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return dateOnlyIso(value);
}

@Injectable()
export class TaskCreationMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(actor: AuthUser, query: TaskMetricsQuery) {
    const companyId = requireTenantCompany(actor);
    const limit = query.limit ?? 7;
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 30',
        400,
      );
    }
    const timezone = await readCompanyTimezone(this.prisma, companyId);
    // Cursor is an exclusive company-local calendar date, not a timestamp.
    const cursor = query.cursor ?? calendarDateInTz(new Date(), timezone);
    parseDateOnly(cursor);
    if (cursor < '1900-01-01' || cursor > '2100-12-31') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'cursor must be between 1900-01-01 and 2100-12-31',
        400,
      );
    }
    const start = shiftDay(cursor, -2 * limit);
    const last = shiftDay(cursor, -1);
    // ACCOUNTANT grants company-wide project visibility but not task visibility;
    // combining it with a project role must not widen access to task metrics.
    const assignment = hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN')
      ? Prisma.empty
      : Prisma.sql`
      AND EXISTS (SELECT 1 FROM "ProjectAssignment" a
                  WHERE a."projectId" = p."id" AND a."companyId" = ${companyId} AND a."userId" = ${actor.id})`;
    // Date boundaries are computed by PostgreSQL using the company zone, so
    // DST days are 23/25 hours rather than being forced to 24 hours.
    const buckets = await this.prisma.$queryRaw<Bucket[]>(Prisma.sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day,
             day AT TIME ZONE ${timezone} AS "startAt",
             (day + interval '1 day') AT TIME ZONE ${timezone} AS "endAt",
             count(t.id)::bigint AS count
      FROM generate_series(${start}::date::timestamp, ${last}::date::timestamp, interval '1 day') AS days(day)
      LEFT JOIN "Task" t ON t."companyId" = ${companyId}
        AND t."createdAt" >= ((day AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND t."createdAt" < (((day + interval '1 day') AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND EXISTS (SELECT 1 FROM "Project" p WHERE p.id = t."projectId" AND p."companyId" = ${companyId} AND p."archivedAt" IS NULL ${assignment})
      GROUP BY day ORDER BY day ASC
    `);
    const values = buckets.map((bucket) => ({
      startAt: bucket.startAt.toISOString(),
      endAt: bucket.endAt.toISOString(),
      count: Number(bucket.count),
    }));
    const sum = (items: typeof values) =>
      items.reduce((total, item) => total + item.count, 0);
    const previous = sum(values.slice(0, limit));
    const series = values.slice(limit);
    const current = sum(series);
    return {
      timezone,
      limit,
      nextCursor:
        shiftDay(cursor, -limit) < '1900-01-01'
          ? null
          : shiftDay(cursor, -limit),
      current,
      previous,
      delta: current - previous,
      deltaPercent:
        previous === 0 ? null : ((current - previous) / previous) * 100,
      series,
    };
  }
}
