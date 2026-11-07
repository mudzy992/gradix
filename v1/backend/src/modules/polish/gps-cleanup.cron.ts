import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  GPS_CLEANUP_BATCH,
  GPS_CLEANUP_CRON,
  GPS_RETENTION_DAYS,
} from '../../common/constants';

@Injectable()
export class GpsCleanupCronService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(GPS_CLEANUP_CRON, { disabled: Boolean(process.env.JEST_WORKER_ID) })
  async purge(): Promise<void> {
    const cutoff = new Date(
      Date.now() - GPS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    // BE-15 (F-11): brisanje svega u jednom `deleteMany` drži dugacku transakciju i
    // zaključava tabelu koju GPS pingovi stalno pune. Briše se u serijama.
    for (;;) {
      const batch = await this.prisma.gpsRecord.findMany({
        where: { recordedAt: { lt: cutoff } },
        select: { id: true },
        take: GPS_CLEANUP_BATCH,
      });
      if (batch.length === 0) {
        return;
      }
      const deleted = await this.prisma.gpsRecord.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      if (deleted.count < batch.length) {
        return;
      }
    }
  }
}
