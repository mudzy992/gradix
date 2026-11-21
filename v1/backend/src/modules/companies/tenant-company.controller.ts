import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { PatchCompanyDto } from './companies.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('company')
export class TenantCompanyController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  get(@CurrentUser() actor: AuthUser) {
    return this.companies.getTenant(actor);
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  patch(@CurrentUser() actor: AuthUser, @Body() dto: PatchCompanyDto) {
    return this.companies.patchTenant(actor, dto);
  }
}
