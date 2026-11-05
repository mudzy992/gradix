import { Prisma } from '../../../generated/client';
import { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AmendmentsService } from './amendments.service';

const actor = {
  id: 'user',
  roles: ['ADMIN'],
  tenantCompanyId: 'company',
  companyId: 'company',
} as AuthUser;
const dto = {
  entityType: 'FUEL' as const,
  entityId: 'fuel',
  field: 'liters',
  newValue: '4',
  reason: 'correction',
};
const serialization = () =>
  new Prisma.PrismaClientKnownRequestError('retry', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
  });

function fixture() {
  const transaction = jest.fn().mockResolvedValue({
    row: { id: 'amendment' },
    applied: { oldValue: '3', ownerId: 'owner' },
  });
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    createForUser: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AmendmentsService(
    { $transaction: transaction } as unknown as PrismaService,
    audit as unknown as AuditService,
    notifications as unknown as NotificationsService,
  );
  return { service, transaction, audit, notifications };
}

describe('fuel amendment serialization retries', () => {
  it('retries an exact raw serialization error before post-commit work', async () => {
    const f = fixture();
    f.transaction.mockRejectedValueOnce(serialization());
    expect(await f.service.create(actor, dto)).toEqual({ id: 'amendment' });
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.audit.write).toHaveBeenCalledTimes(1);
    expect(f.notifications.createForUser).toHaveBeenCalledTimes(1);
  });
  it('returns a bounded conflict without post-commit work', async () => {
    const f = fixture();
    f.transaction.mockRejectedValue(serialization());
    await expect(f.service.create(actor, dto)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(f.transaction).toHaveBeenCalledTimes(3);
    expect(f.audit.write).not.toHaveBeenCalled();
    expect(f.notifications.createForUser).not.toHaveBeenCalled();
  });
  it('does not retry unrelated database errors or trip transactions', async () => {
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
    const trip = fixture();
    trip.transaction.mockRejectedValueOnce(serialization());
    await expect(
      trip.service.create(actor, { ...dto, entityType: 'TRIP' }),
    ).rejects.toMatchObject({ code: 'P2010' });
    expect(trip.transaction).toHaveBeenCalledTimes(1);
  });
});
