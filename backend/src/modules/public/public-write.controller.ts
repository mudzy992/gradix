import { Body, Controller, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import { MAX_UPLOAD_BYTES } from '../../common/constants';
import type { AuthUser } from '../../common/types/auth-user';
import { PublicService } from './public.service';
import { CreatePublicAssetDto, PatchProjectPublicDto } from './public.dto';

@Controller()
export class PublicWriteController {
  constructor(private readonly publicSite: PublicService) {}

  @Post('public/assets')
  @TenantRoute()
  @RequirePermissions(PERMISSIONS.PUBLIC_WRITE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  createAsset(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreatePublicAssetDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.publicSite.createAsset(actor, dto, file);
  }

  @Patch('projects/:id/public')
  @TenantRoute()
  @RequirePermissions(PERMISSIONS.PUBLIC_WRITE)
  patchProject(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchProjectPublicDto,
  ) {
    return this.publicSite.patchProjectPublic(actor, id, dto);
  }
}
