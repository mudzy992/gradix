import { evaluateRefreshToken } from './auth-token-rules';

const future = new Date('2999-01-01T00:00:00Z');
const past = new Date('2000-01-01T00:00:00Z');
const now = new Date('2026-11-02T12:00:00Z');

const activeOwner = {
  isActive: true,
  roles: ['WORKER'],
  company: { isActive: true },
};
const token = (
  overrides: Partial<{ expiresAt: Date; revokedAt: Date | null }> = {},
) => ({
  expiresAt: future,
  revokedAt: null,
  ...overrides,
});

describe('evaluateRefreshToken', () => {
  it('vraća ok za važeći token i aktivnog korisnika', () => {
    expect(evaluateRefreshToken(token(), activeOwner, now)).toBe('ok');
  });

  it('nepostojeći token je invalid (ne odaje ništa o korisniku)', () => {
    expect(evaluateRefreshToken(null, activeOwner, now)).toBe('invalid');
    expect(evaluateRefreshToken(undefined, null, now)).toBe('invalid');
  });

  it('već rotiran token je reuse (i to prije provjere isteka)', () => {
    expect(
      evaluateRefreshToken(
        token({ revokedAt: past, expiresAt: past }),
        activeOwner,
        now,
      ),
    ).toBe('reuse');
  });

  it('istekli token je invalid', () => {
    expect(
      evaluateRefreshToken(token({ expiresAt: past }), activeOwner, now),
    ).toBe('invalid');
  });

  it('deaktiviran korisnik ne može osvježiti pristup', () => {
    expect(
      evaluateRefreshToken(token(), { ...activeOwner, isActive: false }, now),
    ).toBe('inactive');
  });

  it('ugašena firma ne može osvježiti pristup', () => {
    expect(
      evaluateRefreshToken(
        token(),
        { ...activeOwner, company: { isActive: false } },
        now,
      ),
    ).toBe('company-inactive');
  });

  it('korisnik bez rola je odbijen', () => {
    expect(
      evaluateRefreshToken(token(), { ...activeOwner, roles: [] }, now),
    ).toBe('no-roles');
  });

  it('PLATFORM_ADMIN prolazi i kad je njegova firma ugašena (kao JwtStrategy)', () => {
    expect(
      evaluateRefreshToken(
        token(),
        {
          isActive: true,
          roles: ['PLATFORM_ADMIN'],
          company: { isActive: false },
        },
        now,
      ),
    ).toBe('ok');
  });

  it('korisnik bez firme (platform admin) prolazi', () => {
    expect(
      evaluateRefreshToken(
        token(),
        { isActive: true, roles: ['PLATFORM_ADMIN'], company: null },
        now,
      ),
    ).toBe('ok');
  });
});
