import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PublicSettingsQueryDto } from './settings.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('public')
  publicBySlug(@Query() query: PublicSettingsQueryDto) {
    return this.settings.publicBySlug(query.slug);
  }

  @TenantRoute()
  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  list(@CurrentUser() actor: AuthUser) {
    return this.settings.list(actor, actor.permissions.includes(PERMISSIONS.SETTINGS_WRITE));
  }

  @TenantRoute()
  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  put(@CurrentUser() actor: AuthUser, @Body() body: Record<string, unknown>) {
    return this.settings.put(actor, body);
  }
}
