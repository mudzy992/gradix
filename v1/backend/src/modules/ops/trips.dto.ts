import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class TripListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;
}

export class CreateTripDto {
  @IsString()
  projectId!: string;

  @IsString()
  machineId!: string;

  @IsString()
  materialId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  originText!: string;

  @IsOptional()
  @IsString()
  originLat?: string;

  @IsOptional()
  @IsString()
  originLng?: string;

  @IsOptional()
  @IsString()
  destDepotId?: string;

  @IsOptional()
  @IsString()
  destLat?: string;

  @IsOptional()
  @IsString()
  destLng?: string;

  @IsOptional()
  @IsString()
  weighTicketPath?: string;

  @IsOptional()
  @IsString()
  weighQty?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CompleteTripDto {
  @IsOptional()
  @IsString()
  destLat?: string;

  @IsOptional()
  @IsString()
  destLng?: string;
}
