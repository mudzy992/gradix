import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const PARTNER_TYPES = ['CLIENT', 'SUPPLIER'] as const;

export class PartnerQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PARTNER_TYPES)
  type?: (typeof PARTNER_TYPES)[number];
}

export class CreatePartnerDto {
  @IsIn(PARTNER_TYPES)
  type!: (typeof PARTNER_TYPES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PatchPartnerDto {
  @IsOptional()
  @IsIn(PARTNER_TYPES)
  type?: (typeof PARTNER_TYPES)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
