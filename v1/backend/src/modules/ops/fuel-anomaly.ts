import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FUEL_ANOMALY_PCT } from '../../common/constants';
import { notifyRoles } from '../../common/notify/notify-roles';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function maybeNotifyFuelAnomaly(input: {
  prisma: PrismaService;
  notifications: NotificationsService;
  companyId: string;
  machineId: string;
  liters: Prisma.Decimal;
  fuelId: string;
}): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS);
  const avg = await input.prisma.fuelEntry.aggregate({
    where: {
      companyId: input.companyId,
      machineId: input.machineId,
      id: { not: input.fuelId },
      createdAt: { gte: since },
    },
    _avg: { liters: true },
  });
  const baseline = avg._avg.liters;
  if (!baseline || baseline.lte(0)) {
    return;
  }
  const threshold = baseline.mul(1 + FUEL_ANOMALY_PCT / 100);
  if (input.liters.lte(threshold)) {
    return;
  }
  await notifyRoles({
    prisma: input.prisma,
    notifications: input.notifications,
    companyId: input.companyId,
    roles: ['ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'],
    type: 'FUEL_ANOMALY',
    title: 'Fuel anomaly',
    message: 'Fill volume exceeds 30-day average by more than 25%',
    data: { fuelId: input.fuelId, machineId: input.machineId },
  });
}
