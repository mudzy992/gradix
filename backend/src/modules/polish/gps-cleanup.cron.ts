import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { GPS_CLEANUP_CRON, GPS_RETENTION_DAYS } from '../../common/constants';

@Injectable()
export class GpsCleanupCronService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(GPS_CLEANUP_CRON, { disabled: Boolean(process.env.JEST_WORKER_ID) })
  async purge(): Promise<void> {
    const cutoff = new Date(Date.now() - GPS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.gpsRecord.deleteMany({ where: { recordedAt: { lt: cutoff } } });
  }
}
