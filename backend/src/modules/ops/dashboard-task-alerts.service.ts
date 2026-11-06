import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user';
import { requireTenantCompany } from '../../common/scope/tenant';
import { hasRole } from '../../common/scope/ops-roles';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

const DAY_MS = 86_400_000;
@Injectable()
export class TaskAlertsService {
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
        'Task alerts are available to tenant administrators',
        403,
      );
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 20',
        400,
      );
    const where = {
      companyId,
      status: {
        notIn: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[],
      },
      plannedEnd: { not: null, lte: new Date(now.getTime() + 30 * DAY_MS) },
      project: {
        companyId,
        archivedAt: null,
        status: {
          in: ['PLANNING', 'IN_PROGRESS'] as ('PLANNING' | 'IN_PROGRESS')[],
        },
      },
    };
    if (query.cursor) {
      const anchor = await this.prisma.task.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!anchor)
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'cursor is invalid or not visible',
          400,
        );
    }
    const rows = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        plannedEnd: true,
      },
      orderBy: [{ plannedEnd: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((row) => {
        // The query excludes null; if a concurrent edit produces one, fail rather than invent a deadline.
        if (!row.plannedEnd)
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'Task deadline changed',
            409,
          );
        const distance = row.plannedEnd.getTime() - now.getTime();
        const severity =
          distance < 0
            ? 'CRITICAL'
            : distance <= 5 * DAY_MS
              ? 'HIGH'
              : distance <= 15 * DAY_MS
                ? 'MEDIUM'
                : 'LOW';
        return { ...row, plannedEnd: row.plannedEnd.toISOString(), severity };
      }),
      meta: {
        limit,
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      },
    };
  }
}
