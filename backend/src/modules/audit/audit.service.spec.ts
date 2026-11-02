import { Logger } from '@nestjs/common';

// PrismaService se ne može učitati u sandboxu (nema generisanog klijenta) — DI token nam
// ovdje ne treba, dovoljna je strukturna zamjena.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AuditService } from './audit.service';

function serviceWith(create: jest.Mock): AuditService {
  return new AuditService({ auditEvent: { create } } as never);
}

const input = {
  companyId: 'c1',
  actorId: 'u1',
  action: 'USER_CREATED' as const,
  entityType: 'User',
  entityId: 'u2',
  payload: { email: 'a@b.c' },
};

describe('AuditService.write', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('upisuje zapis sa datim podacima', async () => {
    const create = jest.fn().mockResolvedValue({});
    await serviceWith(create).write(input);
    expect(create).toHaveBeenCalledWith({ data: input });
  });

  it('pad audita ne baca grešku (poslovna operacija je već committed)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('FK violation'));
    await expect(serviceWith(create).write(input)).resolves.toBeUndefined();
  });

  it('greška se loguje sa akcijom i entitetom (nije tiho gutanje)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('FK violation'));
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await serviceWith(create).write(input);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('USER_CREATED');
  });
});
