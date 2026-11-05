import { Prisma } from '../../../generated/client';
import { recalcSpend } from './spend';

function fixture(cost: string, fuel = '0', service = '0') {
  const update = jest.fn().mockResolvedValue({});
  const db = {
    costEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { amount: new Prisma.Decimal(cost) } }),
    },
    fuelEntry: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { totalCost: new Prisma.Decimal(fuel) } }),
    },
    serviceRecord: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalCost: new Prisma.Decimal(service) },
      }),
    },
    project: { update },
  };
  return { db: db as unknown as Prisma.TransactionClient, update };
}

describe('project spend', () => {
  it('stores an exact maximum sum', async () => {
    const f = fixture('9999999999.97', '0.01', '0.01');
    await recalcSpend(f.db, 'project-1');
    const calls = f.update.mock.calls as unknown as Array<
      [{ data: { currentSpend: Prisma.Decimal } }]
    >;
    expect(calls[0][0].data.currentSpend.toString()).toBe('9999999999.99');
  });

  it.each(['10000000000', '-10000000000'])(
    'rejects a sum outside numeric(12,2): %s',
    async (cost) => {
      const f = fixture(cost);
      await expect(recalcSpend(f.db, 'project-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(f.update).not.toHaveBeenCalled();
    },
  );
});
