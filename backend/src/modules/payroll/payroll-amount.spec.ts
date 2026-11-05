import { Prisma } from '../../../generated/client';
import { payrollAmount, payrollRate } from './payroll-amount';

const dec = (value: number) => new Prisma.Decimal(value);

describe('payroll-amount (BE-14 / B12)', () => {
  describe('payrollRate', () => {
    it('koristi snapshot iz trenutka zatvaranja sesije', () => {
      const snapshot = dec(20);
      expect(
        payrollRate({
          hourlyRateSnapshot: snapshot,
          user: { hourlyRate: dec(99) },
        }),
      ).toBe(snapshot);
    });
    it('pada na trenutnu satnicu kad snapshota nema (stari redovi)', () => {
      const rate = dec(20);
      expect(
        payrollRate({ hourlyRateSnapshot: null, user: { hourlyRate: rate } }),
      ).toBe(rate);
    });
    it('vraća null kad nema ni snapshota ni satnice', () => {
      expect(
        payrollRate({ hourlyRateSnapshot: null, user: { hourlyRate: null } }),
      ).toBeNull();
    });
    it('snapshot 0 je mjerodavan i ne pada na satnicu korisnika', () => {
      const snapshot = dec(0);
      expect(
        payrollRate({
          hourlyRateSnapshot: snapshot,
          user: { hourlyRate: dec(20) },
        }),
      ).toBe(snapshot);
    });
  });
  describe('payrollAmount', () => {
    it('bez satnice nema iznosa', () => {
      expect(payrollAmount(120, null).toFixed(2)).toBe('0.00');
    });
    it('računa sate i zaokružuje na dvije decimale', () => {
      expect(payrollAmount(90, dec(10.01)).toFixed(2)).toBe('15.02');
    });
  });
});
