import { SETTINGS_REGISTRY, coerceSettingValue, findSetting } from './registry';

const def = (key: string) => {
  const found = findSetting(key);
  if (!found) throw new Error(`nema ključa ${key}`);
  return found;
};

describe('SETTINGS_REGISTRY', () => {
  it('ključevi su jedinstveni', () => {
    const keys = SETTINGS_REGISTRY.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('default vrijednost odgovara tipu i granicama', () => {
    for (const item of SETTINGS_REGISTRY) {
      expect(typeof item.defaultValue).toBe(item.type);
      if (item.type === 'number') {
        const value = item.defaultValue as number;
        if (item.min !== undefined)
          expect(value).toBeGreaterThanOrEqual(item.min);
        if (item.max !== undefined) expect(value).toBeLessThanOrEqual(item.max);
      }
    }
  });

  it('findSetting vraća definiciju ili undefined', () => {
    expect(def('app.currency').defaultValue).toBe('BAM');
    expect(findSetting('nepostoji.key')).toBeUndefined();
  });
});

describe('coerceSettingValue', () => {
  it('boolean mora biti boolean (ne "true" string)', () => {
    expect(coerceSettingValue(def('features.email'), true)).toBe(true);
    expect(() => coerceSettingValue(def('features.email'), 'true')).toThrow(
      /must be boolean/,
    );
  });

  it('number poštuje min/max', () => {
    const radius = def('geofence.defaultRadiusM');
    expect(coerceSettingValue(radius, 250)).toBe(250);
    expect(() => coerceSettingValue(radius, 9)).toThrow(/below min/);
    expect(() => coerceSettingValue(radius, 5001)).toThrow(/above max/);
  });

  it('NaN i Infinity nisu brojevi', () => {
    expect(() =>
      coerceSettingValue(def('timer.maxOpenHours'), Number.NaN),
    ).toThrow(/must be number/);
    expect(() =>
      coerceSettingValue(def('timer.maxOpenHours'), Number.POSITIVE_INFINITY),
    ).toThrow(/must be number/);
  });

  it('string ne prima broj ni boolean', () => {
    expect(coerceSettingValue(def('app.currency'), 'EUR')).toBe('EUR');
    expect(() => coerceSettingValue(def('app.currency'), 5)).toThrow(
      /must be string/,
    );
  });

  it('poruka sadrži ime ključa (lakše debugovanje)', () => {
    expect(() => coerceSettingValue(def('app.currency'), 5)).toThrow(
      /app\.currency/,
    );
  });
});
