import { IsString } from 'class-validator';

export class PublicSettingsQueryDto {
  @IsString()
  slug!: string;
}
