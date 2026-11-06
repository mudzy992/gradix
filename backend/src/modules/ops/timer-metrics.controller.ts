import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';
import { TaskCreationMetricsQueryDto } from './task-metrics.controller';
import { TimerMetricsService } from './dashboard-timer-metrics.service';

@TenantRoute()
@Controller('analytics/timers')
export class TimerMetricsController {
  constructor(private readonly metrics: TimerMetricsService) {}
  @Get('closed')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({
    summary: 'Approved timer durations attributed to closing day',
    description:
      'Tenant administrators only. Unique workers are counts of approved closed sessions, not live presence.',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: 'Days per period, 1–30, default 7',
  })
  @ApiQuery({
    name: 'cursor',
    type: String,
    required: false,
    description: 'Exclusive company-local date YYYY-MM-DD',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            timezone: { type: 'string' },
            limit: { type: 'integer' },
            nextCursor: { type: 'string', nullable: true },
            currentMinutes: { type: 'string', example: '240' },
            previousMinutes: { type: 'string', example: '180' },
            deltaMinutes: { type: 'string', example: '60' },
            deltaPercent: { type: 'string', nullable: true, example: '33.33' },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  startAt: { type: 'string', format: 'date-time' },
                  endAt: { type: 'string', format: 'date-time' },
                  minutes: { type: 'string' },
                  workers: { type: 'integer' },
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
