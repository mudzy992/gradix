import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';
import {
  assertPlannedRange,
  parseOptionalDate,
} from '../../common/scope/ops-dates';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { CreateTaskDto, PatchTaskDto, TaskListQueryDto } from './tasks.dto';
import { serializeTask } from './serialize-task';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, query: TaskListQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.TaskWhereInput = { companyId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.assigneeId)
      where.assignees = { some: { userId: query.assigneeId } };
    if (
      !isCompanyWide(actor) &&
      !hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')
    ) {
      where.assignees = { some: { userId: actor.id } };
    } else if (!isCompanyWide(actor)) {
      where.project = { assignments: { some: { userId: actor.id } } };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: { assignees: true },
        skip,
        take: limit,
        orderBy: { createdAt: query.order ?? 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);
    return listResult(rows.map(serializeTask), total, page, limit);
  }

  async getById(actor: AuthUser, id: string) {
    return serializeTask(await this.loadVisibleTask(actor, id));
  }

  async create(actor: AuthUser, dto: CreateTaskDto) {
    const project = await this.access.getVisibleProject(actor, dto.projectId);
    await this.access.assertScopedWrite(actor, project);
    this.access.assertDispatchable(project);
    const plannedStart = parseOptionalDate(dto.plannedStart);
    const plannedEnd = parseOptionalDate(dto.plannedEnd);
    assertPlannedRange(plannedStart ?? null, plannedEnd ?? null);
    if (dto.phaseId) {
      const phase = await this.prisma.projectPhase.findFirst({
        where: { id: dto.phaseId, projectId: dto.projectId },
      });
      if (!phase) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'phaseId not in project',
          400,
        );
      }
    }
    // BE-06: duplikat u nizu je pravio P2002 (500) — sada se tiho svodi na jednu dodjelu.
    const assigneeIds = [...new Set(dto.assigneeIds ?? [])];
    await this.assertAssignees(project.companyId, assigneeIds);
    const task = await this.prisma.task.create({
      data: {
        companyId: project.companyId,
        projectId: dto.projectId,
        phaseId: dto.phaseId ?? null,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'MEDIUM',
        status: assigneeIds.length ? 'ASSIGNED' : 'PENDING',
        plannedStart,
        plannedEnd,
        assignees: {
          create: assigneeIds.map((userId) => ({
            companyId: project.companyId,
            userId,
          })),
        },
      },
      include: { assignees: true },
    });
    if (assigneeIds.length) {
      await this.notifyDispatch(
        project.companyId,
        task.id,
        dto.projectId,
        assigneeIds,
      );
    }
    this.realtime.emitProject(dto.projectId, 'task:updated', {
      id: task.id,
      projectId: dto.projectId,
      taskId: task.id,
    });
    // BE-08 (B8): kreiranje i izmjena zadatka nisu ostavljali trag u auditu.
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'TASK_CREATED',
      entityType: 'Task',
      entityId: task.id,
      payload: { projectId: dto.projectId, assigneeIds },
    });
    return serializeTask(task);
  }

  async patch(actor: AuthUser, id: string, dto: PatchTaskDto) {
    const task = await this.loadVisibleTask(actor, id);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new AppError(ERROR_CODES.CONFLICT, 'Task is terminal', 409);
    }
    const plannedStart =
      dto.plannedStart !== undefined
        ? (parseOptionalDate(dto.plannedStart) ?? null)
        : task.plannedStart;
    const plannedEnd =
      dto.plannedEnd !== undefined
        ? (parseOptionalDate(dto.plannedEnd) ?? null)
        : task.plannedEnd;
    assertPlannedRange(plannedStart, plannedEnd);
    if (dto.phaseId) {
      const phase = await this.prisma.projectPhase.findFirst({
        where: { id: dto.phaseId, projectId: task.projectId },
      });
      if (!phase) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'phaseId not in project',
          400,
        );
      }
    }
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        plannedStart: dto.plannedStart !== undefined ? plannedStart : undefined,
        plannedEnd: dto.plannedEnd !== undefined ? plannedEnd : undefined,
        phaseId: dto.phaseId === undefined ? undefined : dto.phaseId,
      },
      include: { assignees: true },
    });
    this.realtime.emitProject(task.projectId, 'task:updated', {
      id,
      projectId: task.projectId,
      taskId: id,
    });
    await this.audit.write({
      companyId: project.companyId,
      actorId: actor.id,
      action: 'TASK_UPDATED',
      entityType: 'Task',
      entityId: id,
      payload: { fields: Object.keys(dto) },
    });
    return serializeTask(updated);
  }

  async loadVisibleTask(actor: AuthUser, id: string) {
    const companyId = requireCompany(actor);
    const task = await this.prisma.task.findFirst({
      where: { id, companyId },
      include: { assignees: true },
    });
    if (!task) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Task not found', 404);
    }
    if (
      isCompanyWide(actor) ||
      hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')
    ) {
      await this.access.getVisibleProject(actor, task.projectId);
      return task;
    }
    if (!task.assignees.some((item) => item.userId === actor.id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Task not found', 404);
    }
    return task;
  }

  private async assertAssignees(
    companyId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    // BE-06: jedan upit umjesto N (ranije: findFirst po svakom izvršiocu).
    const found = await this.prisma.user.findMany({
      where: { id: { in: userIds }, companyId, isActive: true },
      select: { id: true },
    });
    if (found.length !== userIds.length) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Inactive user cannot be assigned',
        400,
      );
    }
  }

  private async notifyDispatch(
    companyId: string,
    taskId: string,
    projectId: string,
    userIds: string[],
  ): Promise<void> {
    for (const userId of userIds) {
      await this.notifications.createForUser({
        companyId,
        userId,
        type: 'TASK_DISPATCHED',
        title: 'Task assigned',
        message: 'You were assigned to a task',
        data: { taskId, projectId },
      });
      this.realtime.emitProject(projectId, 'task:assigned', {
        id: taskId,
        projectId,
        taskId,
      });
    }
  }
}
