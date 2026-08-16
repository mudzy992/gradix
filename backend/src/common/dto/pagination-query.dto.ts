import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

function toInt(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return Number(value);
}

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => toInt(value))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => toInt(value))
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  q?: string;
}
