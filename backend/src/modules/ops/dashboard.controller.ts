import { Controller, Get, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DashboardService } from './dashboard.service';
import { DashboardProjectsService } from './dashboard-projects.service';
import { ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

export class DashboardProjectsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  cursor?: string;
}

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
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size 1–10, default 10',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Visible project id from meta.nextCursor',
  })
  @ApiOkResponse({
    description:
      'Omotani odgovor, data je lista projekata; novac je decimalni string.',
    schema: {
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'integer' },
            nextCursor: { type: 'string', nullable: true },
          },
        },
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
  listProjects(
    @CurrentUser() actor: AuthUser,
    @Query() query: DashboardProjectsQueryDto,
  ) {
    return this.projects.list(actor, query);
  }

  @Get()
  get(@CurrentUser() actor: AuthUser) {
    return this.dashboard.get(actor);
  }
}
