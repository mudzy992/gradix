import {
  calendarDateInTz,
  currentMonthRange,
  dateOnlyIso,
  parseDateOnly,
  tzDayUtcRange,
} from './company-tz';

const TZ = 'Europe/Sarajevo';

describe('calendarDateInTz', () => {
  it('računa kalendarski dan po vremenskoj zoni, ne po UTC-u', () => {
    // 23:30 UTC u januaru = 00:30 sljedećeg dana u Sarajevu (UTC+1).
    expect(calendarDateInTz(new Date('2026-01-15T23:30:00Z'), TZ)).toBe(
      '2026-01-16',
    );
    // 22:30 UTC u julu = 00:30 sljedećeg dana (UTC+2).
    expect(calendarDateInTz(new Date('2026-07-15T22:30:00Z'), TZ)).toBe(
      '2026-07-16',
    );
  });
});

describe('parseDateOnly', () => {
  it('prihvata samo YYYY-MM-DD', () => {
    expect(parseDateOnly('2026-11-02').toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    );
    expect(() => parseDateOnly('02.11.2026')).toThrow(/YYYY-MM-DD/);
    expect(() => parseDateOnly('2026-11-02T10:00:00Z')).toThrow(/YYYY-MM-DD/);
  });

  // BE-13 (F-04): nepostojeći datumi su ranije tiho „prebačeni“ na sljedeći mjesec.
  it('odbija datume koji ne postoje u kalendaru', () => {
    expect(() => parseDateOnly('2026-02-31')).toThrow(/Invalid date/);
    expect(() => parseDateOnly('2026-04-31')).toThrow(/Invalid date/);
    expect(() => parseDateOnly('2026-13-01')).toThrow(/Invalid date/);
    expect(() => parseDateOnly('2026-00-10')).toThrow(/Invalid date/);
    // 2026. nije prestupna — 29. februar ne postoji
    expect(() => parseDateOnly('2026-02-29')).toThrow(/Invalid date/);
    // 2024. jeste prestupna
    expect(parseDateOnly('2024-02-29').toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });
});

describe('tzDayUtcRange', () => {
  it('dan bez DST-a traje 24 h', () => {
    const { start, end } = tzDayUtcRange('2026-06-15', TZ);
    expect(start.toISOString()).toBe('2026-06-14T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-15T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
  });

  it('dan prelaska na ljetnje vrijeme traje 23 h', () => {
    // 29.03.2026. u 02:00 SEV → 03:00 CEST.
    const { start, end } = tzDayUtcRange('2026-03-29', TZ);
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * 3600 * 1000);
  });

  it('kraj opsega je isključiv i pokazuje na početak sljedećeg dana', () => {
    const { end } = tzDayUtcRange('2026-12-31', TZ);
    // 01.01.2027. 00:00 po lokalnom vremenu = 31.12.2026. 23:00 UTC (UTC+1 zimi).
    expect(end.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});

describe('currentMonthRange', () => {
  it('vraća prvi i zadnji dan mjeseca po lokalnoj zoni', () => {
    expect(currentMonthRange(new Date('2026-11-02T12:00:00Z'), TZ)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('prelazak godine (decembar)', () => {
    expect(currentMonthRange(new Date('2026-12-15T12:00:00Z'), TZ)).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('prvi dan mjeseca u 23:30 UTC još je prethodni mjesec po UTC-u', () => {
    expect(currentMonthRange(new Date('2026-01-31T23:30:00Z'), TZ)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('dateOnlyIso', () => {
  it('reže vrijeme iz Date-a', () => {
    expect(dateOnlyIso(new Date('2026-11-02T23:59:59Z'))).toBe('2026-11-02');
  });
});
