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
import { LivePresenceService } from './dashboard-live-presence.service';

class LivePresenceQueryDto {
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
@Controller('presence')
export class LivePresenceController {
  constructor(private readonly presence: LivePresenceService) {}
  @Get('people')
  @RequirePermissions(PERMISSIONS.USERS_READ, PERMISSIONS.PROJECTS_READ)
  @ApiOperation({
    summary: 'Recent project-geofence presence inferred from latest location',
    description:
      'Tenant administrators only; no raw coordinates. This is not attendance history.',
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
    description: 'User id from meta.nextCursor',
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
              userId: { type: 'string' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              projectId: { type: 'string' },
              lastSeenAt: { type: 'string', format: 'date-time' },
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
  list(@CurrentUser() actor: AuthUser, @Query() query: LivePresenceQueryDto) {
    return this.presence.list(actor, query);
  }
}
