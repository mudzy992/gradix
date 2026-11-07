import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { HealthService } from './health.service';

/**
 * INF-05: readiness je **zasebna ruta** `/api/ready` (plan §4.3) — pokriva Postgres, MinIO i
 * stanje migracija. `GET /api/health` ostaje liveness (BE-18) i na njemu je Docker healthcheck.
 * Kao i `/api/health`, ruta je javna i bez envelope-a (ravan JSON za orchestration/monitoring).
 */
@Controller('ready')
export class ReadyController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @SkipEnvelope()
  @Get()
  async getReady(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.getReadiness();
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
