import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { HealthService } from './health.service';

/**
 * BE-18: health rute su **infrastrukturni ugovor**, ne API resurs — zato `@SkipEnvelope`
 * (orchestrator/monitor čita `status`, ne `data.status`) i zato su `@Public`.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: proces živi. Docker `HEALTHCHECK` i Coolify koriste ovu rutu. */
  @Public()
  @SkipEnvelope()
  @Get()
  getHealth() {
    return this.healthService.getLiveness();
  }

  /** Readiness: zavisnosti (Postgres) dostupne; `503` kad nisu. */
  @Public()
  @SkipEnvelope()
  @Get('ready')
  async getReady(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.getReadiness();
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
