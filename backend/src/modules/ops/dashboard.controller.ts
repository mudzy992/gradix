import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardProjectsService } from './dashboard-projects.service';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly projects: DashboardProjectsService,
  ) {}

  @Get('projects')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  @ApiOperation({
    summary: 'Dashboard: najviše deset aktivnih projekata u tenant scopeu',
  })
  @ApiOkResponse({
    description:
      'Omotani odgovor, data je lista projekata; novac je decimalni string.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'status', 'plannedBudget', 'currentSpend'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string' },
              plannedBudget: {
                type: 'string',
                nullable: true,
                example: '100.13',
              },
              currentSpend: { type: 'string', example: '0.00' },
            },
          },
        },
      },
    },
  })
  listProjects(@CurrentUser() actor: AuthUser) {
    return this.projects.list(actor);
  }

  @Get()
  get(@CurrentUser() actor: AuthUser) {
    return this.dashboard.get(actor);
  }
}
