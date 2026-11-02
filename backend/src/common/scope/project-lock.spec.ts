import type { ProjectStatus } from '../../../generated/client';
import {
  assertNotOnHold,
  assertProjectWritable,
  assertStatusTransition,
} from './project-lock';

describe('assertStatusTransition', () => {
  it('dozvoljeni prelazi', () => {
    expect(() =>
      assertStatusTransition('PLANNING', 'IN_PROGRESS'),
    ).not.toThrow();
    expect(() =>
      assertStatusTransition('IN_PROGRESS', 'ON_HOLD'),
    ).not.toThrow();
    expect(() =>
      assertStatusTransition('ON_HOLD', 'IN_PROGRESS'),
    ).not.toThrow();
    expect(() =>
      assertStatusTransition('IN_PROGRESS', 'COMPLETED'),
    ).not.toThrow();
  });

  it('isti status je no-op', () => {
    expect(() =>
      assertStatusTransition('COMPLETED', 'COMPLETED'),
    ).not.toThrow();
  });

  it('terminalni statusi se ne mijenjaju', () => {
    expect(() => assertStatusTransition('COMPLETED', 'IN_PROGRESS')).toThrow(
      /Cannot transition/,
    );
    expect(() => assertStatusTransition('CANCELLED', 'PLANNING')).toThrow(
      /Cannot transition/,
    );
  });

  it('ne preskače se nazad u PLANNING', () => {
    expect(() => assertStatusTransition('IN_PROGRESS', 'PLANNING')).toThrow();
    expect(() => assertStatusTransition('ON_HOLD', 'PLANNING')).toThrow();
  });
});

describe('assertProjectWritable', () => {
  const status = (value: ProjectStatus) => ({
    status: value,
    archivedAt: null,
  });

  it('aktivan projekat je upisiv', () => {
    expect(() => assertProjectWritable(status('IN_PROGRESS'))).not.toThrow();
    expect(() => assertProjectWritable(status('PLANNING'))).not.toThrow();
  });

  it('terminalan ili arhiviran nije upisiv', () => {
    expect(() => assertProjectWritable(status('COMPLETED'))).toThrow(
      /terminal/,
    );
    expect(() => assertProjectWritable(status('CANCELLED'))).toThrow(
      /terminal/,
    );
    expect(() =>
      assertProjectWritable({ status: 'IN_PROGRESS', archivedAt: new Date() }),
    ).toThrow(/terminal/);
  });
});

describe('assertNotOnHold', () => {
  it('blokira samo ON_HOLD', () => {
    expect(() => assertNotOnHold({ status: 'ON_HOLD' })).toThrow(/on hold/);
    expect(() => assertNotOnHold({ status: 'IN_PROGRESS' })).not.toThrow();
  });
});
