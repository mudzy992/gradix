import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { PhasesService } from './phases.service';
import { AssignmentsService } from './assignments.service';
import { DocumentsService } from './documents.service';
import { LocationsService } from './locations.service';
import { CreateAssignmentDto, CreateDocumentDto, CreatePhaseDto, PatchPhaseDto } from './projects.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('projects/:id')
export class ProjectNestedController {
  constructor(
    private readonly phases: PhasesService,
    private readonly assignments: AssignmentsService,
    private readonly documents: DocumentsService,
    private readonly locations: LocationsService,
  ) {}

  @Get('presence')
  presence(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.locations.presence(actor, id);
  }

  @Get('phases')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  listPhases(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.phases.list(actor, id);
  }

  @Post('phases')
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  createPhase(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: CreatePhaseDto) {
    return this.phases.create(actor, id, dto);
  }

  @Patch('phases/:phaseId')
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  patchPhase(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
    @Body() dto: PatchPhaseDto,
  ) {
    return this.phases.patch(actor, id, phaseId, dto);
  }

  @Delete('phases/:phaseId')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  removePhase(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
  ) {
    return this.phases.remove(actor, id, phaseId);
  }

  @Get('assignments')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  listAssignments(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.assignments.list(actor, id);
  }

  @Post('assignments')
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  createAssignment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignments.create(actor, id, dto);
  }

  @Delete('assignments/:userId')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  removeAssignment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.assignments.remove(actor, id, userId);
  }

  @Get('documents')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  listDocuments(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.documents.list(actor, id);
  }

  @Post('documents')
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  createDocument(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documents.create(actor, id, dto);
  }

  @Delete('documents/:docId')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.PROJECTS_WRITE)
  removeDocument(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.documents.remove(actor, id, docId);
  }
}
