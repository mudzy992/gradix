import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const MACHINE_TYPES = [
  'TRUCK',
  'EXCAVATOR',
  'LOADER',
  'GRADER',
  'ROLLER',
  'PAVER',
  'DUMPER',
  'COMPRESSOR',
  'OTHER',
] as const;

export class MachineListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class CreateMachineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsIn(MACHINE_TYPES)
  type!: (typeof MACHINE_TYPES)[number];
}

export class PatchMachineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;
}

export class AssignMachineDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class MachineLocationDto {
  @IsString()
  lat!: string;

  @IsString()
  lng!: string;
}
