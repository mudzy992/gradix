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
import { TasksService } from './tasks.service';
import { TaskAssigneesService } from './task-assignees.service';
import { TaskDependenciesService } from './task-dependencies.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import {
  AssigneeDto,
  AttachmentDto,
  CreateTaskDto,
  DependencyDto,
  PatchTaskDto,
  TaskListQueryDto,
} from './tasks.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantRoute } from '../../common/decorators/tenant-route.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import type { AuthUser } from '../../common/types/auth-user';

@TenantRoute()
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly assignees: TaskAssigneesService,
    private readonly deps: TaskDependenciesService,
    private readonly lifecycle: TaskLifecycleService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TASKS_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: TaskListQueryDto) {
    return this.tasks.list(actor, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TASKS_READ)
  getById(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.tasks.getById(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  patch(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchTaskDto,
  ) {
    return this.tasks.patch(actor, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  complete(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.lifecycle.complete(actor, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  cancel(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.lifecycle.cancel(actor, id);
  }

  @Post(':id/assignees')
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  addAssignee(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssigneeDto,
  ) {
    return this.assignees.add(actor, id, dto);
  }

  @Delete(':id/assignees/:userId')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  removeAssignee(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.assignees.remove(actor, id, userId);
  }

  @Post(':id/attachments')
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  addAttachment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: AttachmentDto,
  ) {
    return this.assignees.addAttachment(actor, id, dto);
  }

  @Delete(':id/attachments/:attId')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  removeAttachment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('attId') attId: string,
  ) {
    return this.assignees.removeAttachment(actor, id, attId);
  }

  @Post(':id/dependencies')
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  addDep(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: DependencyDto,
  ) {
    return this.deps.add(actor, id, dto);
  }

  @Delete(':id/dependencies/:depId')
  @HttpCode(204)
  @SkipEnvelope()
  @RequirePermissions(PERMISSIONS.TASKS_WRITE)
  removeDep(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('depId') depId: string,
  ) {
    return this.deps.remove(actor, id, depId);
  }
}
