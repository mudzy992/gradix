import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class DocsListQueryDto extends PaginationQueryDto {}

export class CreateCompanyDocDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  type!: string;

  @IsString()
  filePath!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class CreateWorkerDocDto extends CreateCompanyDocDto {
  @IsString()
  userId!: string;
}

export class CreateMachineDocDto extends CreateCompanyDocDto {
  @IsString()
  machineId!: string;
}

export class PatchDocDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  type?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}
