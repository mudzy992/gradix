import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const WAREHOUSE_TYPES = ['SITE', 'YARD', 'CISTERN'] as const;

export class WarehouseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(WAREHOUSE_TYPES)
  type?: (typeof WAREHOUSE_TYPES)[number];
}

export class CreateWarehouseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(WAREHOUSE_TYPES)
  type!: (typeof WAREHOUSE_TYPES)[number];

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class CreateMovementDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  @IsString()
  warehouseId!: string;

  @IsString()
  materialId!: string;

  @IsString()
  qty!: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class ApplyStockDto {
  @IsString()
  warehouseId!: string;

  @IsString()
  materialId!: string;
}
