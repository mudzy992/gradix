jest.mock(
  '../../../generated/client',
  () => ({
    Prisma: {
      Decimal: class {
        constructor(readonly value: number) {}
      },
    },
  }),
  { virtual: true },
);

import type { Prisma } from '../../../generated/client';
import { payrollAmount, payrollRate } from './payroll-amount';

const dec = (value: number) => value as unknown as Prisma.Decimal;

describe('payroll-amount (BE-14 / B12)', () => {
  describe('payrollRate', () => {
    it('koristi snapshot iz trenutka zatvaranja sesije', () => {
      expect(
        payrollRate({
          hourlyRateSnapshot: dec(20),
          user: { hourlyRate: dec(99) },
        }),
      ).toBe(20);
    });

    it('pada na trenutnu satnicu kad snapshota nema (stari redovi)', () => {
      expect(
        payrollRate({
          hourlyRateSnapshot: null,
          user: { hourlyRate: dec(20) },
        }),
      ).toBe(20);
    });

    it('vraća null kad nema ni snapshota ni satnice', () => {
      expect(
        payrollRate({ hourlyRateSnapshot: null, user: { hourlyRate: null } }),
      ).toBeNull();
    });

    it('snapshot 0 je mjerodavan i ne pada na satnicu korisnika', () => {
      expect(
        payrollRate({
          hourlyRateSnapshot: dec(0),
          user: { hourlyRate: dec(20) },
        }),
      ).toBe(0);
    });
  });

  describe('payrollAmount', () => {
    it('bez satnice nema iznosa', () => {
      const amount = payrollAmount(120, null) as unknown as { value: number };
      expect(amount.value).toBe(0);
    });
  });
});
