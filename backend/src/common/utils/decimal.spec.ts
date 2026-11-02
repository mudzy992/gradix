import { parseDecimalString, parseNonNegativeDecimal } from './decimal';

describe('parseDecimalString', () => {
  it('prihvata cijele i decimalne vrijednosti', () => {
    expect(parseDecimalString('10', 'qty')).toBe('10');
    expect(parseDecimalString('10.5', 'qty')).toBe('10.5');
    expect(parseDecimalString(' 0.125 ', 'qty')).toBe('0.125');
    expect(parseDecimalString('-3.25', 'qty')).toBe('-3.25');
  });

  it('odbija tekst, prazno i previše decimala', () => {
    for (const bad of [
      'abc',
      '',
      ' ',
      '1,5',
      '1.2.3',
      '1.23456',
      '10e3',
      '--1',
    ]) {
      expect(() => parseDecimalString(bad, 'qty')).toThrow(/decimal number/);
    }
  });

  it('greška imenuje polje i ima status 400', () => {
    try {
      parseDecimalString('x', 'plannedQty');
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400);
      expect(String((error as Error).message)).toContain('plannedQty');
    }
  });
});

describe('parseNonNegativeDecimal', () => {
  it('pušta nulu i pozitivne', () => {
    expect(parseNonNegativeDecimal('0', 'plannedBudget')).toBe('0');
    expect(parseNonNegativeDecimal('1250.50', 'plannedBudget')).toBe('1250.50');
  });

  it('odbija negativan budžet', () => {
    expect(() => parseNonNegativeDecimal('-1', 'plannedBudget')).toThrow(
      /must not be negative/,
    );
  });
});
