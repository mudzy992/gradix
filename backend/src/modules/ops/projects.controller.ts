import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  PatchProjectDto,
  PatchProjectStatusDto,
  ProjectListQueryDto,
} from './projects.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: ProjectListQueryDto) {
    return this.projects.list(actor, query);
  }

  @Get('picker')
  listPicker(@CurrentUser() actor: AuthUser) {
    return this.projects.listPicker(actor);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(actor, dto);
  }

  @Get(':id')
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.projects.getById(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchProjectDto,
  ) {
    return this.projects.patch(actor, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  patchStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchProjectStatusDto,
  ) {
    return this.projects.patchStatus(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  archive(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.projects.archive(actor, id);
  }
}
