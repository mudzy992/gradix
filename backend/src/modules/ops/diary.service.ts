import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { DIARY_PHOTO_MAX } from '../../common/constants';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { assertStoragePath } from '../../common/utils/storage-path';
import { parseDecimal } from '../../common/utils/decimal-input';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationsService,
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
    try {
      const row = await this.prisma.diaryEntry.create({
        data: {
          companyId: project.companyId,
          projectId: project.id,
          date,
          ...diaryWriteData(dto),
          localId: typeof dto.localId === 'string' ? dto.localId : undefined,
        },
        include: { photos: true },
      });
      return serializeDiary(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.diaryEntry.findFirst({
          where: { companyId: project.companyId, projectId: project.id, date },
          include: { photos: true },
        });
        await this.notifyConflict(project.companyId, project.id, actor.id);
        throwDiaryConflict(existing ? serializeDiary(existing) : null, incomingFromDto(dto));
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
    return serializeDiary(updated);
  }

  async addPhoto(actor: AuthUser, id: string, dto: DiaryPhotoDto) {
    const row = await this.loadVisible(actor, id);
    assertDiaryWrite(actor);
    const project = await this.access.getVisibleProject(actor, row.projectId);
    await this.access.assertScopedWrite(actor, project);
    assertProjectWritable(project);
    const count = await this.prisma.diaryPhoto.count({ where: { diaryEntryId: id } });
    if (count >= DIARY_PHOTO_MAX) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Max 20 diary photos', 400);
    }
    const path = assertStoragePath(dto.path, project.companyId);
    const photo = await this.prisma.diaryPhoto.create({
      data: {
        companyId: project.companyId,
        diaryEntryId: id,
        path,
        caption: dto.caption,
        lat: dto.lat ? parseDecimal(dto.lat, 'lat') : undefined,
        lng: dto.lng ? parseDecimal(dto.lng, 'lng') : undefined,
      },
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
      where: { id, companyId: requireCompany(actor), ...diaryProjectWhere(actor) },
      include: { photos: true },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Diary entry not found', 404);
    }
    return row;
  }

  private async notifyConflict(companyId: string, projectId: string, actorId: string) {
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
  }
}
