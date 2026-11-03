jest.mock(
  '../../../generated/client',
  () => ({ Prisma: {}, PrismaClient: class {} }),
  { virtual: true },
);

import {
  assertPeriodSpan,
  calendarMonthRange,
  PAYROLL_MAX_SPAN_DAYS,
} from './payroll-period';

describe('payroll-period (BE-13)', () => {
  describe('calendarMonthRange', () => {
    it('vraća prvi i zadnji dan mjeseca', () => {
      expect(calendarMonthRange(2026, 11)).toEqual({
        from: '2026-11-01',
        to: '2026-11-30',
      });
      expect(calendarMonthRange(2026, 1)).toEqual({
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });

    it('prestupna godina i prelazak godine', () => {
      expect(calendarMonthRange(2024, 2).to).toBe('2024-02-29');
      expect(calendarMonthRange(2026, 2).to).toBe('2026-02-28');
      expect(calendarMonthRange(2026, 12)).toEqual({
        from: '2026-12-01',
        to: '2026-12-31',
      });
    });

    it('odbija neispravan mjesec i godinu van granica', () => {
      expect(() => calendarMonthRange(2026, 0)).toThrow(
        /Invalid year or month/,
      );
      expect(() => calendarMonthRange(2026, 13)).toThrow(
        /Invalid year or month/,
      );
      expect(() => calendarMonthRange(0, 5)).toThrow(/Invalid year or month/);
      expect(() => calendarMonthRange(99999, 5)).toThrow(
        /Invalid year or month/,
      );
      expect(() => calendarMonthRange(2026.5, 5)).toThrow(
        /Invalid year or month/,
      );
    });
  });

  describe('assertPeriodSpan', () => {
    it('dozvoljava godinu dana (366 dana), odbija duže', () => {
      expect(() => assertPeriodSpan('2026-01-01', '2026-12-31')).not.toThrow();
      expect(() => assertPeriodSpan('2024-01-01', '2024-12-31')).not.toThrow();
      expect(() => assertPeriodSpan('2025-01-01', '2026-12-31')).toThrow(
        new RegExp(`at most ${PAYROLL_MAX_SPAN_DAYS} days`),
      );
    });

    it('jedan dan je uvijek u redu', () => {
      expect(() => assertPeriodSpan('2026-11-03', '2026-11-03')).not.toThrow();
    });

    it('odbija nepostojeći datum (ne tiho prebacivanje)', () => {
      expect(() => assertPeriodSpan('2026-02-31', '2026-03-31')).toThrow(
        /Invalid date/,
      );
    });
  });
});
