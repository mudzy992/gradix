import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { QuantitiesService } from './quantities.service';
import { CreateQuantityDto, PatchQuantityDto } from './quantities.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('projects/:id/quantities')
export class QuantitiesController {
  constructor(private readonly quantities: QuantitiesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUANTITIES_READ)
  list(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.quantities.list(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUANTITIES_WRITE)
  create(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateQuantityDto,
  ) {
    return this.quantities.create(actor, id, dto);
  }

  @Patch(':qtyId')
  @RequirePermissions(PERMISSIONS.QUANTITIES_WRITE)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('qtyId') qtyId: string,
    @Body() dto: PatchQuantityDto,
  ) {
    return this.quantities.patch(actor, id, qtyId, dto);
  }
}
