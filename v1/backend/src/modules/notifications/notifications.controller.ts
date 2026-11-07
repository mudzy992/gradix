import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './notifications.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: NotificationQueryDto) {
    return this.notifications.list(actor, query);
  }

  @Patch(':id/read')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  markRead(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(actor, id);
  }

  @Post('read-all')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  markAllRead(@CurrentUser() actor: AuthUser) {
    return this.notifications.markAllRead(actor);
  }
}
