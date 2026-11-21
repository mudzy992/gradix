import { Prisma } from '../../../generated/client';
import { fuelTotalCost } from './serialize-fleet';

describe('fuel total cost', () => {
  it.each([
    ['0.001', '5', '0.01'],
    ['2.5', '1.23', '3.08'],
    ['1.001', '9990009990.00', '9999999999.99'],
    ['1', '9999999999.99', '9999999999.99'],
    ['999999999.999', '0', '0.00'],
  ])('rounds %s × %s to %s', (liters, price, expected) => {
    expect(
      fuelTotalCost(
        new Prisma.Decimal(liters),
        new Prisma.Decimal(price),
      ).toFixed(2),
    ).toBe(expected);
  });
  it('rejects an overflowing product after rounding', () => {
    expect(() =>
      fuelTotalCost(
        new Prisma.Decimal('1.001'),
        new Prisma.Decimal('9990009990.01'),
      ),
    ).toThrow('Fuel totalCost must fit numeric(12,2)');
  });
});
