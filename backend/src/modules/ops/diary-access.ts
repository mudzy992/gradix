import { Prisma } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';
import { parseDecimal } from '../../common/utils/decimal-input';
import { UpsertDiaryDto } from './diary.dto';

export type DiaryFields = {
  weather?: string;
  tempMin?: string;
  tempMax?: string;
  workDescription?: string;
  problemsNoted?: string;
  workersCount?: number;
};

export function canWriteDiary(actor: AuthUser): boolean {
  return actor.permissions.includes('diary.write');
}

export function canReadDiary(actor: AuthUser): boolean {
  return actor.permissions.includes('diary.read') || canWriteDiary(actor);
}

export function assertDiaryRead(actor: AuthUser): void {
  if (!canReadDiary(actor)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Diary read not allowed', 403);
  }
}

export function assertDiaryWrite(actor: AuthUser): void {
  if (!canWriteDiary(actor)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Diary write not allowed', 403);
  }
}

export function diaryProjectWhere(
  actor: AuthUser,
): Prisma.DiaryEntryWhereInput {
  if (
    isCompanyWide(actor) ||
    hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')
  ) {
    if (isCompanyWide(actor)) {
      return {};
    }
    return { project: { assignments: { some: { userId: actor.id } } } };
  }
  throw new AppError(ERROR_CODES.FORBIDDEN, 'Diary not allowed', 403);
}

export function throwDiaryConflict(
  existing: unknown,
  incoming: unknown,
): never {
  throw new AppError(
    ERROR_CODES.DIARY_CONFLICT,
    'Diary already exists for this day',
    409,
    {
      conflictData: { entityType: 'DIARY', existing, incoming },
    },
  );
}

/**
 * BE-11 (F-03): `tempMin`/`tempMax` su stizali kao goli string u `Decimal(4,1)` kolonu —
 * `'abc'` je padao na Prisma grešci (500), a `'9999'` je tiho zaokruživan. Sada 400.
 */
export function parseDiaryTemp(
  raw: string | undefined,
  field: string,
): Prisma.Decimal | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const value = parseDecimal(raw, field);
  if (value.lt(-100) || value.gt(100)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be between -100 and 100`,
      400,
    );
  }
  return value;
}

export function diaryWriteData(dto: DiaryFields) {
  return {
    weather: dto.weather,
    tempMin: parseDiaryTemp(dto.tempMin, 'tempMin'),
    tempMax: parseDiaryTemp(dto.tempMax, 'tempMax'),
    workDescription: dto.workDescription,
    problemsNoted: dto.problemsNoted,
    workersCount: dto.workersCount,
  };
}

export function incomingFromDto(dto: UpsertDiaryDto) {
  return {
    projectId: dto.projectId,
    date: dto.date,
    weather: dto.weather ?? null,
    tempMin: dto.tempMin ?? null,
    tempMax: dto.tempMax ?? null,
    workDescription: dto.workDescription ?? null,
    problemsNoted: dto.problemsNoted ?? null,
    workersCount: dto.workersCount ?? null,
  };
}
