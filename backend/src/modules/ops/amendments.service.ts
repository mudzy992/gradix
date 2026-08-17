import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { canAmend } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { addTaskMinutes } from './task-status';
import { recalcProgress } from './progress';
import { addMachineHours } from './machine-hours';
import { applyFuelAmendment, applyTripAmendment } from './amendment-fleet';
import { AmendmentListQueryDto, CreateAmendmentDto } from './amendments.dto';

@Injectable()
export class AmendmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, query: AmendmentListQueryDto) {
    this.assertWriter(actor);
    if (!query.entityType || !query.entityId) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'entityType and entityId required', 400);
    }
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.AmendmentWhereInput = {
      companyId,
      entityType: query.entityType as 'TIMER' | 'TRIP' | 'FUEL',
      entityId: query.entityId,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.amendment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.amendment.count({ where }),
    ]);
    return listResult(rows, total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateAmendmentDto) {
    this.assertWriter(actor);
    const companyId = requireCompany(actor);
    if (dto.entityType === 'TIMER') {
      return this.createTimer(actor, companyId, dto);
    }
    const applied =
      dto.entityType === 'TRIP'
        ? await applyTripAmendment(this.prisma, companyId, dto.entityId, dto.field, dto.newValue)
        : await applyFuelAmendment(this.prisma, companyId, dto.entityId, dto.field, dto.newValue);
    const action = dto.entityType === 'TRIP' ? 'TRIP_AMENDED' : 'FUEL_AMENDED';
    const row = await this.prisma.amendment.create({
      data: {
        companyId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        field: dto.field,
        oldValue: applied.oldValue,
        newValue: dto.newValue,
        reason: dto.reason,
        actorId: actor.id,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action,
      entityType: dto.entityType,
      entityId: dto.entityId,
      payload: { field: dto.field, old: applied.oldValue, next: dto.newValue },
    });
    await this.notifications.createForUser({
      companyId,
      userId: applied.ownerId,
      type: 'AMENDMENT_CREATED',
      title: `${dto.entityType} amended`,
      message: dto.reason,
      data: { entityType: dto.entityType, entityId: dto.entityId },
    });
    return row;
  }

  private async createTimer(actor: AuthUser, companyId: string, dto: CreateAmendmentDto) {
    if (dto.field !== 'durationMinutes') {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'TIMER field must be durationMinutes', 400);
    }
    const minutes = Number(dto.newValue);
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'durationMinutes must be integer >= 0', 400);
    }
    const session = await this.prisma.timerSession.findFirst({
      where: { id: dto.entityId, companyId },
    });
    if (!session) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Timer not found', 404);
    }
    if (!session.closedAt) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Open timer cannot be amended', 409);
    }
    const delta = minutes - (session.durationMinutes ?? 0);
    await this.prisma.timerSession.update({
      where: { id: session.id },
      data: {
        durationMinutes: minutes,
        ...(session.approvalStatus === 'APPROVED' ? { approvalStatus: 'PENDING' as const } : {}),
      },
    });
    await addTaskMinutes(this.prisma, session.taskId, delta);
    await addMachineHours(this.prisma, session.machineId, delta);
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: session.taskId } });
    await recalcProgress(this.prisma, task.projectId);
    const row = await this.prisma.amendment.create({
      data: {
        companyId,
        entityType: 'TIMER',
        entityId: session.id,
        field: 'durationMinutes',
        oldValue: String(session.durationMinutes ?? 0),
        newValue: String(minutes),
        reason: dto.reason,
        actorId: actor.id,
      },
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'TIMER_AMENDED',
      entityType: 'TimerSession',
      entityId: session.id,
      payload: { old: session.durationMinutes, next: minutes },
    });
    await this.notifications.createForUser({
      companyId,
      userId: session.userId,
      type: 'AMENDMENT_CREATED',
      title: 'Timer amended',
      message: dto.reason,
      data: { timerId: session.id },
    });
    return row;
  }

  private assertWriter(actor: AuthUser): void {
    if (!canAmend(actor)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Amendment not allowed', 403);
    }
  }
}
