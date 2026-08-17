import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TimerService } from './timer.service';
import { StartTimerDto, TimerListQueryDto } from './timer.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('timer')
export class TimerController {
  constructor(private readonly timer: TimerService) {}

  @Get('me')
  me(@CurrentUser() actor: AuthUser) {
    return this.timer.me(actor);
  }

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: TimerListQueryDto) {
    return this.timer.listByProject(actor, query.projectId);
  }

  @Post('start')
  @RequirePermissions(PERMISSIONS.TASKS_TIMER)
  start(@CurrentUser() actor: AuthUser, @Body() dto: StartTimerDto) {
    return this.timer.start(actor, dto);
  }

  @Post('pause')
  @RequirePermissions(PERMISSIONS.TASKS_TIMER)
  pause(@CurrentUser() actor: AuthUser) {
    return this.timer.pause(actor);
  }

  @Post('resume')
  @RequirePermissions(PERMISSIONS.TASKS_TIMER)
  resume(@CurrentUser() actor: AuthUser) {
    return this.timer.resume(actor);
  }

  @Post('stop')
  @RequirePermissions(PERMISSIONS.TASKS_TIMER)
  stop(@CurrentUser() actor: AuthUser) {
    return this.timer.stop(actor);
  }
}
