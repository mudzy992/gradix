import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, PatchUserDto, UsersQueryDto } from './users.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: UsersQueryDto) {
    return this.users.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.getById(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchUserDto,
  ) {
    return this.users.patch(actor, id, dto);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USERS_WRITE)
  resetPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.resetPassword(actor, id);
  }
}
