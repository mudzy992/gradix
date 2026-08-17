import { PrismaService } from '../prisma/prisma.service';
import { DOC_WARN_WINDOWS } from '../../common/constants';
import { calendarDateInTz, readCompanyTimezone } from '../../common/scope/company-tz';
import type { ExpiringDoc } from './dashboard-types';

export async function loadExpiring(
  prisma: PrismaService,
  companyId: string,
): Promise<ExpiringDoc[]> {
  const tz = await readCompanyTimezone(prisma, companyId);
  const today = calendarDateInTz(new Date(), tz);
  const [company, worker, machine] = await Promise.all([
    prisma.companyDocument.findMany({ where: { companyId, expiresAt: { not: null } } }),
    prisma.workerDocument.findMany({ where: { companyId, expiresAt: { not: null } } }),
    prisma.machineDocument.findMany({ where: { companyId, expiresAt: { not: null } } }),
  ]);
  const items: ExpiringDoc[] = [];
  const push = (entityType: string, id: string, type: string, expiresAt: Date | null): void => {
    if (!expiresAt) {
      return;
    }
    const daysLeft = Math.round(
      (Date.parse(expiresAt.toISOString().slice(0, 10) + 'T00:00:00.000Z') -
        Date.parse(`${today}T00:00:00.000Z`)) /
        86_400_000,
    );
    const max = Math.max(...DOC_WARN_WINDOWS);
    if (daysLeft < 0 || daysLeft > max) {
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
  return items.sort((a, b) => a.daysLeft - b.daysLeft);
}
