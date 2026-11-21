import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto, WarehouseQueryDto } from './warehouses.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ERP_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: WarehouseQueryDto) {
    return this.warehouses.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ERP_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.warehouses.getById(actor, id);
  }
}
