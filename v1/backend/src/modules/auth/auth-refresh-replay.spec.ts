import {
  deriveRefreshSuccessor,
  isWithinRefreshReplayWindow,
  safeRefreshHashEqual,
} from './auth-refresh-replay';

describe('refresh replay primitives', () => {
  it.each([
    [-1, false],
    [0, true],
    [1, true],
    [19_999, true],
    [20_000, false],
    [20_001, false],
  ])(
    'accepts only non-negative elapsed time strictly below 20s (%i)',
    (age, expected) => {
      expect(
        isWithinRefreshReplayWindow(
          new Date(1_000_000),
          new Date(1_000_000 + age),
        ),
      ).toBe(expected);
    },
  );
  it('derives a stable, domain-separated 48-byte opaque successor bound to parent and secret', () => {
    const parent = 'random-parent-token';
    const secret = 'test-secret-for-refresh-derivation';
    const first = deriveRefreshSuccessor(parent, secret, 'family-1', 0);
    expect(first).toEqual(
      deriveRefreshSuccessor(parent, secret, 'family-1', 0),
    );
    expect(first).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(first).not.toBe(
      deriveRefreshSuccessor('other-parent-token', secret, 'family-1', 0),
    );
    expect(first).not.toBe(
      deriveRefreshSuccessor(
        parent,
        'other-test-secret-for-refresh',
        'family-1',
        0,
      ),
    );
    expect(first).not.toBe(
      deriveRefreshSuccessor(parent, secret, 'family-2', 0),
    );
    expect(first).not.toBe(
      deriveRefreshSuccessor(parent, secret, 'family-1', 1),
    );
  });
  it('compares only valid fixed-size hashes using timingSafeEqual', () => {
    const hash = 'ab'.repeat(32);
    expect(safeRefreshHashEqual(hash, hash)).toBe(true);
    expect(safeRefreshHashEqual(hash, 'ab'.repeat(31) + 'ac')).toBe(false);
    expect(safeRefreshHashEqual(hash, 'garbage')).toBe(false);
  });
});
