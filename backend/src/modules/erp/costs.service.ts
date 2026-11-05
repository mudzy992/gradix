import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { parseNonNegativeMoney } from '../../common/utils/decimal-input';
import { parseDateOnly } from '../../common/scope/company-tz';
import { requireCompany } from '../users/users-helpers';
import { recalcSpend } from '../ops/spend';
import { CostQueryDto, CreateCostDto, FromPayrollDto } from './costs.dto';
import { serializeCostEntry } from './serialize-erp';
import { buildPayrollCost, mapCostConflict } from './from-payroll';

@Injectable()
export class CostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, query: CostQueryDto) {
    const companyId = requireCompany(actor);
    const { page, limit, skip } = parsePagination(query.page, query.limit);
    const where: Prisma.CostEntryWhereInput = {
      companyId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.source ? { source: query.source } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.costEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.costEntry.count({ where }),
    ]);
    return listResult(rows.map(serializeCostEntry), total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateCostDto) {
    const companyId = requireCompany(actor);
    const source = dto.source ?? 'MANUAL';
    if (source === 'MANUAL' && dto.sourceId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'MANUAL cannot set sourceId',
        400,
      );
    }
    if (source !== 'MANUAL' && !dto.sourceId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'sourceId required',
        400,
      );
    }
    if (dto.projectId) {
      await this.assertProject(companyId, dto.projectId);
    }
    try {
      const row = await this.prisma.costEntry.create({
        data: {
          companyId,
          amount: parseNonNegativeMoney(dto.amount, 'amount'),
          category: dto.category,
          date: parseDateOnly(dto.date),
          note: dto.note,
          source,
          sourceId: dto.sourceId ?? null,
          projectId: dto.projectId ?? null,
        },
      });
      if (row.projectId) {
        await recalcSpend(this.prisma, row.projectId);
      }
      await this.audit.write({
        companyId,
        actorId: actor.id,
        action: 'COST_ENTRY_CREATED',
        entityType: 'CostEntry',
        entityId: row.id,
        payload: { source, sourceId: row.sourceId },
      });
      return serializeCostEntry(row);
    } catch (error) {
      mapCostConflict(error);
    }
  }

  async fromPayroll(actor: AuthUser, dto: FromPayrollDto) {
    const companyId = requireCompany(actor);
    if (dto.projectId) {
      await this.assertProject(companyId, dto.projectId);
    }
    const built = await buildPayrollCost({
      prisma: this.prisma,
      companyId,
      dto,
    });
    try {
      const row = await this.prisma.costEntry.create({
        data: {
          companyId,
          amount: built.amount,
          category: 'LABOR',
          date: built.date,
          source: 'PAYROLL',
          sourceId: built.sourceId,
          projectId: built.projectId,
        },
      });
      if (row.projectId) {
        await recalcSpend(this.prisma, row.projectId);
      }
      await this.audit.write({
        companyId,
        actorId: actor.id,
        action: 'COST_ENTRY_CREATED',
        entityType: 'CostEntry',
        entityId: row.id,
        payload: { source: 'PAYROLL', sourceId: row.sourceId },
      });
      return serializeCostEntry(row);
    } catch (error) {
      mapCostConflict(error);
    }
  }

  async getById(actor: AuthUser, id: string) {
    const row = await this.prisma.costEntry.findFirst({
      where: { id, companyId: requireCompany(actor) },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Cost entry not found', 404);
    }
    return serializeCostEntry(row);
  }

  async remove(actor: AuthUser, id: string) {
    const companyId = requireCompany(actor);
    const row = await this.prisma.costEntry.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Cost entry not found', 404);
    }
    // BE-14 F-03: brisanje troška je ranije prolazilo **bez audit zapisa** — jedina
    // destruktivna ERP operacija koja nije ostavljala trag. Sada se briše i preračunava
    // u transakciji, a `COST_ENTRY_REMOVED` nosi dovoljno podataka za rekonstrukciju.
    await this.prisma.$transaction(async (tx) => {
      await tx.costEntry.delete({ where: { id } });
      if (row.projectId) {
        await recalcSpend(tx, row.projectId);
      }
    });
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'COST_ENTRY_REMOVED',
      entityType: 'CostEntry',
      entityId: id,
      payload: {
        amount: row.amount.toFixed(2),
        category: row.category,
        date: row.date.toISOString().slice(0, 10),
        source: row.source,
        sourceId: row.sourceId,
        projectId: row.projectId,
      },
    });
  }

  private async assertProject(
    companyId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
    }
  }
}
