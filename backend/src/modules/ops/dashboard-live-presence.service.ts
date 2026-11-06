import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user';
import { requireTenantCompany } from '../../common/scope/tenant';
import { hasRole } from '../../common/scope/ops-roles';
import { EARTH_RADIUS_M, PRESENCE_MAX_MS } from '../../common/constants';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

type PresenceRow = {
  userId: string;
  firstName: string;
  lastName: string;
  projectId: string;
  lastSeenAt: Date;
};

@Injectable()
export class LivePresenceService {
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
        'Live presence is available to tenant administrators',
        403,
      );
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 20',
        400,
      );
    const since = new Date(now.getTime() - PRESENCE_MAX_MS);
    const after = query.cursor
      ? Prisma.sql`AND l."userId" > ${query.cursor}`
      : Prisma.empty;
    // One most-recent non-future location per active tenant user, then one deterministic matching project.
    // Haversine matches the existing presence utility; coordinates never leave the database.
    const rows = await this.prisma.$queryRaw<PresenceRow[]>(Prisma.sql`
      SELECT loc."userId", u."firstName", u."lastName", loc."recordedAt" AS "lastSeenAt", p.id AS "projectId"
      FROM (
        SELECT DISTINCT ON (l."userId") l."userId", l.lat, l.lng, l."recordedAt"
        FROM "UserLocation" l
        WHERE l."companyId" = ${companyId} AND l."recordedAt" >= ${since} AND l."recordedAt" <= ${now} ${after}
        ORDER BY l."userId", l."recordedAt" DESC, l.id DESC
      ) loc
      JOIN "User" u ON u.id = loc."userId" AND u."companyId" = ${companyId} AND u."isActive" = true
      JOIN LATERAL (
        SELECT project.id FROM "Project" project
        WHERE project."companyId" = ${companyId} AND project."archivedAt" IS NULL
          AND project.status IN ('PLANNING', 'IN_PROGRESS') AND project.lat IS NOT NULL AND project.lng IS NOT NULL
          AND 2 * ${EARTH_RADIUS_M} * asin(LEAST(1.0, sqrt(GREATEST(0.0,
            power(sin(radians((project.lat::double precision - loc.lat::double precision) / 2)), 2)
            + cos(radians(loc.lat::double precision)) * cos(radians(project.lat::double precision))
              * power(sin(radians((project.lng::double precision - loc.lng::double precision) / 2)), 2)
          )))) <= project."geofenceRadius"
        ORDER BY project.id ASC LIMIT 1
      ) p ON true
      ORDER BY loc."userId" ASC LIMIT ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    return {
      data: page.map((row) => ({
        ...row,
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
      meta: {
        limit,
        nextCursor: rows.length > limit ? page[page.length - 1].userId : null,
      },
    };
  }
}
