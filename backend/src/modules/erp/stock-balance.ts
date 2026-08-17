import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

export async function allowNegativeStock(
  prisma: PrismaService,
  companyId: string,
): Promise<boolean> {
  const row = await prisma.setting.findUnique({
    where: { companyId_key: { companyId, key: 'erp.allowNegativeStock' } },
  });
  return row?.value === true;
}

export async function stockBalance(
  prisma: PrismaService,
  warehouseId: string,
  materialId: string,
): Promise<Prisma.Decimal> {
  const agg = await prisma.stockMovement.aggregate({
    where: { warehouseId, materialId },
    _sum: { qty: true },
  });
  return new Prisma.Decimal(agg._sum.qty ?? 0);
}
