import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DiaryService } from './diary.service';
import { DiaryPdfService } from './diary-pdf.service';
import {
  DiaryListQueryDto,
  DiaryPhotoDto,
  PatchDiaryDto,
  UpsertDiaryDto,
} from './diary.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('diary')
export class DiaryController {
  constructor(
    private readonly diary: DiaryService,
    private readonly pdfs: DiaryPdfService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DIARY_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: DiaryListQueryDto) {
    return this.diary.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DIARY_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: UpsertDiaryDto) {
    return this.diary.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DIARY_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.diary.getById(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DIARY_WRITE)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchDiaryDto,
  ) {
    return this.diary.patch(actor, id, dto);
  }

  @Post(':id/photos')
  @RequirePermissions(PERMISSIONS.DIARY_WRITE)
  addPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: DiaryPhotoDto,
  ) {
    return this.diary.addPhoto(actor, id, dto);
  }

  @Post(':id/pdf')
  @RequirePermissions(PERMISSIONS.DIARY_READ)
  pdf(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.pdfs.generate(actor, id);
  }
}
