import {
  CostEntry,
  Partner,
  Prisma,
  StockMovement,
  Warehouse,
} from '../../../generated/client';

export function serializePartner(row: Partner) {
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    name: row.name,
    taxId: row.taxId,
    note: row.note,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeCostEntry(row: CostEntry) {
  return {
    id: row.id,
    companyId: row.companyId,
    amount: row.amount.toFixed(2),
    category: row.category,
    date: row.date,
    note: row.note,
    source: row.source,
    sourceId: row.sourceId,
    projectId: row.projectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeWarehouse(row: Warehouse) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    type: row.type,
    projectId: row.projectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeMovement(row: StockMovement) {
  return {
    id: row.id,
    companyId: row.companyId,
    warehouseId: row.warehouseId,
    materialId: row.materialId,
    qty: row.qty.toString(),
    projectId: row.projectId,
    fuelEntryId: row.fuelEntryId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeStockRow(row: {
  warehouseId: string;
  warehouseName: string;
  warehouseType: string;
  materialId: string;
  materialName: string;
  qty: Prisma.Decimal;
}) {
  return {
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    warehouseType: row.warehouseType,
    materialId: row.materialId,
    materialName: row.materialName,
    qty: row.qty.toString(),
  };
}
