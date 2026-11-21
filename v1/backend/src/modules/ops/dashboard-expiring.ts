import { PrismaService } from '../prisma/prisma.service';
import { DOC_WARN_WINDOWS } from '../../common/constants';
import {
  calendarDateInTz,
  readCompanyTimezone,
} from '../../common/scope/company-tz';
import type { ExpiringDoc } from './dashboard-types';

/**
 * BE-12 (F-06): koliko dana **unazad** se prikazuju istekli dokumenti.
 * Prije su istekli dokumenti (`daysLeft < 0`) bili filtrirani iz odgovora, pa je
 * dokument istekao juče tiho nestajao sa dashboarda — upravo kada je najvažniji.
 */
export const EXPIRED_LOOKBACK_DAYS = 90;

/** Gornja granica liste, da firma sa hiljadama dokumenata ne vuče sve u dashboard. */
export const EXPIRING_MAX_ITEMS = 100;

export async function loadExpiring(
  prisma: PrismaService,
  companyId: string,
): Promise<ExpiringDoc[]> {
  const tz = await readCompanyTimezone(prisma, companyId);
  const today = calendarDateInTz(new Date(), tz);
  const [company, worker, machine] = await Promise.all([
    prisma.companyDocument.findMany({
      where: { companyId, expiresAt: { not: null } },
    }),
    prisma.workerDocument.findMany({
      where: { companyId, expiresAt: { not: null } },
    }),
    prisma.machineDocument.findMany({
      where: { companyId, expiresAt: { not: null } },
    }),
  ]);
  const items: ExpiringDoc[] = [];
  const max = Math.max(...DOC_WARN_WINDOWS);
  const push = (
    entityType: string,
    id: string,
    type: string,
    expiresAt: Date | null,
  ): void => {
    if (!expiresAt) {
      return;
    }
    const daysLeft = Math.round(
      (Date.parse(expiresAt.toISOString().slice(0, 10) + 'T00:00:00.000Z') -
        Date.parse(`${today}T00:00:00.000Z`)) /
        86_400_000,
    );
    // BE-12 (F-06): istekli dokumenti ostaju vidljivi (negativan `daysLeft`), do
    // `EXPIRED_LOOKBACK_DAYS` unazad; budući samo unutar najširnog prozora upozorenja.
    if (daysLeft < -EXPIRED_LOOKBACK_DAYS || daysLeft > max) {
      return;
    }
    items.push({ entityType, entityId: id, type, daysLeft });
  };
  for (const row of company) {
    push('company', row.id, row.type, row.expiresAt);
  }
  for (const row of worker) {
    push('worker', row.id, row.type, row.expiresAt);
  }
  for (const row of machine) {
    push('machine', row.id, row.type, row.expiresAt);
  }
  return items
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, EXPIRING_MAX_ITEMS);
}
