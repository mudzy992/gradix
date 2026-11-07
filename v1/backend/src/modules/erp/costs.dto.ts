import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const COST_CATEGORIES = [
  'FUEL',
  'SERVICE',
  'MATERIAL',
  'LABOR',
  'OTHER',
] as const;
export const COST_SOURCES = ['MANUAL', 'FUEL', 'SERVICE', 'PAYROLL'] as const;

function toInt(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return Number(value);
}

export class CostQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(COST_SOURCES)
  source?: (typeof COST_SOURCES)[number];
}

export class CreateCostDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  @IsString()
  amount!: string;

  @IsIn(COST_CATEGORIES)
  category!: (typeof COST_CATEGORIES)[number];

  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsIn(COST_SOURCES)
  source?: (typeof COST_SOURCES)[number];

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class FromPayrollDto {
  @Transform(({ value }) => toInt(value))
  @IsInt()
  year!: number;

  @Transform(({ value }) => toInt(value))
  @IsInt()
  month!: number;

  @IsOptional()
  @IsString()
  projectId?: string;
}
