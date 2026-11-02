import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { parseDateOnly } from '../../common/scope/company-tz';
import { ProjectAccessService } from './project-access.service';
import { ResolveConflictDto } from './diary.dto';
import { serializeDiary } from './serialize-diary';
import { assertDiaryWrite, diaryWriteData } from './diary-access';

@Injectable()
export class DiaryConflictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async resolve(actor: AuthUser, dto: ResolveConflictDto) {
    assertDiaryWrite(actor);
    if (dto.entityType !== 'DIARY') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Unsupported entityType',
        400,
      );
    }
    const project = await this.access.getVisibleProject(actor, dto.projectId);
    await this.access.assertScopedWrite(actor, project);
    const date = parseDateOnly(dto.date);
    const existing = await this.prisma.diaryEntry.findFirst({
      where: { companyId: project.companyId, projectId: project.id, date },
      include: { photos: true },
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Diary entry not found', 404);
    }
    if (dto.choice === 'A') {
      return serializeDiary(existing);
    }
    if (dto.choice === 'B') {
      if (!dto.incoming) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'incoming required for B',
          400,
        );
      }
      return serializeDiary(
        await this.prisma.diaryEntry.update({
          where: { id: existing.id },
          data: diaryWriteData(dto.incoming),
          include: { photos: true },
        }),
      );
    }
    if (dto.choice !== 'MERGE') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'choice must be A, B, or MERGE',
        400,
      );
    }
    return serializeDiary(
      await this.prisma.diaryEntry.update({
        where: { id: existing.id },
        data: {
          workDescription:
            dto.mergeWork ??
            this.mergeText(
              existing.workDescription,
              dto.incoming?.workDescription,
            ),
          problemsNoted:
            dto.mergeProblems ??
            this.mergeText(existing.problemsNoted, dto.incoming?.problemsNoted),
        },
        include: { photos: true },
      }),
    );
  }

  private mergeText(left?: string | null, right?: string | null): string {
    return [left, right].filter(Boolean).join('\n\n');
  }
}
