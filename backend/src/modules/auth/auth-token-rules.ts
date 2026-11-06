// BE-02 — čista pravila za refresh token, bez Prisma zavisnosti (lako se testiraju).
// Servis (`AuthTokensService.rotate`) samo prevodi odluku u grešku/rotaciju.

export type RefreshTokenState = {
  expiresAt: Date;
  revokedAt: Date | null;
};

export type TokenOwner = {
  isActive: boolean;
  /** Imena rola (`UserRoleAssignment.role`), npr. `['PLATFORM_ADMIN']`. */
  roles: readonly string[];
  company?: { isActive: boolean } | null;
};

const PLATFORM_ADMIN = 'PLATFORM_ADMIN';

export type RefreshVerdict =
  | 'ok'
  | 'reuse' // token je opozvan; servis provjerava D-059 replay i porodicu
  | 'invalid' // ne postoji ili je istekao
  | 'inactive' // korisnik deaktiviran
  | 'company-inactive' // firma ugašena
  | 'no-roles'; // korisnik bez ijedne role

/**
 * Odlučuje da li se refresh token smije zamijeniti novim parom.
 *
 * Redoslijed je namjeran: prvo provjera samog tokena (postoji/rotiran/istekao), pa tek onda
 * stanje korisnika — tako se za nevažeći token ne odaje ništa o korisniku.
 */
export function evaluateRefreshToken(
  token: RefreshTokenState | null | undefined,
  owner: TokenOwner | null | undefined,
  now: Date = new Date(),
): RefreshVerdict {
  if (!token) return 'invalid';
  if (token.revokedAt) return 'reuse';
  if (token.expiresAt.getTime() <= now.getTime()) return 'invalid';
  if (!owner) return 'invalid';
  if (!owner.isActive) return 'inactive';
  // Isto pravilo kao `JwtStrategy`: platform admin smije i kad je firma ugašena.
  if (
    owner.company &&
    !owner.company.isActive &&
    !owner.roles.includes(PLATFORM_ADMIN)
  ) {
    return 'company-inactive';
  }
  if (owner.roles.length === 0) return 'no-roles';
  return 'ok';
}
