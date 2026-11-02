import {
  assertGeofenceRadius,
  assertPlannedRange,
  normalizeMachineCode,
  normalizeProjectCode,
  parseOptionalDate,
} from './ops-dates';

describe('assertPlannedRange', () => {
  it('dozvoljava prazne vrijednosti i ispravan opseg', () => {
    expect(() => assertPlannedRange(undefined, undefined)).not.toThrow();
    expect(() =>
      assertPlannedRange(new Date('2026-01-01'), new Date('2026-01-01')),
    ).not.toThrow();
  });

  it('odbija kraj prije početka', () => {
    expect(() =>
      assertPlannedRange(new Date('2026-02-01'), new Date('2026-01-31')),
    ).toThrow(/plannedEnd/);
  });
});

describe('assertGeofenceRadius', () => {
  it('granice su uključive (10 i 5000)', () => {
    expect(() => assertGeofenceRadius(10)).not.toThrow();
    expect(() => assertGeofenceRadius(5000)).not.toThrow();
  });

  it('van granica pada', () => {
    expect(() => assertGeofenceRadius(9)).toThrow(/geofenceRadius/);
    expect(() => assertGeofenceRadius(5001)).toThrow(/geofenceRadius/);
  });
});

describe('normalizeProjectCode / normalizeMachineCode', () => {
  it('trimuje i diže na velika slova', () => {
    expect(normalizeProjectCode('  ab-12 ')).toBe('AB-12');
    expect(normalizeMachineCode(' m-7')).toBe('M-7');
  });

  it('prazno je null', () => {
    expect(normalizeProjectCode('   ')).toBeNull();
    expect(normalizeMachineCode(null)).toBeNull();
  });

  it('neispravan format pada', () => {
    expect(() => normalizeProjectCode('pre dugacak kod!')).toThrow(/Invalid/);
    expect(() => normalizeMachineCode('žčć')).toThrow(/Invalid/);
  });
});

describe('parseOptionalDate', () => {
  it('prazno → undefined', () => {
    expect(parseOptionalDate()).toBeUndefined();
    expect(parseOptionalDate('')).toBeUndefined();
  });

  it('ispravan datum prolazi, neispravan pada', () => {
    expect(parseOptionalDate('2026-05-01').toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
    expect(() => parseOptionalDate('nije datum')).toThrow(/Invalid date/);
  });
});
