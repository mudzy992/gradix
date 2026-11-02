import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DocsService } from './docs.service';
import {
  CreateCompanyDocDto,
  CreateMachineDocDto,
  CreateWorkerDocDto,
  DocsListQueryDto,
  PatchDocDto,
} from './docs.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('documents')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get('company')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_READ)
  listCompany(
    @CurrentUser() actor: AuthUser,
    @Query() query: DocsListQueryDto,
  ) {
    return this.docs.listCompany(actor, query);
  }

  @Post('company')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_WRITE)
  createCompany(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateCompanyDocDto,
  ) {
    return this.docs.createCompany(actor, dto);
  }

  @Patch('company/:id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_WRITE)
  patchCompany(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchDocDto,
  ) {
    return this.docs.patchCompany(actor, id, dto);
  }

  @Get('worker')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_READ)
  listWorker(@CurrentUser() actor: AuthUser, @Query() query: DocsListQueryDto) {
    return this.docs.listWorker(actor, query);
  }

  @Post('worker')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_WRITE)
  createWorker(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateWorkerDocDto,
  ) {
    return this.docs.createWorker(actor, dto);
  }

  @Get('machine')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_READ)
  listMachine(
    @CurrentUser() actor: AuthUser,
    @Query() query: DocsListQueryDto,
  ) {
    return this.docs.listMachine(actor, query);
  }

  @Post('machine')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_WRITE)
  createMachine(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateMachineDocDto,
  ) {
    return this.docs.createMachine(actor, dto);
  }
}
