import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AMENDMENT_REASON_MIN } from '../../common/constants';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** BE-07 — zatvorena lista entiteta koje je moguće ispraviti. */
export const AMENDMENT_ENTITIES = ['TIMER', 'TRIP', 'FUEL'] as const;
export type AmendmentEntity = (typeof AMENDMENT_ENTITIES)[number];

export class CreateAmendmentDto {
  @IsIn(AMENDMENT_ENTITIES)
  entityType!: AmendmentEntity;

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
  @IsIn(AMENDMENT_ENTITIES)
  entityType?: AmendmentEntity;

  @IsOptional()
  @IsString()
  entityId?: string;
}
