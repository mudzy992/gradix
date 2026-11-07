import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const TENDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'WON',
  'LOST',
  'WITHDRAWN',
] as const;

export class TenderListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TENDER_STATUSES)
  status?: (typeof TENDER_STATUSES)[number];
}

export class CreateTenderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  client!: string;

  @IsOptional()
  @IsString()
  submittedValue?: string;

  @IsOptional()
  @IsString()
  submittedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class PatchTenderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  client?: string;

  @IsOptional()
  @IsString()
  submittedValue?: string;

  @IsOptional()
  @IsIn(TENDER_STATUSES)
  status?: (typeof TENDER_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class TenderAttachmentDto {
  @IsString()
  path!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName!: string;
}
