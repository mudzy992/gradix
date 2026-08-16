import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, PatchCompanyDto } from './companies.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES)
  list(@Query() query: PaginationQueryDto) {
    return this.companies.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchCompanyDto,
  ) {
    return this.companies.patchPlatform(actor, id, dto);
  }
}
