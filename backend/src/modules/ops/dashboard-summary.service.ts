import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user';
import { requireTenantCompany } from '../../common/scope/tenant';
import { hasRole } from '../../common/scope/ops-roles';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { findSetting } from '../../common/settings/registry';

@Injectable()
export class DashboardSummaryService {
  constructor(private readonly prisma: PrismaService) {}
  async get(actor: AuthUser) {
    const companyId = requireTenantCompany(actor);
    if (!hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'))
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Summary is available to tenant administrators',
        403,
      );
    const projects = {
      companyId,
      archivedAt: null,
      status: {
        in: ['PLANNING', 'IN_PROGRESS'] as ('PLANNING' | 'IN_PROGRESS')[],
      },
    };
    const [aggregate, openTasks, openTimers] = await Promise.all([
      this.prisma.project.aggregate({
        where: projects,
        _count: { _all: true, plannedBudget: true },
        _sum: { plannedBudget: true, currentSpend: true },
      }),
      this.prisma.task.count({
        where: {
          companyId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          project: projects,
        },
      }),
      this.prisma.timerSession.count({
        where: {
          companyId,
          closedAt: null,
          task: { companyId, project: projects },
        },
      }),
    ]);
    const currencySetting = await this.prisma.setting.findFirst({
      where: { companyId, key: 'app.currency' },
      select: { value: true },
    });
    const currencyValue = currencySetting
      ? currencySetting.value
      : findSetting('app.currency')?.defaultValue;
    const currency =
      typeof currencyValue === 'string' && currencyValue.trim()
        ? currencyValue.trim()
        : null;
    return {
      activeProjects: aggregate._count._all,
      openTasks,
      openTimers,
      projectsWithBudget: aggregate._count.plannedBudget,
      knownPlannedBudget: aggregate._sum.plannedBudget?.toFixed(2) ?? null,
      currentSpend: aggregate._sum.currentSpend?.toFixed(2) ?? '0.00',
      currency,
    };
  }
}
