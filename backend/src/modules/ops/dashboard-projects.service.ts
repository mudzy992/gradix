import { Injectable } from '@nestjs/common';
import { projectListWhere } from '../../common/scope/scope-by-project';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';

/** A bounded, read-only slice. Permission is enforced by the controller guard. */
@Injectable()
export class DashboardProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser) {
    const rows = await this.prisma.project.findMany({
      where: {
        ...projectListWhere(actor, { archived: false }),
        status: { in: ['PLANNING', 'IN_PROGRESS'] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        plannedBudget: true,
        currentSpend: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      plannedBudget: row.plannedBudget?.toFixed(2) ?? null,
      currentSpend: row.currentSpend.toFixed(2),
    }));
  }
}
