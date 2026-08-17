import { PrismaService } from '../prisma/prisma.service';

export async function readMaxOpenHours(
  prisma: PrismaService,
  companyId: string,
): Promise<number> {
  const row = await prisma.setting.findUnique({
    where: { companyId_key: { companyId, key: 'timer.maxOpenHours' } },
  });
  return typeof row?.value === 'number' ? row.value : 12;
}
