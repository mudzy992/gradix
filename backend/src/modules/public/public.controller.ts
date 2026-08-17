import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PUBLIC_GET_LIMIT, PUBLIC_GET_TTL_MS } from '../../common/constants';
import { PublicService } from './public.service';
import { PublicProjectsQueryDto } from './public.dto';

const PUBLIC_GET = { default: { limit: PUBLIC_GET_LIMIT, ttl: PUBLIC_GET_TTL_MS } };

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicSite: PublicService) {}

  @Get('assets/:id')
  @SkipEnvelope()
  @Throttle(PUBLIC_GET)
  streamAsset(@Param('id') id: string, @Res() response: Response) {
    return this.publicSite.streamAsset(id, response);
  }

  @Get(':slug/projects')
  @Throttle(PUBLIC_GET)
  listProjects(@Param('slug') slug: string, @Query() query: PublicProjectsQueryDto) {
    return this.publicSite.listProjects(slug, query.page, query.limit);
  }

  @Get(':slug')
  @Throttle(PUBLIC_GET)
  getBySlug(@Param('slug') slug: string) {
    return this.publicSite.getBySlug(slug);
  }
}
