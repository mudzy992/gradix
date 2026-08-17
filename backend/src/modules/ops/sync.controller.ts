import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncCatalogService } from './sync-catalog.service';
import { DiaryConflictService } from './diary-conflict.service';
import { ResolveConflictDto } from './diary.dto';
import { SyncPullDto, SyncPushDto } from './sync.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly catalog: SyncCatalogService,
    private readonly conflicts: DiaryConflictService,
  ) {}

  @Post('push')
  @HttpCode(200)
  push(@CurrentUser() actor: AuthUser, @Body() dto: SyncPushDto) {
    return this.sync.push(actor, dto);
  }

  @Post('pull')
  @HttpCode(200)
  pull(@CurrentUser() actor: AuthUser, @Body() dto: SyncPullDto) {
    return this.sync.pull(actor, dto);
  }

  @Get('catalog')
  getCatalog(@CurrentUser() actor: AuthUser) {
    return this.catalog.catalog(actor);
  }

  @Post('resolve-conflict')
  @RequirePermissions(PERMISSIONS.DIARY_WRITE)
  resolve(@CurrentUser() actor: AuthUser, @Body() dto: ResolveConflictDto) {
    return this.conflicts.resolve(actor, dto);
  }
}
