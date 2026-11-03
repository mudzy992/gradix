import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { DIARY_PHOTO_MAX } from '../../common/constants';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { assertStoragePath } from '../../common/utils/storage-path';
import { parseOptionalLatLng } from '../../common/utils/geo';
import { assertProjectWritable } from '../../common/scope/project-lock';
import { parseDateOnly } from '../../common/scope/company-tz';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import {
  DiaryListQueryDto,
  DiaryPhotoDto,
  PatchDiaryDto,
  UpsertDiaryDto,
} from './diary.dto';
import { serializeDiary } from './serialize-diary';
import {
  assertDiaryRead,
  assertDiaryWrite,
  diaryProjectWhere,
  diaryWriteData,
  incomingFromDto,
  throwDiaryConflict,
} from './diary-access';

@Injectable()
export class DiaryService {
  private readonly logger = new Logger(DiaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, query: DiaryListQueryDto) {
    assertDiaryRead(actor);
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.DiaryEntryWhereInput = {
      companyId,
      ...diaryProjectWhere(actor),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
              ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
            },
          }
        : {}),
    };
    if (query.projectId) {
      await this.access.getVisibleProject(actor, query.projectId);
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.diaryEntry.findMany({
        where,
        include: { photos: true },
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.diaryEntry.count({ where }),
    ]);
    return listResult(rows.map(serializeDiary), total, page, limit);
  }

  async getById(actor: AuthUser, id: string) {
    return serializeDiary(await this.loadVisible(actor, id));
  }

  async create(actor: AuthUser, dto: UpsertDiaryDto) {
    const project = await this.requireWritableProject(actor, dto.projectId);
    const date = parseDateOnly(dto.date);
    // BE-11 (F-04): offline ponavljanje mora vratiti **postojeći** zapis. Prije se
    // `localId` upisivao bez `deviceId` (i u drugom upisu, kroz sync), pa je ponovni
    // sync uvijek padao na dnevni unique kao `DIARY_CONFLICT`.
    if (typeof dto.localId === 'string' && dto.localId !== '') {
      const replay = await this.prisma.diaryEntry.findFirst({
        where: {
          companyId: project.companyId,
          localId: dto.localId,
          deviceId: typeof dto.deviceId === 'string' ? dto.deviceId : null,
        },
        include: { photos: true },
      });
      if (replay) {
        return serializeDiary(replay);
      }
    }
    try {
      const row = await this.prisma.diaryEntry.create({
        data: {
          companyId: project.companyId,
          projectId: project.id,
          date,
          ...diaryWriteData(dto),
          localId: typeof dto.localId === 'string' ? dto.localId : undefined,
          deviceId: typeof dto.deviceId === 'string' ? dto.deviceId : undefined,
        },
        include: { photos: true },
      });
      // BE-13 (B11): dnevnik je bio jedina poslovna promjena bez audita.
      await this.audit.write({
        companyId: row.companyId,
        actorId: actor.id,
        action: 'DIARY_CREATED',
        entityType: 'DiaryEntry',
        entityId: row.id,
        payload: { projectId: row.projectId, date: dto.date },
      });
      return serializeDiary(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.diaryEntry.findFirst({
          where: { companyId: project.companyId, projectId: project.id, date },
          include: { photos: true },
        });
        await this.notifyConflict(project.companyId, project.id, actor.id);
        throwDiaryConflict(
          existing ? serializeDiary(existing) : null,
          incomingFromDto(dto),
        );
      }
      throw error;
    }
  }

  async patch(actor: AuthUser, id: string, dto: PatchDiaryDto) {
    const row = await this.loadVisible(actor, id);
    assertDiaryWrite(actor);
    const project = await this.access.getVisibleProject(actor, row.projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    const updated = await this.prisma.diaryEntry.update({
      where: { id },
      data: diaryWriteData(dto),
      include: { photos: true },
    });
    await this.audit.write({
      companyId: updated.companyId,
      actorId: actor.id,
      action: 'DIARY_UPDATED',
      entityType: 'DiaryEntry',
      entityId: updated.id,
      payload: { fields: Object.keys(dto) },
    });
    return serializeDiary(updated);
  }

  async addPhoto(actor: AuthUser, id: string, dto: DiaryPhotoDto) {
    const row = await this.loadVisible(actor, id);
    assertDiaryWrite(actor);
    const project = await this.access.getVisibleProject(actor, row.projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    const path = assertStoragePath(dto.path, project.companyId);
    // BE-11 (F-11): offline sync ponovo šalje istu fotografiju (isti objekat u MinIO)
    // → vrati postojeći zapis umjesto duplikata. `path` je jedinstven po uploadu.
    const duplicate = await this.prisma.diaryPhoto.findFirst({
      where: { diaryEntryId: id, path },
    });
    if (duplicate) {
      return duplicate;
    }
    const count = await this.prisma.diaryPhoto.count({
      where: { diaryEntryId: id },
    });
    if (count >= DIARY_PHOTO_MAX) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Max 20 diary photos',
        400,
      );
    }
    // BE-11 (F-05): koordinate fotografije su išle u bazu bez provjere opsega i
    // dozvoljavale su „samo lat“ (ista klasa kao F-BE-09-04 / F-BE-10-03).
    const coords = parseOptionalLatLng(dto.lat, dto.lng);
    const photo = await this.prisma.diaryPhoto.create({
      data: {
        companyId: project.companyId,
        diaryEntryId: id,
        path,
        caption: dto.caption,
        lat: coords.lat ?? undefined,
        lng: coords.lng ?? undefined,
      },
    });
    await this.audit.write({
      companyId: photo.companyId,
      actorId: actor.id,
      action: 'DIARY_PHOTO_ADDED',
      entityType: 'DiaryPhoto',
      entityId: photo.id,
      payload: { diaryEntryId: id, path: photo.path },
    });
    return photo;
  }

  private async requireWritableProject(actor: AuthUser, projectId: string) {
    assertDiaryWrite(actor);
    const project = await this.access.getVisibleProject(actor, projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    return project;
  }

  private async loadVisible(actor: AuthUser, id: string) {
    assertDiaryRead(actor);
    const row = await this.prisma.diaryEntry.findFirst({
      where: {
        id,
        companyId: requireCompany(actor),
        ...diaryProjectWhere(actor),
      },
      include: { photos: true },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Diary entry not found', 404);
    }
    return row;
  }

  private async notifyConflict(
    companyId: string,
    projectId: string,
    actorId: string,
  ) {
    // BE-11 (F-06): notifikacija je obavještenje, ne uslov za 409 — prije je pad
    // notifikacije pretvarao `DIARY_CONFLICT` u 500.
    try {
      const users = await this.prisma.projectAssignment.findMany({
        where: { projectId },
        select: { userId: true },
      });
      for (const row of users) {
        if (row.userId === actorId) {
          continue;
        }
        await this.notifications.createForUser({
          companyId,
          userId: row.userId,
          type: 'DIARY_CONFLICT',
          title: 'Diary conflict',
          message: 'Two diary entries for the same day',
          data: { projectId },
        });
      }
    } catch (error) {
      this.logger.warn(
        `DIARY_CONFLICT notifikacija nije poslana (project ${projectId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
