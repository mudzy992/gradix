import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';
import { TaskAlertsService } from './dashboard-task-alerts.service';
class TaskAlertsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  cursor?: string;
}
@TenantRoute()
@Controller('alerts')
export class TaskAlertsController {
  constructor(private readonly alerts: TaskAlertsService) {}
  @Get('tasks')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ, PERMISSIONS.TASKS_READ)
  @ApiOperation({
    summary: 'Unfinished task deadline alerts',
    description:
      'Tenant administrators only, overdue or within 30 days. Severity follows the absolute deadline instant.',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: '1–20, default 20',
  })
  @ApiQuery({
    name: 'cursor',
    type: String,
    required: false,
    description: 'Task id from meta.nextCursor',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              projectId: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string' },
              plannedEnd: { type: 'string', format: 'date-time' },
              severity: {
                type: 'string',
                enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
              },
            },
          },
        },
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'integer' },
            nextCursor: { type: 'string', nullable: true },
          },
        },
      },
    },
  })
  list(@CurrentUser() actor: AuthUser, @Query() query: TaskAlertsQueryDto) {
    return this.alerts.list(actor, query);
  }
}
