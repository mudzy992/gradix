import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';
import { DashboardSummaryService } from './dashboard-summary.service';

@TenantRoute()
@Controller('analytics')
export class AnalyticsSummaryController {
  constructor(private readonly summary: DashboardSummaryService) {}
  @Get('summary')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ, PERMISSIONS.TASKS_READ)
  @ApiOperation({
    summary: 'Current tenant project, task and timer aggregates',
    description:
      'Tenant administrators only. Scalar aggregates, not a collection; series have separate cursor/limit endpoints.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            activeProjects: { type: 'integer' },
            openTasks: { type: 'integer' },
            openTimers: { type: 'integer' },
            projectsWithBudget: { type: 'integer' },
            knownPlannedBudget: {
              type: 'string',
              nullable: true,
              example: '100.00',
            },
            currentSpend: { type: 'string', example: '10.00' },
          },
        },
      },
    },
  })
  get(@CurrentUser() actor: AuthUser) {
    return this.summary.get(actor);
  }
}
