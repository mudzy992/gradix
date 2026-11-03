// Minimalna zamjena za `Prisma.Decimal` (u pješčaniku nema generisanog klijenta).
// U CI-ju se takođe koristi ova klasa — poređenja su numerička, kao u decimal.js.
class FakeDecimal {
  private readonly value: number;

  constructor(input: number | string) {
    this.value = Number(input);
  }

  isNaN(): boolean {
    return Number.isNaN(this.value);
  }

  lt(other: number): boolean {
    return this.value < other;
  }

  lte(other: number): boolean {
    return this.value <= other;
  }

  gt(other: number): boolean {
    return this.value > other;
  }

  toString(): string {
    return String(this.value);
  }
}

jest.mock(
  '../../../generated/client',
  () => ({ Prisma: { Decimal: FakeDecimal } }),
  { virtual: true },
);

import { AppError } from '../errors/app-error';
import { assertLatLng, parseLatLng } from './geo';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as AppError).code;
  }
  return undefined;
}

describe('parseLatLng', () => {
  it('prihvata normalne koordinate i vraća Decimal', () => {
    const { lat, lng } = parseLatLng('43.8563', '18.4131');
    expect(lat.toString()).toBe('43.8563');
    expect(lng.toString()).toBe('18.4131');
  });

  it('prihvata granične vrijednosti (±90, ±180)', () => {
    expect(() => parseLatLng('90', '180')).not.toThrow();
    expect(() => parseLatLng('-90', '-180')).not.toThrow();
  });

  it('odbija lat van opsega', () => {
    expect(codeOf(() => parseLatLng('90.0001', '18'))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => parseLatLng('-91', '18'))).toBe('VALIDATION_FAILED');
  });

  it('odbija lng van opsega', () => {
    expect(codeOf(() => parseLatLng('43', '180.5'))).toBe('VALIDATION_FAILED');
  });

  it('odbija smeće umjesto broja', () => {
    expect(codeOf(() => parseLatLng('abc', '18'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseLatLng('43', 'NaN'))).toBe('VALIDATION_FAILED');
  });
});

describe('assertLatLng', () => {
  it('propušta ispravan par', () => {
    const { lat, lng } = parseLatLng('44.2', '17.9');
    expect(() => assertLatLng(lat, lng)).not.toThrow();
  });
});
