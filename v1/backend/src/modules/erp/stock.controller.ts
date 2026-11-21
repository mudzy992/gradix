import { Body, Controller, Get, Post } from '@nestjs/common';
import { StockService } from './stock.service';
import { CreateMovementDto } from './warehouses.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('stock')
  @RequirePermissions(PERMISSIONS.ERP_READ)
  list(@CurrentUser() actor: AuthUser) {
    return this.stock.list(actor);
  }

  @Post('stock-movements')
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateMovementDto) {
    return this.stock.createMovement(actor, dto);
  }
}
