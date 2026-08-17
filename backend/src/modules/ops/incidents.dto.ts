import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class IncidentListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateIncidentDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  severity!: 'LOW' | 'MEDIUM' | 'HIGH';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsString()
  lat?: string;

  @IsOptional()
  @IsString()
  lng?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];
}

export class PatchIncidentDto {
  @IsIn(['ACK', 'CLOSED'])
  status!: 'ACK' | 'CLOSED';
}
