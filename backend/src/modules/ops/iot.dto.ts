import { IsString } from 'class-validator';

export class IotGpsDto {
  @IsString()
  lat!: string;

  @IsString()
  lng!: string;
}
