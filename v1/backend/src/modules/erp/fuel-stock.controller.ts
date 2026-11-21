import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StockService } from './stock.service';
import { ApplyStockDto } from './warehouses.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('fuel')
export class FuelStockController {
  constructor(private readonly stock: StockService) {}

  @Post(':id/apply-stock')
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  async apply(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApplyStockDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.stock.applyFuel(actor, id, dto);
    response.status(result.created ? 201 : 200);
    return result.row;
  }
}
