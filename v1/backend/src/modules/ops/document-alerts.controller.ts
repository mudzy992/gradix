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
import { DocumentAlertsService } from './dashboard-document-alerts.service';

class DocumentAlertsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  cursor?: string;
}
@TenantRoute()
@Controller('alerts')
export class DocumentAlertsController {
  constructor(private readonly alerts: DocumentAlertsService) {}
  @Get('documents')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_READ)
  @ApiOperation({
    summary: 'Tenant-admin document expiry alerts',
    description:
      'Expired up to 90 days or due within 30 days; severity is based on local calendar days.',
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
    description: 'Opaque cursor from meta.nextCursor',
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
              kind: { type: 'string', enum: ['COMPANY', 'WORKER', 'MACHINE'] },
              type: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
              daysUntilExpiry: { type: 'integer' },
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
  list(@CurrentUser() actor: AuthUser, @Query() query: DocumentAlertsQueryDto) {
    return this.alerts.list(actor, query);
  }
}
