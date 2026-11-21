jest.mock(
  '../../../generated/client',
  () => ({ Prisma: {}, PrismaClient: class {} }),
  { virtual: true },
);

import { EmailService } from './email.service';
import type { PrismaService } from '../prisma/prisma.service';

function serviceWith(settingValue: unknown): EmailService {
  const prisma = {
    setting: {
      findUnique: jest.fn().mockResolvedValue({ value: settingValue }),
    },
  } as unknown as PrismaService;
  return new EmailService(prisma);
}

describe('EmailService (BE-16 / B1 / D-013)', () => {
  it('bez `features.email` ne pokušava slanje', async () => {
    const service = serviceWith(undefined);
    await expect(
      service.trySend({
        companyId: 'c1',
        to: 'a@b.c',
        subject: 's',
        text: 't',
      }),
    ).resolves.toBe(false);
  });

  it('ni sa uključenim flagom ne tvrdi da je poslano (nema transporta)', async () => {
    const service = serviceWith(true);
    await expect(
      service.trySend({
        companyId: 'c1',
        to: 'a@b.c',
        subject: 's',
        text: 't',
      }),
    ).resolves.toBe(false);
  });

  it('isEnabled čita postavku firme', async () => {
    await expect(serviceWith(true).isEnabled('c1')).resolves.toBe(true);
    await expect(serviceWith(false).isEnabled('c1')).resolves.toBe(false);
  });
});
