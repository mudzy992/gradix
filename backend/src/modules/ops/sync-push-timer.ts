import { Injectable } from '@nestjs/common';
import { TimerSession } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PERMISSIONS } from '../../common/rbac/permission.constants';
import { TimerService } from './timer.service';
import { TimerForceCloseService } from './timer-force-close.service';
import { parseOptionalClosedAt } from './timer-clock';
import { SyncPushItemDto } from './sync.dto';
import { asOptionalString, asString, syncOk } from './sync-result';
import { StartTimerDto } from './timer.dto';

@Injectable()
export class SyncPushTimerService {
  constructor(
    private readonly timer: TimerService,
    private readonly closer: TimerForceCloseService,
  ) {}

  async push(actor: AuthUser, item: SyncPushItemDto) {
    this.assertTimerPerm(actor);
    const existing = await this.timer.findByLocalId(
      actor,
      item.deviceId,
      item.localId,
    );
    const action =
      item.action ?? asOptionalString(item.payload.action) ?? 'start';
    if (existing && action === 'start') {
      return syncOk(item.localId, 'TIMER', existing.id);
    }
    if (action === 'start') {
      return this.start(actor, item);
    }
    const session = existing ?? (await this.timer.requireMine(actor));
    if (action === 'pause') {
      return this.pause(item, session);
    }
    if (action === 'resume') {
      return this.resume(item, session);
    }
    if (action === 'stop') {
      return this.stop(actor, item, session);
    }
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Unknown timer action',
      400,
    );
  }

  private async start(actor: AuthUser, item: SyncPushItemDto) {
    const dto: StartTimerDto = {
      taskId: asString(item.payload.taskId, 'taskId'),
      machineId: asOptionalString(item.payload.machineId),
      lat: asOptionalString(item.payload.lat),
      lng: asOptionalString(item.payload.lng),
    };
    const session = await this.timer.startOffline(
      actor,
      dto,
      item.payload.startedAt,
      item.localId,
      item.deviceId,
    );
    if (item.payload.closedAt) {
      const closedAt = parseOptionalClosedAt(
        item.payload.closedAt,
        session.startedAt,
        new Date(),
      );
      const closed = await this.closer.closeSession(
        session,
        actor.id,
        'stop',
        closedAt,
      );
      return syncOk(item.localId, 'TIMER', closed.id);
    }
    return syncOk(item.localId, 'TIMER', session.id);
  }

  /** BE-07 (F-02): offline replay koristi istu (transakcionu) implementaciju kao online put. */
  private async pause(item: SyncPushItemDto, session: TimerSession) {
    if (session.closedAt) {
      return syncOk(item.localId, 'TIMER', session.id);
    }
    if (!session.pausedAt) {
      await this.timer.pauseSession(session);
    }
    return syncOk(item.localId, 'TIMER', session.id);
  }

  private async resume(item: SyncPushItemDto, session: TimerSession) {
    if (session.closedAt) {
      return syncOk(item.localId, 'TIMER', session.id);
    }
    if (session.pausedAt) {
      await this.timer.resumeSession(session);
    }
    return syncOk(item.localId, 'TIMER', session.id);
  }

  private async stop(
    actor: AuthUser,
    item: SyncPushItemDto,
    session: TimerSession,
  ) {
    const closedAt = parseOptionalClosedAt(
      item.payload.closedAt,
      session.startedAt,
      new Date(),
    );
    const closed = await this.closer.closeSession(
      session,
      actor.id,
      'stop',
      closedAt,
    );
    return syncOk(item.localId, 'TIMER', closed.id);
  }

  private assertTimerPerm(actor: AuthUser): void {
    if (!actor.permissions.includes(PERMISSIONS.TASKS_TIMER)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Timer not allowed', 403);
    }
  }
}
