import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TASK_STATUSES, type TaskStatusValue } from './task-statuses';

export class TaskListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatusValue;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class CreateTaskDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  phaseId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsString()
  plannedStart?: string;

  @IsOptional()
  @IsString()
  plannedEnd?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}

export class PatchTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsString()
  plannedStart?: string;

  @IsOptional()
  @IsString()
  plannedEnd?: string;

  @IsOptional()
  @IsString()
  phaseId?: string | null;
}

export class AssigneeDto {
  @IsString()
  userId!: string;
}

export class AttachmentDto {
  @IsString()
  path!: string;

  @IsString()
  @MinLength(1)
  fileName!: string;
}

export class DependencyDto {
  @IsString()
  fromId!: string;

  @IsString()
  toId!: string;
}
