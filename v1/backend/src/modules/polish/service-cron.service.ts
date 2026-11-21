import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_CRON, SERVICE_DUE_HOURS } from '../../common/constants';
import { notifyRoles } from '../../common/notify/notify-roles';

@Injectable()
export class ServiceCronService {
  private readonly logger = new Logger(ServiceCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(SERVICE_CRON, { disabled: Boolean(process.env.JEST_WORKER_ID) })
  async scheduleDue(): Promise<void> {
    const templates = await this.prisma.serviceTemplate.findMany();
    for (const template of templates) {
      const machines = await this.prisma.machine.findMany({
        where: {
          companyId: template.companyId,
          type: template.machineType,
          status: { not: 'DECOMMISSIONED' },
        },
      });
      for (const machine of machines) {
        await this.maybeSchedule(template, machine);
      }
    }
  }

  private async maybeSchedule(
    template: {
      id: string;
      companyId: string;
      intervalHours: number;
      title: string;
    },
    machine: { id: string; currentWorkingHours: Prisma.Decimal },
  ): Promise<void> {
    const last = await this.prisma.serviceRecord.findFirst({
      where: {
        machineId: machine.id,
        templateId: template.id,
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
    });
    const used = last?.completedAt
      ? await this.hoursSince(machine.id, last.completedAt)
      : machine.currentWorkingHours;
    const remaining = new Prisma.Decimal(template.intervalHours).minus(used);
    if (remaining.gt(SERVICE_DUE_HOURS)) {
      return;
    }
    const open = await this.prisma.serviceRecord.findFirst({
      where: {
        machineId: machine.id,
        templateId: template.id,
        status: { in: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS'] },
      },
    });
    if (open) {
      return;
    }
    const created = await this.prisma.serviceRecord.create({
      data: {
        companyId: template.companyId,
        machineId: machine.id,
        templateId: template.id,
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        note: template.title,
      },
    });
    // BE-15 (F-07): pad notifikacije je prekidao cijeli cron (ostale mašine se nisu
    // ni pregledale). Servis je već upisan, pa je notifikacija best-effort (D-031).
    try {
      await notifyRoles({
        prisma: this.prisma,
        notifications: this.notifications,
        companyId: template.companyId,
        roles: ['ADMIN', 'SUPER_ADMIN', 'MECHANIC'],
        type: 'SERVICE_DUE',
        title: 'Service due',
        message: template.title,
        data: { serviceId: created.id, machineId: machine.id },
      });
    } catch (error) {
      this.logger.warn(
        `SERVICE_DUE notifikacija nije poslana (${created.id}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.logger.log(`scheduled service ${created.id}`);
  }

  private async hoursSince(
    machineId: string,
    since: Date,
  ): Promise<Prisma.Decimal> {
    const agg = await this.prisma.timerSession.aggregate({
      where: { machineId, closedAt: { gt: since } },
      _sum: { durationMinutes: true },
    });
    return new Prisma.Decimal(agg._sum.durationMinutes ?? 0).div(60);
  }
}
