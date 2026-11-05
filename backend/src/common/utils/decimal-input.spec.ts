import {
  parseDecimal,
  parseNonNegativeDecimal,
  parseNonNegativeMoney,
  parseNonZeroDecimal,
  parsePositiveDecimal,
  parsePositiveQuantity,
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
    parseNonNegativeMoney,
    parseNonZeroDecimal,
    parsePositiveDecimal,
    parsePositiveQuantity,
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
  it.each([
    ['0', '0'],
    ['-0', '0'],
    ['0e-999999999999999999', '0'],
    ['0x0p-999999999999999999', '0'],
    ['0.0100', '0.01'],
    ['1e-2', '0.01'],
    ['9999999999.990', '9999999999.99'],
    ['1_000.00', '1000'],
    ['0x1', '1'],
  ])('accepts exact nonnegative money %s', (value, expected) => {
    expect(parseNonNegativeMoney(value, 'amount').toString()).toBe(expected);
  });

  it.each([
    '-0.01',
    '-1e-999999999999999999',
    '1e-999999999999999999',
    '0x1p-999999999999999999',
    '-0b1p-999999999999999999',
    '0o1p-999999999999999999',
    '0x0.ep-999999999999999999',
    '0.001',
    '0.005',
    '1e-3',
    '9999999999.999',
    '10000000000',
    '1e999999999999999999',
    'NaN',
    'Infinity',
  ])('rejects negative, underflow, inexact or oversized money %s', (value) => {
    expect(
      errorFrom(() => parseNonNegativeMoney(value, 'amount')),
    ).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
  });
  it.each([
    ['0.001', '0.001'],
    ['1e-3', '0.001'],
    ['1.23000', '1.23'],
    ['999999999.999', '999999999.999'],
  ])('accepts exact positive quantity %s', (value, expected) => {
    expect(parsePositiveQuantity(value, 'liters').toString()).toBe(expected);
  });
  it.each(['0', '-1', '0.0005', '1e-4', '1e-999999999999999999', '1000000000'])(
    'rejects invalid or inexact positive quantity %s',
    (value) => {
      expect(
        errorFrom(() => parsePositiveQuantity(value, 'liters')),
      ).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    },
  );
});
