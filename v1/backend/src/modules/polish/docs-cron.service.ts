import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DOC_WARN_WINDOWS, DOCS_CRON } from '../../common/constants';
import {
  calendarDateInTz,
  readCompanyTimezone,
} from '../../common/scope/company-tz';
import { notifyRoles } from '../../common/notify/notify-roles';
import type { Role } from '../../../generated/client';

type DocRow = {
  id: string;
  companyId: string;
  type: string;
  expiresAt: Date | null;
  userId?: string;
  machineId?: string;
};

@Injectable()
export class DocsCronService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(DOCS_CRON, { disabled: Boolean(process.env.JEST_WORKER_ID) })
  async warnExpiring(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
    });
    for (const company of companies) {
      const tz = await readCompanyTimezone(this.prisma, company.id);
      const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      }).format(new Date());
      if (hour !== '08' && hour !== '8') {
        continue;
      }
      await this.scanCompany(company.id, tz);
    }
  }

  private async scanCompany(companyId: string, tz: string): Promise<void> {
    const today = calendarDateInTz(new Date(), tz);
    // BE-15 (F-08): ranije je za **svaki** dokument firma učitavala **sve** svoje
    // `DOCUMENT_EXPIRING` notifikacije i skenirala ih u memoriji (O(dokumenti ×
    // notifikacije)). Sada se postojeći ključevi učitaju jednom po firmi.
    const existing = await this.prisma.notification.findMany({
      where: { companyId, type: 'DOCUMENT_EXPIRING' },
      select: { data: true },
    });
    const notified = new Set<string>();
    for (const item of existing) {
      if (!item.data || typeof item.data !== 'object') {
        continue;
      }
      const data = item.data as Record<string, unknown>;
      if (
        typeof data.entityId === 'string' &&
        typeof data.daysLeft === 'number'
      ) {
        notified.add(`${data.entityId}:${data.daysLeft}`);
      }
    }
    const [company, worker, machine] = await Promise.all([
      this.prisma.companyDocument.findMany({
        where: { companyId, expiresAt: { not: null } },
      }),
      this.prisma.workerDocument.findMany({
        where: { companyId, expiresAt: { not: null } },
      }),
      this.prisma.machineDocument.findMany({
        where: { companyId, expiresAt: { not: null } },
      }),
    ]);
    for (const row of company) {
      await this.maybeNotify(
        row,
        'company',
        today,
        ['ADMIN', 'SUPER_ADMIN'],
        [],
        notified,
      );
    }
    for (const row of worker) {
      await this.maybeNotify(
        row,
        'worker',
        today,
        ['ADMIN', 'SUPER_ADMIN'],
        row.userId ? [row.userId] : [],
        notified,
      );
    }
    for (const row of machine) {
      await this.maybeNotify(
        row,
        'machine',
        today,
        ['ADMIN', 'SUPER_ADMIN', 'MECHANIC'],
        [],
        notified,
      );
    }
  }

  private async maybeNotify(
    row: DocRow,
    entityType: string,
    today: string,
    roles: Role[],
    extraUserIds: string[] = [],
    notified: Set<string>,
  ): Promise<void> {
    if (!row.expiresAt) {
      return;
    }
    const expires = row.expiresAt.toISOString().slice(0, 10);
    const daysLeft = diffDays(today, expires);
    const window = warnWindow(daysLeft);
    if (!window) {
      return;
    }
    const key = `${row.id}:${window}`;
    if (notified.has(key)) {
      return;
    }
    notified.add(key);
    await notifyRoles({
      prisma: this.prisma,
      notifications: this.notifications,
      companyId: row.companyId,
      roles,
      extraUserIds,
      type: 'DOCUMENT_EXPIRING',
      title: 'Document expiring',
      message: `${row.type} expires in ${window} days`,
      data: { entityType, entityId: row.id, daysLeft: window },
    });
  }
}

function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

function warnWindow(daysLeft: number): number | null {
  if (daysLeft <= 0) {
    return null;
  }
  const windows = [...DOC_WARN_WINDOWS].sort((a, b) => a - b);
  for (const window of windows) {
    if (daysLeft <= window) {
      return window;
    }
  }
  return null;
}
