import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AMENDMENT_REASON_MIN } from '../../common/constants';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateAmendmentDto {
  @IsIn(['TIMER', 'TRIP', 'FUEL'])
  entityType!: 'TIMER' | 'TRIP' | 'FUEL';

  @IsString()
  entityId!: string;

  @IsString()
  field!: string;

  @IsString()
  newValue!: string;

  @IsString()
  @MinLength(AMENDMENT_REASON_MIN)
  reason!: string;
}

export class AmendmentListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}
