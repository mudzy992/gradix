import { Controller, Get } from '@nestjs/common';
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
}
