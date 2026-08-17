import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TendersService } from './tenders.service';
import {
  CreateTenderDto,
  PatchTenderDto,
  TenderAttachmentDto,
  TenderListQueryDto,
} from './tenders.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('tenders')
export class TendersController {
  constructor(private readonly tenders: TendersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TENDERS_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: TenderListQueryDto) {
    return this.tenders.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TENDERS_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateTenderDto) {
    return this.tenders.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TENDERS_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.tenders.getById(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TENDERS_WRITE)
  patch(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: PatchTenderDto) {
    return this.tenders.patch(actor, id, dto);
  }

  @Post(':id/attachments')
  @RequirePermissions(PERMISSIONS.TENDERS_WRITE)
  attach(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: TenderAttachmentDto,
  ) {
    return this.tenders.addAttachment(actor, id, dto);
  }

  @Post(':id/convert')
  @RequirePermissions(PERMISSIONS.TENDERS_WRITE)
  convert(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.tenders.convert(actor, id);
  }
}
