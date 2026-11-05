import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { listResult, parsePagination } from '../../common/utils/pagination';
import { parseNonNegativeMoney } from '../../common/utils/decimal-input';
import { isSerializationFailure } from '../../common/utils/serialization-retry';
import { parseDateOnly } from '../../common/scope/company-tz';
import { requireCompany } from '../users/users-helpers';
import { lockSpendProject, recalcSpend } from '../ops/spend';
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
    const amount = parseNonNegativeMoney(dto.amount, 'amount');
    const date = parseDateOnly(dto.date);
    const key = dto.idempotencyKey?.toLowerCase();
    const fingerprint = key
      ? createHash('sha256')
          .update(
            JSON.stringify([
              amount.toString(),
              dto.category,
              date.toISOString(),
              dto.note ?? null,
              source,
              dto.sourceId ?? null,
              dto.projectId ?? null,
            ]),
          )
          .digest('hex')
      : null;
    if (key) {
      const previous = await this.findCostRequest(companyId, key);
      if (previous) return this.replayCost(previous, fingerprint!, companyId);
    }
    try {
      const operation = async (tx: Prisma.TransactionClient) => {
        // Claim the key first. Competing requests block at the unique index and
        // can only observe a fully committed receipt, cost and project spend.
        const receipt = key
          ? await tx.costRequest.create({
              data: {
                companyId,
                idempotencyKey: key,
                fingerprint: fingerprint!,
              },
            })
          : null;
        if (source === 'FUEL') {
          // Match fuel amendments' lock order: fuel first, then project. A
          // linked cost must follow the source's tenant and current project.
          const fuel = await tx.$queryRaw<Array<{ projectId: string | null }>>`
            SELECT "projectId" FROM "FuelEntry"
            WHERE "id" = ${dto.sourceId!} AND "companyId" = ${companyId}
            FOR SHARE`;
          if (!fuel.length) {
            throw new AppError(
              ERROR_CODES.NOT_FOUND,
              'Fuel entry not found',
              404,
            );
          }
          if (fuel[0].projectId !== (dto.projectId ?? null)) {
            throw new AppError(
              ERROR_CODES.CONFLICT,
              'Fuel source project does not match cost',
              409,
            );
          }
        }
        if (dto.projectId) await lockSpendProject(tx, companyId, dto.projectId);
        const created = await tx.costEntry.create({
          data: {
            companyId,
            amount,
            category: dto.category,
            date,
            note: dto.note,
            source,
            sourceId: dto.sourceId ?? null,
            projectId: dto.projectId ?? null,
          },
        });
        if (created.projectId) await recalcSpend(tx, created.projectId);
        if (receipt) {
          await tx.costRequest.update({
            where: { id: receipt.id },
            data: { costEntryId: created.id },
          });
        }
        return created;
      };
      // Fuel amendments are SERIALIZABLE too: a waiter that began before a
      // cost commit must not miss that cost in an earlier snapshot.
      const row =
        source === 'FUEL'
          ? await this.runFuelCostTx(operation)
          : await this.prisma.$transaction(operation);
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
      if (
        key &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const previous = await this.findCostRequest(companyId, key);
        if (previous) return this.replayCost(previous, fingerprint!, companyId);
      }
      mapCostConflict(error);
    }
  }

  private async runFuelCostTx<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!isSerializationFailure(error)) throw error;
        if (attempt >= 3)
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'Fuel or cost is being updated concurrently, retry',
            409,
          );
      }
    }
  }

  private findCostRequest(companyId: string, idempotencyKey: string) {
    return this.prisma.costRequest.findUnique({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
      include: { costEntry: true },
    });
  }

  private replayCost(
    receipt: Prisma.CostRequestGetPayload<{ include: { costEntry: true } }>,
    fingerprint: string,
    companyId: string,
  ) {
    if (
      receipt.fingerprint !== fingerprint ||
      !receipt.costEntry ||
      receipt.costEntry.companyId !== companyId
    ) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Idempotency key already used or cost deleted',
        409,
      );
    }
    return serializeCostEntry(receipt.costEntry);
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
      const row = await this.prisma.$transaction(async (tx) => {
        if (built.projectId)
          await lockSpendProject(tx, companyId, built.projectId);
        const created = await tx.costEntry.create({
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
        if (created.projectId) await recalcSpend(tx, created.projectId);
        return created;
      });
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
      if (row.projectId) await lockSpendProject(tx, companyId, row.projectId);
      // Another removal may have completed while waiting for the project lock.
      const current = await tx.costEntry.findFirst({
        where: { id, companyId },
      });
      if (!current) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Cost entry not found', 404);
      }
      await tx.costEntry.delete({ where: { id } });
      if (current.projectId) await recalcSpend(tx, current.projectId);
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
