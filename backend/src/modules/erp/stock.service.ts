import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/client';
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
    const warehouse = await this.loadWarehouse(companyId, dto.warehouseId);
    await this.loadMaterial(companyId, dto.materialId);
    // BE-14 F-01: provjera stanja i upis pokreta su ranije bili odvojeni (check-then-insert),
    // pa su dva paralelna izlaza mogla oba proći provjeru i stanje bi otišlo u minus.
    // Sada su u jednoj SERIALIZABLE transakciji.
    const row = await this.prisma.$transaction(
      async (tx) => {
        await this.assertNotNegative(
          tx,
          companyId,
          warehouse.id,
          dto.materialId,
          qty,
        );
        return tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: warehouse.id,
            materialId: dto.materialId,
            qty,
            projectId: dto.projectId ?? warehouse.projectId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'STOCK_MOVEMENT',
      entityType: 'StockMovement',
      entityId: row.id,
      payload: { qty: qty.toString() },
    });
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
    const fuel = await this.prisma.fuelEntry.findFirst({
      where: { id: fuelId, companyId },
    });
    if (!fuel) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Fuel entry not found', 404);
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
    const qty = fuel.liters.neg();
    // BE-14 F-02: `findFirst` pa `create` nije atomski — dva paralelna zahtjeva su mogla
    // oba proći `existing` provjeru i drugi bi pao na unique `fuelEntryId` uz 500.
    // Sada se P2002 prevodi u idempotentan odgovor (created: false), a provjera stanja
    // i upis su u SERIALIZABLE transakciji.
    let row;
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          await this.assertNotNegative(
            tx,
            companyId,
            warehouse.id,
            dto.materialId,
            qty,
          );
          return tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: warehouse.id,
              materialId: dto.materialId,
              qty,
              projectId: fuel.projectId,
              fuelEntryId: fuel.id,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const raced = await this.raceWinner(companyId, fuelId, error);
      if (raced) {
        return { created: false, row: serializeMovement(raced) };
      }
      throw error;
    }
    await this.audit.write({
      companyId,
      actorId: actor.id,
      action: 'STOCK_MOVEMENT',
      entityType: 'StockMovement',
      entityId: row.id,
      payload: { fuelEntryId: fuel.id },
    });
    return { created: true, row: serializeMovement(row) };
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
