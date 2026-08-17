import { IsOptional, IsString } from 'class-validator';

export class PingLocationDto {
  @IsString()
  lat!: string;

  @IsString()
  lng!: string;

  @IsOptional()
  @IsString()
  accuracyM?: string;
}

export class GeofenceCheckQueryDto {
  @IsString()
  lat!: string;

  @IsString()
  lng!: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
