import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateQuantityDto {
  @IsOptional()
  @IsString()
  phaseId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(['M3', 'T', 'M', 'M2', 'PCS', 'H'])
  unit!: 'M3' | 'T' | 'M' | 'M2' | 'PCS' | 'H';

  @IsString()
  plannedQty!: string;

  @IsOptional()
  @IsString()
  executedQty?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class PatchQuantityDto {
  @IsOptional()
  @IsString()
  phaseId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['M3', 'T', 'M', 'M2', 'PCS', 'H'])
  unit?: 'M3' | 'T' | 'M' | 'M2' | 'PCS' | 'H';

  @IsOptional()
  @IsString()
  plannedQty?: string;

  @IsOptional()
  @IsString()
  executedQty?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
