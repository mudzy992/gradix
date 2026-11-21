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

  // BE-11 (F-07): status je bio slobodan string koji se cast-ovao u Prisma enum —
  // `?status=x` je padao na Prisma validaciji (500) umjesto 400.
  @IsOptional()
  @IsIn(['OPEN', 'ACK', 'CLOSED'])
  status?: 'OPEN' | 'ACK' | 'CLOSED';
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
