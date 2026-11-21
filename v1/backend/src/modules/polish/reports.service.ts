import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  currentMonthRange,
  parseDateOnly,
  readCompanyTimezone,
  tzDayUtcRange,
} from '../../common/scope/company-tz';
import { isCompanyWide } from '../../common/scope/ops-roles';
import { requireCompany } from '../users/users-helpers';
import { assertPeriodSpan } from '../payroll/payroll-period';
import { REPORT_SLUGS, ReportQueryDto, ReportSlug } from './reports.dto';
import { runReport } from './report-queries';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(actor: AuthUser, slug: string, query: ReportQueryDto) {
    const resolved = this.assertSlug(slug);
    this.assertSlugAccess(actor, resolved);
    const companyId = requireCompany(actor);
    const tz = await readCompanyTimezone(this.prisma, companyId);
    const month = currentMonthRange(new Date(), tz);
    const from = query.from ?? month.from;
    const to = query.to ?? month.to;
    parseDateOnly(from);
    parseDateOnly(to);
    // BE-15 (F-05): `from`/`to` su bili bez granica i bez provjere reda — izvještaj
    // „od 2000. do 2030.“ je vukao sve redove u memoriju (pa i u Excel), a obrnut
    // period je tiho vraćao praznu tabelu. Sada `400`, isto pravilo kao payroll (BE-13).
    if (from > to) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'from must be <= to',
        400,
      );
    }
    assertPeriodSpan(from, to);
    const start = tzDayUtcRange(from, tz).start;
    const end = tzDayUtcRange(to, tz).end;
    const projectIds = await this.scopedProjectIds(
      actor,
      companyId,
      query.projectId,
    );
    const table = await runReport(
      this.prisma,
      resolved,
      companyId,
      { start, end },
      projectIds,
      query.projectId,
    );
    return { slug: resolved, from, to, ...table };
  }

  /** BE-15 (F-05): ime exporta nosi period (prije je svaki bio `{slug}.xlsx`). */
  reportFilename(payload: { slug: string; from: string; to: string }): string {
    return `report-${payload.slug}-${payload.from}_${payload.to}.xlsx`;
  }

  async exportXlsx(
    actor: AuthUser,
    slug: string,
    query: ReportQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const payload = await this.get(actor, slug, query);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(payload.slug);
    sheet.addRow(payload.columns);
    for (const row of payload.rows) {
      sheet.addRow(payload.columns.map((col) => row[col] ?? ''));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      filename: this.reportFilename(payload),
    };
  }

  private assertSlug(slug: string): ReportSlug {
    if (!(REPORT_SLUGS as readonly string[]).includes(slug)) {
      throw new AppError(ERROR_CODES.REPORT_UNKNOWN, 'Unknown report', 404);
    }
    return slug as ReportSlug;
  }

  private assertSlugAccess(actor: AuthUser, slug: ReportSlug): void {
    if (
      slug === 'tender-comparison' &&
      !actor.permissions.includes('tenders.read')
    ) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'tenders.read required', 403);
    }
    if (
      slug === 'phase-quantities' &&
      !actor.permissions.includes('quantities.read')
    ) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'quantities.read required',
        403,
      );
    }
    if (slug === 'fuel-summary') {
      const ok =
        actor.permissions.includes('reports.read') ||
        actor.permissions.includes('fuel.reports');
      if (!ok) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'fuel report not allowed',
          403,
        );
      }
    }
  }

  private async scopedProjectIds(
    actor: AuthUser,
    companyId: string,
    projectId?: string,
  ): Promise<string[] | null> {
    if (isCompanyWide(actor)) {
      if (projectId) {
        return [projectId];
      }
      return null;
    }
    const assigned = await this.prisma.projectAssignment.findMany({
      where: { userId: actor.id, companyId },
      select: { projectId: true },
    });
    const ids = assigned.map((row) => row.projectId);
    if (projectId && !ids.includes(projectId)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Project not in scope', 403);
    }
    return projectId ? [projectId] : ids;
  }
}
