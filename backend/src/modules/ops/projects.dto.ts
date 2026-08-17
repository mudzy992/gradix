import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ProjectListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  archived?: string;
}

export class CreateProjectDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  locality?: string;

  @IsOptional()
  @IsString()
  lat?: string;

  @IsOptional()
  @IsString()
  lng?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  geofenceRadius?: number;

  @IsOptional()
  @IsString()
  plannedBudget?: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsString()
  plannedStart?: string;

  @IsOptional()
  @IsString()
  plannedEnd?: string;
}

export class PatchProjectDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  locality?: string;

  @IsOptional()
  @IsString()
  lat?: string;

  @IsOptional()
  @IsString()
  lng?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  geofenceRadius?: number;

  @IsOptional()
  @IsString()
  plannedBudget?: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsString()
  plannedStart?: string;

  @IsOptional()
  @IsString()
  plannedEnd?: string;
}

export class PatchProjectStatusDto {
  @IsIn(['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'])
  status!: 'PLANNING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
}

export class CreatePhaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  plannedStart?: string;

  @IsOptional()
  @IsString()
  plannedEnd?: string;
}

export class PatchPhaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  plannedStart?: string;

  @IsOptional()
  @IsString()
  plannedEnd?: string;
}

export class CreateAssignmentDto {
  @IsString()
  userId!: string;

  @IsIn(['PM', 'SS', 'WORKER', 'DRIVER', 'OP'])
  role!: 'PM' | 'SS' | 'WORKER' | 'DRIVER' | 'OP';
}

export class CreateDocumentDto {
  @IsString()
  path!: string;

  @IsString()
  @MinLength(1)
  fileName!: string;
}
