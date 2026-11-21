import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ServicesService } from './services.service';
import {
  CompleteServiceDto,
  CreateServiceDto,
  ServiceListQueryDto,
} from './services.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: ServiceListQueryDto) {
    return this.services.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICES_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateServiceDto) {
    return this.services.create(actor, dto);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.SERVICES_WRITE)
  start(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.services.start(actor, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.SERVICES_WRITE)
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CompleteServiceDto,
  ) {
    return this.services.complete(actor, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.SERVICES_WRITE)
  cancel(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.services.cancel(actor, id);
  }
}
