import {
  parseDecimal,
  parseNonNegativeDecimal,
  parseNonZeroDecimal,
  parsePositiveDecimal,
} from './decimal-input';

function errorFrom(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe('decimal input', () => {
  const parsers = [
    parseDecimal,
    parseNonNegativeDecimal,
    parseNonZeroDecimal,
    parsePositiveDecimal,
  ];

  it.each([
    'NaN',
    'Infinity',
    '+Infinity',
    '-Infinity',
    '1e999999999999999999',
    '-1e999999999999999999',
    '',
    'abc',
    '1,2',
  ])(
    'rejects invalid or non-finite value %s in every decimal helper',
    (value) => {
      for (const parse of parsers) {
        expect(errorFrom(() => parse(value, 'amount'))).toMatchObject({
          code: 'VALIDATION_FAILED',
          status: 400,
          message: 'amount must be a decimal',
        });
      }
    },
  );

  it('keeps finite decimal precision and supported exponent notation', () => {
    expect(parseDecimal('-123456789.00100', 'qty').toString()).toBe(
      '-123456789.001',
    );
    expect(parsePositiveDecimal('1e-3', 'qty').toString()).toBe('0.001');
    expect(parseNonNegativeDecimal('0', 'amount').toString()).toBe('0');
  });

  it('preserves the sign and zero contracts of the specialized helpers', () => {
    expect(parseNonZeroDecimal('-0.0005', 'qty').toString()).toBe('-0.0005');
    expect(errorFrom(() => parseNonZeroDecimal('-0', 'qty'))).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(errorFrom(() => parsePositiveDecimal('0', 'qty'))).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(
      errorFrom(() => parseNonNegativeDecimal('-0.1', 'qty')),
    ).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });
});
