import { Injectable } from '@nestjs/common';
import { Project } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { hasRole, hidesBudget, isCompanyWide } from '../../common/scope/ops-roles';
import { projectListWhere } from '../../common/scope/scope-by-project';
import {
  calendarDateInTz,
  readCompanyTimezone,
  tzDayUtcRange,
} from '../../common/scope/company-tz';
import { requireCompany } from '../users/users-helpers';
import { computeElapsedMinutes } from './timer-math';
import { avgProgress, loadPresence, spendCard } from './dashboard-presence';
import { loadExpiring } from './dashboard-expiring';
import type { DashboardCard, DashboardPayload } from './dashboard-types';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(actor: AuthUser): Promise<DashboardPayload> {
    const companyId = requireCompany(actor);
    const unread = await this.prisma.notification.count({
      where: { userId: actor.id, isRead: false },
    });
    if (hasRole(actor, 'WORKER', 'MACHINE_OPERATOR')) {
      return this.fieldWorker(actor, companyId, unread);
    }
    if (hasRole(actor, 'DRIVER') && !hasRole(actor, 'PROJECT_MANAGER', 'ADMIN', 'SUPER_ADMIN')) {
      return this.driver(actor, companyId, unread);
    }
    if (hasRole(actor, 'MECHANIC') && !isCompanyWide(actor) && !hasRole(actor, 'PROJECT_MANAGER')) {
      return this.mechanic(companyId, unread);
    }
    const projects = await this.prisma.project.findMany({
      where: projectListWhere(actor, { archived: false }),
    });
    const active = projects.filter(
      (project) => project.status === 'PLANNING' || project.status === 'IN_PROGRESS',
    );
    if (isCompanyWide(actor)) {
      return this.admin(companyId, active, unread);
    }
    return this.pmSs(companyId, projects, unread);
  }

  private async admin(
    companyId: string,
    projects: Project[],
    unread: number,
  ): Promise<DashboardPayload> {
    const money = spendCard(projects);
    const openTimers = await this.prisma.timerSession.count({
      where: { companyId, closedAt: null },
    });
    const cards: DashboardCard[] = [
      { key: 'activeProjects', value: projects.length },
      { key: 'spend', value: money.budget ? `${money.spend} / ${money.budget}` : null },
      { key: 'openTimers', value: openTimers },
      { key: 'unread', value: unread },
    ];
    const presence = await loadPresence(this.prisma, companyId, projects);
    const expiring = await loadExpiring(this.prisma, companyId);
    return { cards, presence, expiring };
  }

  private async pmSs(
    companyId: string,
    projects: Project[],
    unread: number,
  ): Promise<DashboardPayload> {
    const presence = await loadPresence(this.prisma, companyId, projects);
    const expiring = await loadExpiring(this.prisma, companyId);
    const cards: DashboardCard[] = [
      { key: 'scopedProjects', value: projects.length },
      { key: 'progress', value: avgProgress(projects) },
      { key: 'presence', value: presence.length },
      { key: 'unread', value: unread },
    ];
    return { cards, presence, expiring };
  }

  private async fieldWorker(
    actor: AuthUser,
    companyId: string,
    unread: number,
  ): Promise<DashboardPayload> {
    const myTasks = await this.prisma.taskAssignment.count({
      where: { userId: actor.id, task: { companyId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    });
    const session = await this.prisma.timerSession.findFirst({
      where: { userId: actor.id, closedAt: null },
    });
    const elapsed = session ? computeElapsedMinutes(session, new Date()) : null;
    const cards: DashboardCard[] = [
      { key: 'myTasks', value: myTasks },
      { key: 'myTimer', value: elapsed },
      { key: 'unread', value: unread },
    ];
    if (!hidesBudget(actor)) {
      cards.push({ key: 'spend', value: null });
    }
    return { cards, presence: null };
  }

  private async driver(
    actor: AuthUser,
    companyId: string,
    unread: number,
  ): Promise<DashboardPayload> {
    const tz = await readCompanyTimezone(this.prisma, companyId);
    const today = calendarDateInTz(new Date(), tz);
    const { start, end } = tzDayUtcRange(today, tz);
    const tripsToday = await this.prisma.trip.count({
      where: { driverId: actor.id, companyId, loadedAt: { gte: start, lt: end } },
    });
    return {
      cards: [
        { key: 'tripsToday', value: tripsToday },
        { key: 'unread', value: unread },
      ],
      presence: null,
    };
  }

  private async mechanic(companyId: string, unread: number): Promise<DashboardPayload> {
    const machines = await this.prisma.machine.count({
      where: { companyId, status: { not: 'DECOMMISSIONED' } },
    });
    const expiring = await loadExpiring(this.prisma, companyId);
    return {
      cards: [
        { key: 'machines', value: machines },
        { key: 'unread', value: unread },
      ],
      presence: null,
      expiring,
    };
  }
}
