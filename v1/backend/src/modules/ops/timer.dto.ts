import { IsOptional, IsString } from 'class-validator';

export class StartTimerDto {
  @IsString()
  taskId!: string;

  @IsOptional()
  @IsString()
  lat?: string;

  @IsOptional()
  @IsString()
  lng?: string;

  @IsOptional()
  startedAt?: unknown;

  @IsOptional()
  durationMinutes?: unknown;

  @IsOptional()
  @IsString()
  machineId?: string;
}

export class TimerListQueryDto {
  @IsString()
  projectId!: string;
}
