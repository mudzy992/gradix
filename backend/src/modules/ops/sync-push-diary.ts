import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { DiaryService } from './diary.service';
import { UpsertDiaryDto, DiaryPhotoDto } from './diary.dto';
import { SyncPushItemDto } from './sync.dto';
import { asOptionalString, asString, syncOk } from './sync-result';
import { requireCompany } from '../users/users-helpers';
import { assertDiaryWrite } from './diary-access';

@Injectable()
export class SyncPushDiaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly diary: DiaryService,
  ) {}

  async pushEntry(actor: AuthUser, item: SyncPushItemDto) {
    assertDiaryWrite(actor);
    const existing = await this.prisma.diaryEntry.findFirst({
      where: {
        companyId: requireCompany(actor),
        deviceId: item.deviceId,
        localId: item.localId,
      },
    });
    if (existing) {
      return syncOk(item.localId, 'DIARY', existing.id);
    }
    const dto = this.toUpsert(item.payload);
    dto.localId = item.localId;
    const created = await this.diary.create(actor, dto);
    await this.prisma.diaryEntry.update({
      where: { id: created.id },
      data: { deviceId: item.deviceId, localId: item.localId, isSynced: true },
    });
    return syncOk(item.localId, 'DIARY', created.id);
  }

  async pushPhoto(actor: AuthUser, item: SyncPushItemDto) {
    assertDiaryWrite(actor);
    const diaryLocalId = asString(item.payload.diaryLocalId, 'diaryLocalId');
    const entry = await this.prisma.diaryEntry.findFirst({
      where: {
        companyId: requireCompany(actor),
        deviceId: item.deviceId,
        localId: diaryLocalId,
      },
    });
    if (!entry) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Diary entry not synced yet', 404);
    }
    const dto: DiaryPhotoDto = {
      path: asString(item.payload.path, 'path'),
      caption: asOptionalString(item.payload.caption),
      lat: asOptionalString(item.payload.lat),
      lng: asOptionalString(item.payload.lng),
    };
    const photo = await this.diary.addPhoto(actor, entry.id, dto);
    return syncOk(item.localId, 'PHOTO', photo.id);
  }

  private toUpsert(payload: Record<string, unknown>): UpsertDiaryDto {
    const dto = new UpsertDiaryDto();
    dto.projectId = asString(payload.projectId, 'projectId');
    dto.date = asString(payload.date, 'date');
    dto.weather = asOptionalString(payload.weather);
    dto.tempMin = asOptionalString(payload.tempMin);
    dto.tempMax = asOptionalString(payload.tempMax);
    dto.workDescription = asOptionalString(payload.workDescription);
    dto.problemsNoted = asOptionalString(payload.problemsNoted);
    if (typeof payload.workersCount === 'number') {
      dto.workersCount = payload.workersCount;
    }
    return dto;
  }
}
