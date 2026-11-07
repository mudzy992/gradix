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
import { isSerializationFailure } from '../../common/utils/serialization-retry';
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
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'entityType and entityId required',
        400,
      );
    }
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.AmendmentWhereInput = {
      companyId,
      entityType: query.entityType,
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
    const action = dto.entityType === 'TRIP' ? 'TRIP_AMENDED' : 'FUEL_AMENDED';
    // BE-07 (F-07): izmjena entiteta i zapis ispravke su jedna transakcija — ranije je pad
    // na `amendment.create` ostavljao promijenjene podatke bez traga o ispravci.
    const operation = async (tx: Prisma.TransactionClient) => {
      const applied =
        dto.entityType === 'TRIP'
          ? await applyTripAmendment(
              tx,
              companyId,
              dto.entityId,
              dto.field,
              dto.newValue,
            )
          : await applyFuelAmendment(
              tx,
              companyId,
              dto.entityId,
              dto.field,
              dto.newValue,
            );
      const row = await tx.amendment.create({
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
      return { row, applied };
    };
    const { row, applied } =
      dto.entityType === 'FUEL'
        ? await this.runFuelAmendmentTx(operation)
        : await this.prisma.$transaction(operation);
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

  private async runFuelAmendmentTx<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!isSerializationFailure(error)) throw error;
        if (attempt >= 3)
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'Fuel or stock is being updated concurrently, retry',
            409,
          );
      }
    }
  }

  private async createTimer(
    actor: AuthUser,
    companyId: string,
    dto: CreateAmendmentDto,
  ) {
    if (dto.field !== 'durationMinutes') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'TIMER field must be durationMinutes',
        400,
      );
    }
    const minutes = Number(dto.newValue);
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'durationMinutes must be integer >= 0',
        400,
      );
    }
    const session = await this.prisma.timerSession.findFirst({
      where: { id: dto.entityId, companyId },
    });
    if (!session) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Timer not found', 404);
    }
    if (!session.closedAt) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Open timer cannot be amended',
        409,
      );
    }
    const delta = minutes - (session.durationMinutes ?? 0);
    // BE-07 (F-06): minuti na zadatku, sati na mašini, progres i zapis ispravke moraju biti
    // atomični sa promjenom same sesije — inače ispravka ostaje „pola primijenjena“.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.timerSession.update({
        where: { id: session.id },
        data: {
          durationMinutes: minutes,
          ...(session.approvalStatus === 'APPROVED'
            ? { approvalStatus: 'PENDING' as const }
            : {}),
        },
      });
      await addTaskMinutes(tx, session.taskId, delta);
      await addMachineHours(tx, session.machineId, delta);
      const task = await tx.task.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      await recalcProgress(tx, task.projectId);
      return await tx.amendment.create({
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
