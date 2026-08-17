import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TimerForceCloseService } from './timer-force-close.service';
import { TIMER_CRON } from '../../common/constants';
import { readMaxOpenHours } from './timer-settings';

@Injectable()
export class TimerCronService {
  private readonly logger = new Logger(TimerCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly closer: TimerForceCloseService,
  ) {}

  @Cron(TIMER_CRON, { disabled: Boolean(process.env.JEST_WORKER_ID) })
  async closeStale(): Promise<void> {
    const open = await this.prisma.timerSession.findMany({ where: { closedAt: null } });
    for (const session of open) {
      const hours = await readMaxOpenHours(this.prisma, session.companyId);
      const ageMs = Date.now() - session.startedAt.getTime();
      if (ageMs >= hours * 60 * 60 * 1000) {
        await this.closer.closeSession(session, session.userId, 'auto');
        this.logger.log(`auto-closed timer ${session.id}`);
      }
    }
  }

}
