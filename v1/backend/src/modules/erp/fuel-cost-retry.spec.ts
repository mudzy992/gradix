import { Prisma } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CostsService } from './costs.service';

const actor = {
  id: 'user',
  tenantCompanyId: 'company',
  companyId: 'company',
} as AuthUser;
const dto = {
  source: 'FUEL' as const,
  sourceId: 'fuel',
  amount: '1',
  category: 'FUEL' as const,
  date: '2026-11-05',
};
const serialization = () =>
  new Prisma.PrismaClientKnownRequestError('retry', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: '40001' },
  });

function fixture() {
  const transaction = jest.fn().mockResolvedValue({
    id: 'cost',
    companyId: 'company',
    amount: new Prisma.Decimal('1'),
    category: 'FUEL',
    source: 'FUEL',
    sourceId: 'fuel',
    projectId: null,
  });
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const service = new CostsService(
    { $transaction: transaction } as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, transaction, audit };
}

describe('fuel cost serialization retry', () => {
  it('retries serialization with a bounded transaction and audits once', async () => {
    const f = fixture();
    f.transaction.mockRejectedValueOnce(serialization());
    expect((await f.service.create(actor, dto)).id).toBe('cost');
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.audit.write).toHaveBeenCalledTimes(1);
  });
  it('returns 409 after three failed attempts without auditing', async () => {
    const f = fixture();
    f.transaction.mockRejectedValue(serialization());
    await expect(f.service.create(actor, dto)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(f.transaction).toHaveBeenCalledTimes(3);
    expect(f.audit.write).not.toHaveBeenCalled();
  });
  it('does not retry unrelated errors or non-fuel transactions', async () => {
    const f = fixture();
    f.transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('other', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '23503' },
      }),
    );
    await expect(f.service.create(actor, dto)).rejects.toMatchObject({
      code: 'P2010',
    });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    const manual = fixture();
    manual.transaction.mockRejectedValueOnce(serialization());
    await expect(
      manual.service.create(actor, {
        ...dto,
        source: 'MANUAL',
        sourceId: undefined,
      }),
    ).rejects.toMatchObject({ code: 'P2010' });
    expect(manual.transaction).toHaveBeenCalledTimes(1);
    const service = fixture();
    service.transaction.mockRejectedValueOnce(serialization());
    await expect(
      service.service.create(actor, {
        ...dto,
        source: 'SERVICE',
        sourceId: 'service',
      }),
    ).rejects.toMatchObject({ code: 'P2010' });
    expect(service.transaction).toHaveBeenCalledTimes(1);
  });
});
