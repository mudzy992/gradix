import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { requireTenantCompany } from '../../common/scope/tenant';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, query: { limit?: number; cursor?: string }) {
    const companyId = requireTenantCompany(actor);
    if (
      !actor.roles.some((role) =>
        ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(role),
      )
    ) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Activity is available to tenant administrators',
        403,
      );
    }
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 20',
        400,
      );
    }
    if (query.cursor) {
      const anchor = await this.prisma.auditEvent.findFirst({
        where: { id: query.cursor, companyId },
        select: { id: true },
      });
      if (!anchor)
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'cursor is invalid or not visible',
          400,
        );
    }
    const rows = await this.prisma.auditEvent.findMany({
      where: { companyId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: {
        limit,
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      },
    };
  }
}
