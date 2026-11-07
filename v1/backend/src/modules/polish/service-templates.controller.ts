import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import {
  CreateTemplateDto,
  PatchTemplateDto,
  TemplateListQueryDto,
} from './services.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('service-templates')
export class ServiceTemplatesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: TemplateListQueryDto) {
    return this.services.listTemplates(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICES_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.services.createTemplate(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SERVICES_WRITE)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchTemplateDto,
  ) {
    return this.services.patchTemplate(actor, id, dto);
  }
}
