import {
  parseDecimal,
  parseNonNegativeDecimal,
  parseNonNegativeMoney,
  parseNonZeroDecimal,
  parsePositiveDecimal,
  parsePositiveQuantity,
} from './decimal-input';
import { parseLatLng } from './geo';
import { parseDiaryTemp } from '../../modules/ops/diary-access';

// Characterization of the shared parser used by each input, not a substitute for
// endpoint/DTO/DB tests. In particular, stock applies additional service limits.
type Kind =
  | 'plain'
  | 'nonnegative'
  | 'positive'
  | 'nonzero'
  | 'money'
  | 'quantity'
  | 'lat'
  | 'lng'
  | 'temp';
type Field = {
  id: string;
  kind: Kind;
  max: string;
  overflow: string;
  overflowAccepted: boolean;
  negativeAccepted: boolean;
};
const numeric12_2 = { max: '9999999999.99', overflow: '10000000000' };
const numeric12_3 = { max: '999999999.999', overflow: '1000000000' };
const fields: Field[] = [];
const add = (
  ids: string[],
  kind: Kind,
  limits: { max: string; overflow: string },
  overflowAccepted: boolean,
  negativeAccepted: boolean,
) => {
  fields.push(
    ...ids.map((id) => ({
      id,
      kind,
      ...limits,
      overflowAccepted,
      negativeAccepted,
    })),
  );
};
add(
  [
    'projects.POST.plannedBudget',
    'projects.PATCH.plannedBudget',
    'tenders.POST.submittedValue',
    'tenders.PATCH.submittedValue',
    'services.complete.totalCost',
  ],
  'nonnegative',
  numeric12_2,
  true,
  false,
);
add(
  ['quantities.POST.plannedQty', 'quantities.PATCH.plannedQty'],
  'nonnegative',
  numeric12_3,
  true,
  false,
);
add(
  ['quantities.POST.executedQty', 'quantities.PATCH.executedQty'],
  'plain',
  numeric12_3,
  true,
  true,
);
add(
  [
    'trips.POST.quantity',
    'trips.POST.weighQty',
    'sync.TRIP.quantity',
    'sync.TRIP.weighQty',
    'amendments.TRIP.quantity',
    'amendments.TRIP.weighQty',
  ],
  'positive',
  numeric12_3,
  true,
  false,
);
add(
  ['fuel.POST.liters', 'sync.FUEL.liters', 'amendments.FUEL.liters'],
  'quantity',
  numeric12_3,
  false,
  false,
);
add(
  [
    'fuel.POST.unitPrice',
    'sync.FUEL.unitPrice',
    'amendments.FUEL.unitPrice',
    'cost-entries.POST.amount',
  ],
  'money',
  numeric12_2,
  false,
  false,
);
add(['stock-movements.POST.qty'], 'nonzero', numeric12_3, true, true);
add(
  ['locations.me.accuracyM'],
  'plain',
  { max: '999999.99', overflow: '1000000' },
  true,
  true,
);
add(
  [
    'diary.POST.tempMin',
    'diary.POST.tempMax',
    'diary.PATCH.tempMin',
    'diary.PATCH.tempMax',
    'sync.DIARY.tempMin',
    'sync.DIARY.tempMax',
    'sync.resolve.incoming.tempMin',
    'sync.resolve.incoming.tempMax',
  ],
  'temp',
  { max: '100', overflow: '100.1' },
  false,
  true,
);
for (const [endpoint, prefixes] of [
  ['trips.POST', ['origin', 'dest']],
  ['trips.complete', ['dest']],
  ['sync.TRIP', ['origin', 'dest']],
  ['locations.me', ['']],
  ['locations.geofence-check', ['']],
  ['machines.location', ['']],
  ['iot.gps', ['']],
  ['incidents.POST', ['']],
  ['diary.photos.POST', ['']],
  ['sync.PHOTO', ['']],
  ['depots.POST', ['']],
  ['depots.PATCH', ['']],
] as const) {
  for (const prefix of prefixes) {
    const lat = prefix ? `${prefix}Lat` : 'lat';
    const lng = prefix ? `${prefix}Lng` : 'lng';
    add(
      [`${endpoint}.${lat}`],
      'lat',
      { max: '90', overflow: '90.0000001' },
      false,
      true,
    );
    add(
      [`${endpoint}.${lng}`],
      'lng',
      { max: '180', overflow: '180.0000001' },
      false,
      true,
    );
  }
}
add(
  [
    'projects.POST.lat',
    'projects.POST.lng',
    'projects.PATCH.lat',
    'projects.PATCH.lng',
    'timer.start.lat',
    'timer.start.lng',
    'sync.TIMER.lat',
    'sync.TIMER.lng',
  ],
  'plain',
  { max: '999.9999999', overflow: '1000' },
  true,
  true,
);
add(
  ['users.POST.hourlyRate', 'users.PATCH.hourlyRate'],
  'plain',
  numeric12_2,
  true,
  true,
);

function scaleFor(field: Field): number {
  return field.kind === 'lat' ||
    field.kind === 'lng' ||
    field.max === '999.9999999'
    ? 7
    : field.kind === 'temp'
      ? 1
      : field.kind === 'money' ||
          field.max === numeric12_2.max ||
          field.id === 'locations.me.accuracyM'
        ? 2
        : 3;
}
function parse(field: Field, value: string) {
  const scale = scaleFor(field);
  switch (field.kind) {
    case 'plain':
      return parseDecimal(value, 'field', scale);
    case 'nonnegative':
      return parseNonNegativeDecimal(value, 'field', scale);
    case 'positive':
      return parsePositiveDecimal(value, 'field', scale);
    case 'nonzero':
      return parseNonZeroDecimal(value, 'field', scale);
    case 'money':
      return parseNonNegativeMoney(value, 'field');
    case 'quantity':
      return parsePositiveQuantity(value, 'field');
    case 'lat':
      return parseLatLng(value, '0').lat;
    case 'lng':
      return parseLatLng('0', value).lng;
    case 'temp':
      return parseDiaryTemp(value, 'field');
  }
}

describe('decimal field parser characterization (F-CI-05-64)', () => {
  it.each(fields)(
    '$id: underflow, boundary, overflow, zeros, sign and non-finite',
    (field) => {
      const read = (value: string) => parse(field, value);
      expect(() => read('1e-999999999999999999')).toThrow();
      expect(read(field.max)?.toString()).toBe(field.max);
      if (field.overflowAccepted)
        expect(read(field.overflow)?.toString()).toBe(field.overflow);
      else expect(() => read(field.overflow)).toThrow();
      expect(read('1.0000')?.toString()).toBe('1');
      const excessivePrecision = `0.${'0'.repeat(scaleFor(field))}1`;
      try {
        read(excessivePrecision);
        throw new Error('excess precision accepted');
      } catch (error) {
        expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect((error as Error).message).toMatch(
          /decimal places|without rounding/,
        );
      }
      expect(read('1.000000000')?.toString()).toBe('1');
      if (field.negativeAccepted) expect(read('-1')?.toString()).toBe('-1');
      else expect(() => read('-1')).toThrow();
      for (const nonfinite of ['NaN', 'Infinity', '-Infinity'])
        expect(() => read(nonfinite)).toThrow();
    },
  );
});
