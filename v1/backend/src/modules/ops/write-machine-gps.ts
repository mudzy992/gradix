import { HttpException, HttpStatus } from '@nestjs/common';
import { GpsSource, Prisma } from '../../../generated/client';
import { MACHINE_GPS_TTL_MS } from '../../common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export async function writeMachineGps(input: {
  prisma: PrismaService;
  realtime: RealtimeService;
  companyId: string;
  machineId: string;
  lat: Prisma.Decimal;
  lng: Prisma.Decimal;
  source: GpsSource;
  throttle: boolean;
  lastGpsAt: Date | null;
}): Promise<Date> {
  const now = new Date();
  if (
    input.throttle &&
    input.lastGpsAt &&
    now.getTime() - input.lastGpsAt.getTime() < MACHINE_GPS_TTL_MS
  ) {
    throw new HttpException(
      'Too many GPS updates',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  // BE-09 (F-01): zapis tačke i pozicija mašine su jedna transakcija — ranije je pad
  // između njih ostavljao tačku u istoriji, a `lastLat/lastGpsAt` na starom mjestu.
  await input.prisma.$transaction(async (tx) => {
    await tx.gpsRecord.create({
      data: {
        companyId: input.companyId,
        machineId: input.machineId,
        lat: input.lat,
        lng: input.lng,
        recordedAt: now,
        source: input.source,
      },
    });
    await tx.machine.update({
      where: { id: input.machineId },
      data: {
        lastLat: input.lat,
        lastLng: input.lng,
        lastGpsAt: now,
        lastGpsSource: input.source,
      },
    });
  });
  input.realtime.emitCompany(input.companyId, 'machine:location', {
    id: input.machineId,
  });
  return now;
}
