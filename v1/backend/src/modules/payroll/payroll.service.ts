import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../mail/email.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { requireCompany } from '../users/users-helpers';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { PayrollQueryDto, RejectPayrollDto } from './payroll.dto';
import { resolvePayrollPeriod } from './payroll-period';
import {
  assertCanDecidePayroll,
  assertCanListPayroll,
  payrollProjectIds,
} from './payroll-access';
import { PAYROLL_INCLUDE, payrollSessionWhere } from './payroll-query';
import { serializePayrollSession } from './serialize-payroll';
import { writePayrollXlsx } from './payroll-export';
import { buildPayrollSummary } from './payroll-summary';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async list(actor: AuthUser, query: PayrollQueryDto) {
    const { rows, total, page, limit } = await this.loadPage(actor, query);
    return listResult(rows.map(serializePayrollSession), total, page, limit);
  }

  async summary(actor: AuthUser, query: PayrollQueryDto) {
    const { period, rows } = await this.loadClosed(actor, query);
    return buildPayrollSummary(period.from, period.to, period.tz, rows);
  }

  /**
   * BE-13 (F-06): uz buffer se vraća i ime fajla sa periodom — prije je svaki export
   * bio `payroll.xlsx`, pa se u folderu “Preuzimanja” nije znalo koji je koji mjesec.
   */
  async exportXlsx(
    actor: AuthUser,
    query: PayrollQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { period, rows } = await this.loadClosed(actor, query);
    const approved = rows
      .filter((row) => row.approvalStatus === 'APPROVED')
      .map(serializePayrollSession);
    const totals = buildPayrollSummary('', '', '', rows);
    const buffer = await writePayrollXlsx(approved, {
      minutes: totals.approvedMinutes,
      amount: totals.approvedAmount,
    });
    const filename =
      period.from === period.to
        ? `payroll-${period.from}.xlsx`
        : `payroll-${period.from}_${period.to}.xlsx`;
    return { buffer, filename };
  }

  async approve(actor: AuthUser, id: string) {
    return this.decide(actor, id, 'APPROVED');
  }

  async reject(actor: AuthUser, id: string, dto: RejectPayrollDto) {
    return this.decide(actor, id, 'REJECTED', dto.reason);
  }

  private async loadPage(actor: AuthUser, query: PayrollQueryDto) {
    const { where } = await this.scope(actor, query);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.timerSession.findMany({
        where,
        include: PAYROLL_INCLUDE,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.timerSession.count({ where }),
    ]);
    return { rows, total, page, limit };
  }

  private async loadClosed(actor: AuthUser, query: PayrollQueryDto) {
    const { where, period } = await this.scope(actor, query);
    const rows = await this.prisma.timerSession.findMany({
      where,
      include: PAYROLL_INCLUDE,
      orderBy: { startedAt: 'asc' },
    });
    return { period, rows };
  }

  private async scope(actor: AuthUser, query: PayrollQueryDto) {
    assertCanListPayroll(actor);
    const companyId = requireCompany(actor);
    const period = await resolvePayrollPeriod(this.prisma, companyId, query);
    const projectIds = await payrollProjectIds(this.prisma, actor);
    return {
      period,
      where: payrollSessionWhere({
        companyId,
        actor,
        period,
        projectIds,
        status: query.status,
      }),
    };
  }

  private async decide(
    actor: AuthUser,
    id: string,
    next: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    const companyId = requireCompany(actor);
    const session = await this.prisma.timerSession.findFirst({
      where: { id, companyId },
      include: PAYROLL_INCLUDE,
    });
    if (!session || !session.closedAt) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Timer session not found', 404);
    }
    await assertCanDecidePayroll(this.prisma, actor, session);
    if (session.approvalStatus !== 'PENDING') {
      throw new AppError(ERROR_CODES.CONFLICT, 'Session is not pending', 409);
    }
    // BE-13 (F-01): odluka mora biti atomska. Prije je bio `findFirst` (provjera
    // `PENDING`) pa `update` — dva paralelna zahtjeva (odobri / odbij) oba su prošla
    // provjeru, pa je drugi tiho pregazio prvog i oba su ostavila audit zapis.
    // Sada `updateMany` sa uslovom `approvalStatus: 'PENDING'`; ako nijedan red nije
    // pogođen, odluka je već donesena u međuvremenu.
    const applied = await this.prisma.timerSession.updateMany({
      where: { id: session.id, companyId, approvalStatus: 'PENDING' },
      data: { approvalStatus: next },
    });
    if (applied.count === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Session is not pending', 409);
    }
    const updated = await this.prisma.timerSession.findFirstOrThrow({
      where: { id: session.id },
      include: PAYROLL_INCLUDE,
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: next === 'APPROVED' ? 'PAYROLL_APPROVED' : 'PAYROLL_REJECTED',
      entityType: 'TimerSession',
      entityId: session.id,
      payload: { next, reason: reason ?? null },
    });
    if (next === 'REJECTED') {
      // BE-13 (F-02): odluka je već upisana (i u auditu) — pad notifikacije ili
      // e-maila ne smije klijentu vratiti 500 za uspješno odbijanje.
      try {
        await this.notifyReject(session, reason);
      } catch (error) {
        this.logger.warn(
          `PAYROLL_REJECTED notifikacija nije poslana (session ${session.id}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return serializePayrollSession(updated);
  }

  private async notifyReject(
    session: Prisma.TimerSessionGetPayload<{ include: typeof PAYROLL_INCLUDE }>,
    reason?: string,
  ): Promise<void> {
    const message = reason ?? 'Your hours were rejected';
    await this.notifications.createForUser({
      companyId: session.companyId,
      userId: session.userId,
      type: 'PAYROLL_REJECTED',
      title: 'Timesheet rejected',
      message,
      data: { timerId: session.id },
    });
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { email: true },
    });
    await this.email.trySend({
      companyId: session.companyId,
      to: user.email,
      subject: 'Timesheet rejected',
      text: message,
    });
  }
}
