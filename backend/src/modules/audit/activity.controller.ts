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
import type { AuthUser } from '../../common/types/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import { ActivityService } from './activity.service';

class ActivityQueryDto {
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
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('events')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: 'Tenant administrator activity events (audit payload excluded)',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: 'Page size 1–20, default 20',
  })
  @ApiQuery({
    name: 'cursor',
    type: String,
    required: false,
    description: 'Event id from meta.nextCursor',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'id',
              'action',
              'entityType',
              'entityId',
              'actorId',
              'createdAt',
            ],
            properties: {
              id: { type: 'string' },
              action: { type: 'string' },
              entityType: { type: 'string' },
              entityId: { type: 'string' },
              actorId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
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
  list(@CurrentUser() actor: AuthUser, @Query() query: ActivityQueryDto) {
    return this.activity.list(actor, query);
  }
}
