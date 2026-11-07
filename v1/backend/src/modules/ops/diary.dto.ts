import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class DiaryListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class UpsertDiaryDto {
  @IsString()
  projectId!: string;

  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  weather?: string;

  @IsOptional()
  @IsString()
  tempMin?: string;

  @IsOptional()
  @IsString()
  tempMax?: string;

  @IsOptional()
  @IsString()
  workDescription?: string;

  @IsOptional()
  @IsString()
  problemsNoted?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  workersCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  localId?: string;

  /** BE-11 (F-04): offline identitet uređaja — zajedno sa `localId` daje idempotentno ponavljanje. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;
}

export class PatchDiaryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  weather?: string;

  @IsOptional()
  @IsString()
  tempMin?: string;

  @IsOptional()
  @IsString()
  tempMax?: string;

  @IsOptional()
  @IsString()
  workDescription?: string;

  @IsOptional()
  @IsString()
  problemsNoted?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  workersCount?: number;
}

export class DiaryPhotoDto {
  @IsString()
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string;

  @IsOptional()
  @IsString()
  lat?: string;

  @IsOptional()
  @IsString()
  lng?: string;
}

export class ResolveConflictDto {
  @IsString()
  entityType!: string;

  @IsString()
  projectId!: string;

  @IsString()
  date!: string;

  @IsString()
  choice!: string;

  @IsOptional()
  incoming?: UpsertDiaryDto;

  @IsOptional()
  @IsString()
  @MinLength(1)
  mergeWork?: string;

  @IsOptional()
  @IsString()
  mergeProblems?: string;
}
