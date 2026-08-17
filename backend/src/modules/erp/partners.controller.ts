import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { CreatePartnerDto, PartnerQueryDto, PatchPartnerDto } from './partners.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ERP_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: PartnerQueryDto) {
    return this.partners.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreatePartnerDto) {
    return this.partners.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ERP_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.partners.getById(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  patch(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: PatchPartnerDto) {
    return this.partners.patch(actor, id, dto);
  }
}
