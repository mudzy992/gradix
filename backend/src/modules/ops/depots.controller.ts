import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateDepotDto, PatchDepotDto } from './fuel.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('depots')
export class DepotsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    return this.catalog.listDepots(actor);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateDepotDto) {
    return this.catalog.createDepot(actor, dto);
  }

  @Patch(':id')
  patch(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: PatchDepotDto) {
    return this.catalog.patchDepot(actor, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.catalog.removeDepot(actor, id);
  }
}
