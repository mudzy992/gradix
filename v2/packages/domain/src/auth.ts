/**
 * Pravila sesije i tokena — čista logika, bez frameworka i bez baze.
 *
 * Model (ADR 0005, pojednostavljen u odnosu na v1 D-059):
 *  - access token: kratkotrajan JWT, nosi `sub` (korisnik) i `sid` (sesija)
 *  - refresh token: neprozirni slučajni string; u bazi samo SHA-256 hash
 *  - rotacija na svaki refresh; ponovna upotreba opozvanog tokena gasi sesije korisnika
 *  - NEMA replay prozora, generacija ni HMAC lanaca (B6.16: prekomjerno složeno)
 */

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
export const REFRESH_TTL_SECONDS = REFRESH_TTL_DAYS * 24 * 60 * 60;

export type SessionState = {
  expiresAt: Date;
  revokedAt: Date | null;
};

export type RefreshDecision =
  | { kind: "rotate" }
  | { kind: "reject"; code: "AUTH_REFRESH_INVALID" }
  | { kind: "reuse"; code: "AUTH_REFRESH_REUSE" };

/**
 * Odluka o refresh-u. Redoslijed je namjeran:
 * opozvan token je PONOVNA UPOTREBA (sigurnosni signal), a ne samo "nevažeći".
 */
export function decideRefresh(session: SessionState | null, now: Date): RefreshDecision {
  if (!session) return { kind: "reject", code: "AUTH_REFRESH_INVALID" };
  if (session.revokedAt !== null) return { kind: "reuse", code: "AUTH_REFRESH_REUSE" };
  if (session.expiresAt.getTime() <= now.getTime()) {
    return { kind: "reject", code: "AUTH_REFRESH_INVALID" };
  }
  return { kind: "rotate" };
}

export function refreshExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000);
}

/** Sesija je upotrebljiva za pristup ako nije opozvana i nije istekla. */
export function isSessionUsable(session: SessionState, now: Date): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
}

/** Token koji se šalje klijentu mora imati dovoljno entropije. */
export const REFRESH_TOKEN_BYTES = 48;

export function isValidRefreshTokenFormat(token: string): boolean {
  // base64url od 48 bajtova = 64 znaka bez paddinga.
  return /^[A-Za-z0-9_-]{64}$/.test(token);
}
