import { Injectable } from '@nestjs/common';
import { projectListWhere } from '../../common/scope/scope-by-project';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

/** A bounded, read-only slice. Permission is enforced by the controller guard. */
@Injectable()
export class DashboardProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, query: { limit?: number; cursor?: string } = {}) {
    const limit = query.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'limit must be between 1 and 10',
        400,
      );
    }
    const where = {
      ...projectListWhere(actor, { archived: false }),
      status: {
        in: ['PLANNING', 'IN_PROGRESS'] as ('PLANNING' | 'IN_PROGRESS')[],
      },
    };
    if (query.cursor) {
      const anchor = await this.prisma.project.findFirst({
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
    const rows = await this.prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        plannedBudget: true,
        currentSpend: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        plannedBudget: row.plannedBudget?.toFixed(2) ?? null,
        currentSpend: row.currentSpend.toFixed(2),
      })),
      meta: {
        limit,
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      },
    };
  }
}
