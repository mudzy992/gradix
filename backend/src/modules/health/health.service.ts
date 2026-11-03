import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HEALTH_PROBE_TIMEOUT_MS } from '../../common/constants';

export type HealthStatus = 'ok' | 'error';

export interface ReadinessResponse {
  status: HealthStatus;
  uptimeSeconds: number;
  checks: {
    postgres: { status: HealthStatus; latencyMs: number; error?: string };
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * BE-18 (F-01): liveness NE dira bazu. Docker/Coolify healthcheck je vezan na ovaj
   * endpoint, pa bi provjera baze ovdje pretvarala pad baze u restart-loop aplikacije
   * koja je živa i može se sama oporaviti kad baza vrati.
   */
  getLiveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * BE-18 (F-02, F-03): readiness provjerava bazu sa **ograničenim** čekanjem i nikad ne
   * baca grešku — vraća `status: 'error'` (kontroler to prevodi u `503`). Detalj greške
   * se ne vraća klijentu (može sadržavati host/kredencijale).
   */
  async getReadiness(): Promise<ReadinessResponse> {
    const startedAt = Date.now();
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        checks: {
          postgres: { status: 'ok', latencyMs: Date.now() - startedAt },
        },
      };
    } catch (error) {
      this.logger.warn(
        `Readiness: postgres nije dostupan (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      return {
        status: 'error',
        uptimeSeconds: Math.round(process.uptime()),
        checks: {
          postgres: {
            status: 'error',
            latencyMs: Date.now() - startedAt,
            error: 'unreachable',
          },
        },
      };
    }
  }

  private async withTimeout(query: Promise<unknown>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('health probe timeout')),
        HEALTH_PROBE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([query, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
