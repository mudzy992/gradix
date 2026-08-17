import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class PublicProjectsQueryDto extends PaginationQueryDto {}

export class CreatePublicAssetDto {
  @IsIn(['LOGO', 'COVER'])
  kind!: 'LOGO' | 'COVER';

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class PatchProjectPublicDto {
  @IsBoolean()
  isPublic!: boolean;

  @IsOptional()
  @IsString()
  coverAssetId?: string;
}
