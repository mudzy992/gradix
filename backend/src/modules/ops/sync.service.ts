import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isCompanyWide } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { SyncPushDto, SyncPullDto, SyncItemResult } from './sync.dto';
import { syncErr } from './sync-result';
import { SyncPushTimerService } from './sync-push-timer';
import { SyncPushFleetService } from './sync-push-fleet';
import { SyncPushDiaryService } from './sync-push-diary';
import { serializeTimer } from './serialize-timer';
import { serializeTrip, serializeFuel } from './serialize-fleet';
import { serializeDiary } from './serialize-diary';
import { serializeTask } from './serialize-task';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timers: SyncPushTimerService,
    private readonly fleet: SyncPushFleetService,
    private readonly diary: SyncPushDiaryService,
  ) {}

  async push(actor: AuthUser, dto: SyncPushDto) {
    const results: SyncItemResult[] = [];
    for (const item of dto.items) {
      try {
        results.push(await this.dispatch(actor, item));
      } catch (error) {
        if (error instanceof AppError) {
          results.push(syncErr(item.localId, item.type, error));
          continue;
        }
        throw error;
      }
    }
    return { results };
  }

  async pull(actor: AuthUser, dto: SyncPullDto) {
    const companyId = requireCompany(actor);
    const since = dto.since ? new Date(dto.since) : new Date(0);
    if (Number.isNaN(since.getTime())) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'since is invalid', 400);
    }
    const updated: Prisma.DateTimeFilter = { gte: since };
    const [timers, trips, fuel, diary, tasks] = await Promise.all([
      this.prisma.timerSession.findMany({
        where: { companyId, userId: actor.id, updatedAt: updated },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.trip.findMany({
        where: { companyId, driverId: actor.id, updatedAt: updated },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.fuelEntry.findMany({
        where: { companyId, userId: actor.id, updatedAt: updated },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.diaryEntry.findMany({
        where: { companyId, updatedAt: updated, ...this.diaryWhere(actor) },
        include: { photos: true },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { companyId, updatedAt: updated, ...this.taskWhere(actor) },
        include: { assignees: true },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);
    const lastSyncTimestamp = new Date().toISOString();
    return {
      serverTime: lastSyncTimestamp,
      lastSyncTimestamp,
      timers: timers.map(serializeTimer),
      trips: trips.map(serializeTrip),
      fuel: fuel.map(serializeFuel),
      diary: diary.map(serializeDiary),
      tasks: tasks.map(serializeTask),
    };
  }

  private async dispatch(actor: AuthUser, item: SyncPushDto['items'][number]) {
    if (item.type === 'TIMER') {
      return this.timers.push(actor, item);
    }
    if (item.type === 'TRIP') {
      return this.fleet.pushTrip(actor, item);
    }
    if (item.type === 'FUEL') {
      return this.fleet.pushFuel(actor, item);
    }
    if (item.type === 'DIARY') {
      return this.diary.pushEntry(actor, item);
    }
    return this.diary.pushPhoto(actor, item);
  }

  private diaryWhere(actor: AuthUser): Prisma.DiaryEntryWhereInput {
    if (isCompanyWide(actor)) {
      return {};
    }
    return { project: { assignments: { some: { userId: actor.id } } } };
  }

  private taskWhere(actor: AuthUser): Prisma.TaskWhereInput {
    if (isCompanyWide(actor)) {
      return {};
    }
    return {
      OR: [
        { assignees: { some: { userId: actor.id } } },
        { project: { assignments: { some: { userId: actor.id } } } },
      ],
    };
  }
}
