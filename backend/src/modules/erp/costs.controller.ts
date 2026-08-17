import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CostsService } from './costs.service';
import { CostQueryDto, CreateCostDto, FromPayrollDto } from './costs.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('cost-entries')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ERP_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: CostQueryDto) {
    return this.costs.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCostDto) {
    return this.costs.create(actor, dto);
  }

  @Post('from-payroll')
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  fromPayroll(@CurrentUser() actor: AuthUser, @Body() dto: FromPayrollDto) {
    return this.costs.fromPayroll(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ERP_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.costs.getById(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.ERP_WRITE)
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.costs.remove(actor, id);
  }
}
