import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MACHINE_TYPES } from '../ops/machines.dto';

export const SERVICE_STATUSES = [
  'PLANNED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export class TemplateListQueryDto extends PaginationQueryDto {}

export class CreateTemplateDto {
  @IsIn(MACHINE_TYPES)
  machineType!: (typeof MACHINE_TYPES)[number];

  @IsInt()
  @Min(1)
  intervalHours!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class PatchTemplateDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalHours?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;
}

export class ServiceListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  machineId?: string;

  @IsOptional()
  @IsIn(SERVICE_STATUSES)
  status?: (typeof SERVICE_STATUSES)[number];
}

export class CreateServiceDto {
  @IsString()
  machineId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class CompleteServiceDto {
  @IsOptional()
  @IsString()
  totalCost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}
