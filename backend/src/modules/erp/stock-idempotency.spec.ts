import { createHash, randomUUID } from 'crypto';
import { Prisma } from '../../../generated/client';
import { StockService } from './stock.service';
import type { AuthUser } from '../../common/types/auth-user';

const actor = { id: 'user-1', tenantCompanyId: 'company-1' } as AuthUser;
const key = randomUUID();

function fingerprint(qty: string, projectId: string | null = null) {
  return createHash('sha256')
    .update(JSON.stringify(['warehouse-1', 'material-1', qty, projectId]))
    .digest('hex');
}

function fixture() {
  const movement = {
    id: 'movement-1',
    companyId: 'company-1',
    warehouseId: 'warehouse-1',
    materialId: 'material-1',
    qty: new Prisma.Decimal('0.001'),
    projectId: null,
    fuelEntryId: null,
    createdAt: new Date('2026-11-05T00:00:00Z'),
    updatedAt: new Date('2026-11-05T00:00:00Z'),
    idempotencyKey: key,
    requestFingerprint: fingerprint('0.001'),
  };
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue(movement);
  const aggregate = jest.fn().mockResolvedValue({ _sum: { qty: null } });
  const queryRaw = jest.fn().mockResolvedValue([{ id: 'project-1' }]);
  const tx = {
    stockMovement: { findFirst, create, aggregate },
    $queryRaw: queryRaw,
  };
  const prisma = {
    stockMovement: { findFirst },
    warehouse: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'warehouse-1', projectId: null }),
    },
    material: { findFirst: jest.fn().mockResolvedValue({ id: 'material-1' }) },
    $transaction: jest.fn((run: (arg: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new StockService(prisma as never, audit as never),
    prisma,
    audit,
    movement,
    findFirst,
    create,
    aggregate,
    queryRaw,
  };
}

const body = {
  warehouseId: 'warehouse-1',
  materialId: 'material-1',
  qty: '0.001',
  idempotencyKey: key,
};

describe('stock movement idempotency', () => {
  it('replays the same canonical request before loading resources or checking balance', async () => {
    const f = fixture();
    f.movement.requestFingerprint = fingerprint('0.001');
    f.findFirst.mockResolvedValue(f.movement);
    const result = await f.service.createMovement(actor, {
      ...body,
      qty: '0.001000',
      idempotencyKey: key.toUpperCase(),
    });
    expect(result.id).toBe(f.movement.id);
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(result).not.toHaveProperty('requestFingerprint');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.prisma.warehouse.findFirst).not.toHaveBeenCalled();
    expect(f.audit.write).not.toHaveBeenCalled();
  });

  it('rejects a changed request or missing fingerprint under the same key', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValue(f.movement);
    await expect(
      f.service.createMovement(actor, { ...body, qty: '0.002' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(
      f.service.createMovement(actor, { ...body, projectId: 'project-2' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    f.findFirst.mockResolvedValue({ ...f.movement, requestFingerprint: null });
    await expect(f.service.createMovement(actor, body)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes the original request fingerprint alongside the movement and audits once', async () => {
    const f = fixture();
    const result = await f.service.createMovement(actor, body);
    expect(result.id).toBe(f.movement.id);
    expect(f.create).toHaveBeenCalledTimes(1);
    const calls = f.create.mock.calls as unknown as Array<
      [{ data: { idempotencyKey: string; requestFingerprint: string } }]
    >;
    const input = calls[0][0];
    expect(input.data.idempotencyKey).toBe(key);
    expect(input.data.requestFingerprint).toBe(fingerprint('0.001'));
    expect(f.aggregate).toHaveBeenCalledTimes(1);
    expect(f.audit.write).toHaveBeenCalledTimes(1);
  });

  it.each([
    '0.0001',
    '0.0005',
    '-0.0005',
    '1e-4',
    '999999999.9999',
    '1000000000',
    '-1000000000',
  ])(
    'rejects unrepresentable new qty %s before resources or a transaction',
    async (qty) => {
      const f = fixture();
      await expect(
        f.service.createMovement(actor, { ...body, qty }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      });
      expect(f.prisma.warehouse.findFirst).not.toHaveBeenCalled();
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      expect(f.audit.write).not.toHaveBeenCalled();
    },
  );

  it.each([
    '0.001',
    '-0.001',
    '0.001000',
    '1e-3',
    '999999999.999',
    '-999999999.999',
  ])('accepts exactly representable qty %s', async (qty) => {
    const f = fixture();
    f.aggregate.mockResolvedValue({
      _sum: { qty: new Prisma.Decimal('999999999.999') },
    });
    const result = await f.service.createMovement(actor, { ...body, qty });
    expect(result.id).toBe(f.movement.id);
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it('rejects excess-scale legacy payloads even on an existing key', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValue({
      ...f.movement,
      requestFingerprint: fingerprint('0.0005'),
    });
    for (const qty of ['0.0005', '0.000500']) {
      await expect(
        f.service.createMovement(actor, { ...body, qty }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      });
    }
    expect(f.findFirst).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it('checks the explicit project within the transaction before inserting', async () => {
    const f = fixture();
    await f.service.createMovement(actor, { ...body, projectId: 'project-1' });
    expect(f.queryRaw).toHaveBeenCalledTimes(1);
    const query = f.queryRaw.mock.calls as unknown as Array<
      [TemplateStringsArray, string, string]
    >;
    expect(query[0][1]).toBe('project-1');
    expect(query[0][2]).toBe('company-1');
    expect(f.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a foreign or missing explicit/default project before balance or write', async () => {
    const f = fixture();
    f.queryRaw.mockResolvedValue([]);
    await expect(
      f.service.createMovement(actor, { ...body, projectId: 'foreign' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    f.prisma.warehouse.findFirst.mockResolvedValue({
      id: 'warehouse-1',
      projectId: 'foreign',
    });
    await expect(f.service.createMovement(actor, body)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(f.aggregate).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.audit.write).not.toHaveBeenCalled();
  });

  it('replays an existing legacy key before project revalidation', async () => {
    const f = fixture();
    f.movement.projectId = 'foreign';
    f.findFirst.mockResolvedValue(f.movement);
    const result = await f.service.createMovement(actor, body);
    expect(result.projectId).toBe('foreign');
    expect(f.queryRaw).not.toHaveBeenCalled();
    expect(f.prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('checks the key again inside the transaction and skips a duplicate audit', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(f.movement);
    const result = await f.service.createMovement(actor, body);
    expect(result.id).toBe(f.movement.id);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.aggregate).not.toHaveBeenCalled();
    expect(f.audit.write).not.toHaveBeenCalled();
  });
  it('retries raw PostgreSQL serialization errors but not unrelated raw errors', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('serialization failure', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
      }),
    );
    await f.service.createMovement(actor, { ...body, projectId: 'project-1' });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.create).toHaveBeenCalledTimes(1);
    const other = fixture();
    other.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('other', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
      }),
    );
    await expect(
      other.service.createMovement(actor, body),
    ).rejects.toMatchObject({ code: 'P2010' });
    expect(other.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded conflict after repeated raw serialization failures', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('serialization failure', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '40001' },
      }),
    );
    await expect(f.service.createMovement(actor, body)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.audit.write).not.toHaveBeenCalled();
  });

  it('replays the winning row after a concurrent unique-key race', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(f.movement);
    f.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique race', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await f.service.createMovement(actor, body);
    expect(result.id).toBe(f.movement.id);
    expect(f.findFirst).toHaveBeenLastCalledWith({
      where: { companyId: 'company-1', idempotencyKey: key },
    });
    expect(f.audit.write).not.toHaveBeenCalled();
  });

  it('does not turn an unrelated unique error into a replay', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('other unique error', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(f.service.createMovement(actor, body)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(f.audit.write).not.toHaveBeenCalled();
  });
});
