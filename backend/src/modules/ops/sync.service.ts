import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { isCompanyWide } from '../../common/scope/ops-roles';
import { SYNC_PULL_LIMIT } from '../../common/constants';
import { pullWatermark } from './sync-watermark';
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
        results.push(await this.dispatchIdempotent(actor, item));
      } catch (error) {
        if (error instanceof AppError) {
          results.push(syncErr(item.localId, item.type, error));
          continue;
        }
        // BE-17 (F-03): poznate Prisma greške ne smiju oboriti **cijeli** batch (500),
        // jer su ostali itemi već možda upisani. Nepoznate greške i dalje idu kao 500.
        const mapped = this.mapPrismaError(error);
        if (mapped) {
          results.push(syncErr(item.localId, item.type, mapped));
          continue;
        }
        throw error;
      }
    }
    return { results };
  }

  /**
   * BE-17 (F-03): `findFirst` pa `create` nije atomski — dva paralelna replay-a istog
   * `localId` oba prođu provjeru, a drugi padne na unique `(companyId, userId, deviceId,
   * localId)`. Umjesto `500` za cijeli batch, ponavljamo dispatch **jednom**: provjera
   * idempotentnosti sada nalazi zapis koji je upisao pobjednik i vraća `ok`.
   */
  private async dispatchIdempotent(
    actor: AuthUser,
    item: SyncPushDto['items'][number],
  ): Promise<SyncItemResult> {
    try {
      return await this.dispatch(actor, item);
    } catch (error) {
      const isUnique =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';
      if (!isUnique) {
        throw error;
      }
      return this.dispatch(actor, item);
    }
  }

  private mapPrismaError(error: unknown): AppError | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return null;
    }
    if (error.code === 'P2002') {
      return new AppError(ERROR_CODES.CONFLICT, 'Duplicate record', 409);
    }
    if (error.code === 'P2025') {
      return new AppError(ERROR_CODES.NOT_FOUND, 'Record not found', 404);
    }
    return null;
  }

  async pull(actor: AuthUser, dto: SyncPullDto) {
    const companyId = requireCompany(actor);
    const since = dto.since ? new Date(dto.since) : new Date(0);
    if (Number.isNaN(since.getTime())) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'since is invalid',
        400,
      );
    }
    const now = new Date();
    // BE-17 (F-05): `since` u budućnosti bi zaglavio klijenta — vratio bi prazan
    // odgovor, a watermark bi ostao u budućnosti, pa nikad više ne bi dobio podatke.
    if (since.getTime() > now.getTime()) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'since is in the future',
        400,
      );
    }
    const updated: Prisma.DateTimeFilter = { gte: since };
    // BE-17 (F-02): bez limita je `pull` sa starim `since` vraćao sve redove u jednom
    // odgovoru. Sada je po kolekciji najviše `SYNC_PULL_LIMIT`; klijent nastavlja od
    // watermark-a koji server vrati.
    const [timers, trips, fuel, diary, tasks] = await Promise.all([
      this.prisma.timerSession.findMany({
        where: { companyId, userId: actor.id, updatedAt: updated },
        orderBy: { updatedAt: 'asc' },
        take: SYNC_PULL_LIMIT,
      }),
      this.prisma.trip.findMany({
        where: { companyId, driverId: actor.id, updatedAt: updated },
        orderBy: { updatedAt: 'asc' },
        take: SYNC_PULL_LIMIT,
      }),
      this.prisma.fuelEntry.findMany({
        where: { companyId, userId: actor.id, updatedAt: updated },
        orderBy: { updatedAt: 'asc' },
        take: SYNC_PULL_LIMIT,
      }),
      this.prisma.diaryEntry.findMany({
        where: { companyId, updatedAt: updated, ...this.diaryWhere(actor) },
        include: { photos: true },
        orderBy: { updatedAt: 'asc' },
        take: SYNC_PULL_LIMIT,
      }),
      this.prisma.task.findMany({
        where: { companyId, updatedAt: updated, ...this.taskWhere(actor) },
        include: { assignees: true },
        orderBy: { updatedAt: 'asc' },
        take: SYNC_PULL_LIMIT,
      }),
    ]);
    // BE-17 (F-04): watermark je ranije bio `new Date()` — redovi upisani između upita i
    // odgovora imali su `updatedAt` manji od watermark-a, pa ih klijent **nikad** nije
    // dobio. Sada je watermark najmanji „zadnji `updatedAt`“ među kolekcijama koje su
    // nešto vratile; red na granici se šalje ponovo (klijent je idempotentan), ali se
    // nijedan ne preskače.
    const lastSyncTimestamp = pullWatermark(since, [
      timers,
      trips,
      fuel,
      diary,
      tasks,
    ]).toISOString();
    return {
      serverTime: now.toISOString(),
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
