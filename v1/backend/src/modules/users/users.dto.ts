import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ROLES, type AppRole } from '../../common/rbac/roles';

export class UsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: AppRole;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLES, { each: true })
  roles!: AppRole[];

  @IsOptional()
  @IsString()
  hourlyRate?: string;

  @IsOptional()
  @IsString()
  locale?: 'bs' | 'en';
}

export class PatchUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(ROLES, { each: true })
  roles?: AppRole[];

  @IsOptional()
  @IsString()
  hourlyRate?: string;

  @IsOptional()
  @IsString()
  locale?: 'bs' | 'en';
}
