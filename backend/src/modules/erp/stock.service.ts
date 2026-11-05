import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, StockMovement } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { parseNonZeroDecimal } from '../../common/utils/decimal-input';
import { requireCompany } from '../users/users-helpers';
import { ApplyStockDto, CreateMovementDto } from './warehouses.dto';
import { serializeMovement, serializeStockRow } from './serialize-erp';
import { allowNegativeStock, stockBalance } from './stock-balance';

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser) {
    const companyId = requireCompany(actor);
    const grouped = await this.prisma.stockMovement.groupBy({
      by: ['warehouseId', 'materialId'],
      where: { companyId },
      _sum: { qty: true },
    });
    const warehouseIds = [...new Set(grouped.map((row) => row.warehouseId))];
    const materialIds = [...new Set(grouped.map((row) => row.materialId))];
    const [warehouses, materials] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { id: { in: warehouseIds } } }),
      this.prisma.material.findMany({ where: { id: { in: materialIds } } }),
    ]);
    const warehouseMap = new Map(warehouses.map((row) => [row.id, row]));
    const materialMap = new Map(materials.map((row) => [row.id, row]));
    return grouped.map((row) => {
      const warehouse = warehouseMap.get(row.warehouseId);
      const material = materialMap.get(row.materialId);
      return serializeStockRow({
        warehouseId: row.warehouseId,
        warehouseName: warehouse?.name ?? row.warehouseId,
        warehouseType: warehouse?.type ?? '',
        materialId: row.materialId,
        materialName: material?.name ?? row.materialId,
        qty: new Prisma.Decimal(row._sum.qty ?? 0),
      });
    });
  }

  async createMovement(actor: AuthUser, dto: CreateMovementDto) {
    const companyId = requireCompany(actor);
    const qty = parseNonZeroDecimal(dto.qty, 'qty');
    const key = dto.idempotencyKey?.toLowerCase();
    // Fingerprint the requested payload, not rounded DB qty or mutable warehouse defaults.
    const fingerprint = key
      ? createHash('sha256')
          .update(
            JSON.stringify([
              dto.warehouseId,
              dto.materialId,
              qty.toString(),
              dto.projectId ?? null,
            ]),
          )
          .digest('hex')
      : null;
    if (key) {
      const previous = await this.prisma.stockMovement.findFirst({
        where: { companyId, idempotencyKey: key },
      });
      if (previous) return this.replayMovement(previous, fingerprint!);
    }
    // PostgreSQL numeric(12,3) otherwise silently rounds or rejects overflow.
    // Apply only to new writes: earlier keyed rows may contain rounded legacy qty.
    if (qty.decimalPlaces() > 3 || qty.abs().gte('1000000000')) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'qty must fit numeric(12,3) without rounding',
        400,
      );
    }
    const warehouse = await this.loadWarehouse(companyId, dto.warehouseId);
    await this.loadMaterial(companyId, dto.materialId);
    // Look up the key before checking balance: a retry must replay the committed
    // movement even if applying it a second time would make stock negative.
    let result: { row: StockMovement; created: boolean };
    try {
      result = await this.runStockTx(async (tx) => {
        if (key) {
          const previous = await tx.stockMovement.findFirst({
            where: { companyId, idempotencyKey: key },
          });
          if (previous) {
            this.assertMovementFingerprint(previous, fingerprint!);
            return { row: previous, created: false };
          }
        }
        const projectId = dto.projectId ?? warehouse.projectId;
        await this.lockStockProject(tx, companyId, projectId);
        await this.assertNotNegative(
          tx,
          companyId,
          warehouse.id,
          dto.materialId,
          qty,
        );
        const row = await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: warehouse.id,
            materialId: dto.materialId,
            qty,
            projectId,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
          },
        });
        return { row, created: true };
      });
    } catch (error) {
      if (
        !key ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const previous = await this.prisma.stockMovement.findFirst({
        where: { companyId, idempotencyKey: key },
      });
      if (!previous) throw error;
      return this.replayMovement(previous, fingerprint!);
    }
    if (result.created) {
      await this.audit.write({
        companyId,
        actorId: actor.id,
        action: 'STOCK_MOVEMENT',
        entityType: 'StockMovement',
        entityId: result.row.id,
        payload: { qty: qty.toString() },
      });
    }
    return serializeMovement(result.row);
  }

  private assertMovementFingerprint(
    row: StockMovement,
    fingerprint: string,
  ): void {
    if (row.requestFingerprint !== fingerprint) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Idempotency key already used',
        409,
      );
    }
  }

  private replayMovement(row: StockMovement, fingerprint: string) {
    this.assertMovementFingerprint(row, fingerprint);
    return serializeMovement(row);
  }

  async applyFuel(actor: AuthUser, fuelId: string, dto: ApplyStockDto) {
    const companyId = requireCompany(actor);
    const existing = await this.prisma.stockMovement.findFirst({
      where: { companyId, fuelEntryId: fuelId },
    });
    if (existing) {
      return { created: false, row: serializeMovement(existing) };
    }
    const warehouse = await this.loadWarehouse(companyId, dto.warehouseId);
    if (warehouse.type !== 'CISTERN') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'apply-stock requires CISTERN',
        400,
      );
    }
    await this.loadMaterial(companyId, dto.materialId);
    let result: { row: StockMovement; created: boolean };
    try {
      result = await this.runStockTx(async (tx) => {
        // Recheck inside every SERIALIZABLE attempt, before balance validation.
        const previous = await tx.stockMovement.findFirst({
          where: { companyId, fuelEntryId: fuelId },
        });
        if (previous) return { row: previous, created: false };
        // Match amendments' fuel-then-project lock order. SHARE protects the
        // liters/project snapshot until the stock movement has committed.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "FuelEntry"
          WHERE "id" = ${fuelId} AND "companyId" = ${companyId}
          FOR SHARE`;
        if (!locked.length) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            'Fuel entry not found',
            404,
          );
        }
        const fuel = await tx.fuelEntry.findFirst({
          where: { id: fuelId, companyId },
        });
        if (!fuel) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            'Fuel entry not found',
            404,
          );
        }
        await this.lockStockProject(tx, companyId, fuel.projectId);
        const qty = fuel.liters.neg();
        await this.assertNotNegative(
          tx,
          companyId,
          warehouse.id,
          dto.materialId,
          qty,
        );
        const row = await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: warehouse.id,
            materialId: dto.materialId,
            qty,
            projectId: fuel.projectId,
            fuelEntryId: fuel.id,
          },
        });
        return { row, created: true };
      });
    } catch (error) {
      const raced = await this.raceWinner(companyId, fuelId, error);
      if (raced) return { created: false, row: serializeMovement(raced) };
      throw error;
    }
    if (result.created) {
      await this.audit.write({
        companyId,
        actorId: actor.id,
        action: 'STOCK_MOVEMENT',
        entityType: 'StockMovement',
        entityId: result.row.id,
        payload: { fuelEntryId: fuelId },
      });
    }
    return { created: result.created, row: serializeMovement(result.row) };
  }

  private async lockStockProject(
    tx: Prisma.TransactionClient,
    companyId: string,
    projectId: string | null,
  ): Promise<void> {
    if (projectId === null) return;
    // A foreign-key alone does not bind the project to this tenant. SHARE
    // blocks deletion or company changes until the insert commits.
    const projects = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "companyId" = ${companyId}
      FOR SHARE`;
    if (!projects.length)
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
  }

  /**
   * BE-14 F-01: SERIALIZABLE transakcija za zalihe. Pod paralelizmom PostgreSQL može
   * vratiti `40001` (Prisma: `P2034`) — to nije greška klijenta nego signal da treba
   * ponoviti. Bez retry-a bi ispravan zahtjev završio kao `500`.
   */
  private async runStockTx<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable = this.isStockRetryable(error);
        if (!retryable) {
          throw error;
        }
        if (attempt >= maxAttempts) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'Stock is being updated concurrently, retry',
            409,
          );
        }
      }
    }
  }

  private isStockRetryable(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code === 'P2034') return true;
    // Raw SELECT ... FOR SHARE can surface PostgreSQL 40001 as P2010 instead
    // of P2034 with the driver adapter. Retry only that exact serialization
    // failure, never unrelated SQL or raw-query errors.
    if (error.code !== 'P2010') return false;
    const meta = error.meta as
      | {
          code?: unknown;
          driverAdapterError?: { cause?: { originalCode?: unknown } };
        }
      | undefined;
    return (
      meta?.code === '40001' ||
      meta?.driverAdapterError?.cause?.originalCode === '40001'
    );
  }

  /** BE-14 F-02: paralelni `apply-stock` je već upisao pokret → vrati postojeći red. */
  private raceWinner(companyId: string, fuelId: string, error: unknown) {
    const isUnique =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002';
    if (!isUnique) {
      return null;
    }
    return this.prisma.stockMovement.findFirst({
      where: { companyId, fuelEntryId: fuelId },
    });
  }

  private async assertNotNegative(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
    materialId: string,
    qty: Prisma.Decimal,
  ): Promise<void> {
    const current = await stockBalance(tx, warehouseId, materialId);
    const next = current.plus(qty);
    if (next.gte(0)) {
      return;
    }
    if (await allowNegativeStock(tx, companyId)) {
      return;
    }
    throw new AppError(ERROR_CODES.CONFLICT, 'Stock cannot go negative', 409);
  }

  private async loadWarehouse(companyId: string, id: string) {
    const row = await this.prisma.warehouse.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Warehouse not found', 404);
    }
    return row;
  }

  private async loadMaterial(companyId: string, id: string) {
    const row = await this.prisma.material.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Material not found', 404);
    }
    return row;
  }
}
