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

type Kind = 'COMPANY' | 'WORKER' | 'MACHINE';
type AlertRow = { id: string; kind: Kind; type: string; expiresAt: Date };
type Cursor = { expiresAt: string; kind: Kind; id: string };
function shiftDay(day: string, offset: number) {
  const date = parseDateOnly(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return dateOnlyIso(date);
}
function decodeCursor(value: string): Cursor {
  try {
    const data: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (typeof data !== 'object' || data === null) throw new Error();
    const { expiresAt, kind, id } = data as Record<string, unknown>;
    if (
      typeof expiresAt !== 'string' ||
      new Date(expiresAt).toISOString() !== expiresAt ||
      typeof id !== 'string' ||
      !id ||
      id.length > 100 ||
      (kind !== 'COMPANY' && kind !== 'WORKER' && kind !== 'MACHINE')
    )
      throw new Error();
    return { expiresAt, kind, id };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid cursor', 400);
  }
}

@Injectable()
export class DocumentAlertsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(
    actor: AuthUser,
    query: { limit?: number; cursor?: string },
    now = new Date(),
  ) {
    const companyId = requireTenantCompany(actor);
    if (!hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'))
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Document alerts are available to tenant administrators',
        403,
      );
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 20',
        400,
      );
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const timezone = await readCompanyTimezone(this.prisma, companyId);
    const today = calendarDateInTz(now, timezone);
    const lower = shiftDay(today, -90);
    const upper = shiftDay(today, 31);
    const keyset = cursor
      ? Prisma.sql`AND ("expiresAt", kind, id) > ((${cursor.expiresAt}::timestamptz AT TIME ZONE 'UTC'), ${cursor.kind}, ${cursor.id})`
      : Prisma.empty;
    // Expiry is a date-only business value stored as UTC midnight; file paths and notes are deliberately not selected.
    const rows = await this.prisma.$queryRaw<AlertRow[]>(Prisma.sql`
      SELECT id, kind, type, "expiresAt" FROM (
        SELECT id, 'COMPANY'::text AS kind, type, "expiresAt" FROM "CompanyDocument" WHERE "companyId" = ${companyId} AND "expiresAt" >= ${lower}::date AND "expiresAt" < ${upper}::date
        UNION ALL
        SELECT id, 'WORKER'::text AS kind, type, "expiresAt" FROM "WorkerDocument" WHERE "companyId" = ${companyId} AND "expiresAt" >= ${lower}::date AND "expiresAt" < ${upper}::date
        UNION ALL
        SELECT id, 'MACHINE'::text AS kind, type, "expiresAt" FROM "MachineDocument" WHERE "companyId" = ${companyId} AND "expiresAt" >= ${lower}::date AND "expiresAt" < ${upper}::date
      ) AS documents WHERE true ${keyset}
      ORDER BY "expiresAt" ASC, kind ASC, id ASC LIMIT ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    return {
      data: page.map((row) => {
        const daysUntilExpiry = Math.round(
          (parseDateOnly(row.expiresAt.toISOString().slice(0, 10)).getTime() -
            parseDateOnly(today).getTime()) /
            86_400_000,
        );
        const severity =
          daysUntilExpiry < 0
            ? 'CRITICAL'
            : daysUntilExpiry <= 5
              ? 'HIGH'
              : daysUntilExpiry <= 15
                ? 'MEDIUM'
                : 'LOW';
        return {
          id: row.id,
          kind: row.kind,
          type: row.type,
          expiresAt: row.expiresAt.toISOString(),
          daysUntilExpiry,
          severity,
        };
      }),
      meta: {
        limit,
        nextCursor:
          rows.length > limit
            ? Buffer.from(
                JSON.stringify({
                  expiresAt: page[page.length - 1].expiresAt.toISOString(),
                  kind: page[page.length - 1].kind,
                  id: page[page.length - 1].id,
                }),
              ).toString('base64url')
            : null,
      },
    };
  }
}
