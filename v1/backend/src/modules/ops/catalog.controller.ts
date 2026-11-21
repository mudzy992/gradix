import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateMaterialDto, PatchMaterialDto } from './fuel.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('materials')
export class MaterialsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    return this.catalog.listMaterials(actor);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateMaterialDto) {
    return this.catalog.createMaterial(actor, dto);
  }

  @Patch(':id')
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchMaterialDto,
  ) {
    return this.catalog.patchMaterial(actor, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.catalog.removeMaterial(actor, id);
  }
}
