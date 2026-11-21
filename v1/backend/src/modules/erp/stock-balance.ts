import { Prisma } from '../../../generated/client';

/**
 * BE-14: funkcije rade i unutar transakcije (`$transaction` daje `TransactionClient`),
 * jer se provjera stanja i upis pokreta moraju izvršiti zajedno.
 */
type Db = Pick<Prisma.TransactionClient, 'setting' | 'stockMovement'>;

export async function allowNegativeStock(
  prisma: Db,
  companyId: string,
): Promise<boolean> {
  const row = await prisma.setting.findUnique({
    where: { companyId_key: { companyId, key: 'erp.allowNegativeStock' } },
  });
  return row?.value === true;
}

export async function stockBalance(
  prisma: Db,
  warehouseId: string,
  materialId: string,
): Promise<Prisma.Decimal> {
  const agg = await prisma.stockMovement.aggregate({
    where: { warehouseId, materialId },
    _sum: { qty: true },
  });
  return new Prisma.Decimal(agg._sum.qty ?? 0);
}
