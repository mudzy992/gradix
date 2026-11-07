import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiPropertyOptional,
  ApiQuery,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';
import { TaskCreationMetricsService } from './dashboard-task-metrics.service';

export class TaskCreationMetricsQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 30, default: 7 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;

  @ApiPropertyOptional({
    type: String,
    example: '2025-01-08',
    description:
      'Exclusive company-local calendar date; use nextCursor to page backwards.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

@TenantRoute()
@Controller('analytics/tasks')
export class TaskMetricsController {
  constructor(private readonly metrics: TaskCreationMetricsService) {}

  @Get('created')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ, PERMISSIONS.TASKS_READ)
  @ApiOperation({
    summary: 'Task creation counts in consecutive company-local days',
    description:
      'Two equal periods over non-archived visible projects. Day boundaries are UTC ISO timestamps. The default cursor excludes today so the compared periods contain complete local days.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of days per period, 1–30 (default 7)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Exclusive local calendar date YYYY-MM-DD',
  })
  @ApiOkResponse({
    description:
      'Envelope with current/previous counts, delta, nullable deltaPercent, day series and nextCursor.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          required: [
            'timezone',
            'limit',
            'nextCursor',
            'current',
            'previous',
            'delta',
            'deltaPercent',
            'series',
          ],
          properties: {
            timezone: { type: 'string' },
            limit: { type: 'integer' },
            nextCursor: {
              type: 'string',
              nullable: true,
              example: '2025-01-05',
            },
            current: { type: 'integer' },
            previous: { type: 'integer' },
            delta: { type: 'integer' },
            deltaPercent: { type: 'number', nullable: true },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  startAt: { type: 'string', format: 'date-time' },
                  endAt: { type: 'string', format: 'date-time' },
                  count: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  })
  get(
    @CurrentUser() actor: AuthUser,
    @Query() query: TaskCreationMetricsQueryDto,
  ) {
    return this.metrics.get(actor, query);
  }
}
