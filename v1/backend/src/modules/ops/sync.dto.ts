import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { SYNC_PUSH_MAX_ITEMS } from '../../common/constants';

export const SYNC_ITEM_TYPES = [
  'TIMER',
  'TRIP',
  'FUEL',
  'DIARY',
  'PHOTO',
] as const;
export type SyncItemType = (typeof SYNC_ITEM_TYPES)[number];

export class SyncPushItemDto {
  @IsIn(SYNC_ITEM_TYPES)
  type!: SyncItemType;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  localId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(120)
  deviceId!: string;

  @IsOptional()
  @IsString()
  action?: string;

  @Allow()
  @IsObject()
  payload!: Record<string, unknown>;
}

export class SyncPushDto {
  @IsArray()
  // BE-17 (F-01): bez gornje granice je jedan zahtjev mogao nositi neograničen broj
  // itema — klijent šalje u serijama, pa je 200 i više nego dovoljno za jedan batch.
  @ArrayMaxSize(SYNC_PUSH_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SyncPushItemDto)
  items!: SyncPushItemDto[];
}

export class SyncPullDto {
  @IsOptional()
  @IsString()
  since?: string;
}

export type SyncItemOk = {
  localId: string;
  type: SyncItemType;
  ok: true;
  serverId: string;
};

export type SyncItemErr = {
  localId: string;
  type: SyncItemType;
  ok: false;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type SyncItemResult = SyncItemOk | SyncItemErr;
