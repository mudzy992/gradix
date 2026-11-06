import {
  deriveRefreshSuccessor,
  isWithinRefreshReplayWindow,
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
    const first = deriveRefreshSuccessor(parent, secret);
    expect(first).toEqual(deriveRefreshSuccessor(parent, secret));
    expect(first).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(first).not.toBe(
      deriveRefreshSuccessor('other-parent-token', secret),
    );
    expect(first).not.toBe(
      deriveRefreshSuccessor(parent, 'other-test-secret-for-refresh'),
    );
  });
});
