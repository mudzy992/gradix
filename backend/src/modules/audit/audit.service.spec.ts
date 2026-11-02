// PrismaService se ne može učitati u sandboxu (nema generisanog klijenta) — DI token nam
// ovdje ne treba, dovoljna je strukturna zamjena.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AuditService } from './audit.service';

type Create = jest.Mock<Promise<unknown>, [{ data: unknown }]>;

function serviceWith(create: Create): AuditService {
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
  it('upisuje zapis sa datim podacima', async () => {
    const create: Create = jest.fn().mockResolvedValue({});
    await serviceWith(create).write(input);
    expect(create).toHaveBeenCalledWith({ data: input });
  });

  it('pad audita ne baca grešku (poslovna operacija je već committed)', async () => {
    const create: Create = jest
      .fn()
      .mockRejectedValue(new Error('FK violation'));
    await expect(serviceWith(create).write(input)).resolves.toBeUndefined();
  });

  it('greška se loguje, a ne gutа tiho', async () => {
    const create: Create = jest
      .fn()
      .mockRejectedValue(new Error('FK violation'));
    const service = serviceWith(create);
    const spy = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await service.write(input);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('USER_CREATED');
  });
});
