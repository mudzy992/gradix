/**
 * Lozinke: Argon2id (A3.3 / B7). Parametri su u kodu da ne ovise o okruženju;
 * mijenjaju se ADR-om, ne env varijablom (inače stara baza i novi server ne mogu provjeriti hash).
 */
import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP minimum za Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Neispravan/odsječen hash nije izuzetak koji smije srušiti zahtjev.
    return false;
  }
}

/** Minimalna pravila; poruke su za korisnika, ne za programera. */
export function checkPasswordPolicy(password: string): string | null {
  if (password.length < 10) return "Lozinka mora imati najmanje 10 znakova.";
  if (password.length > 200) return "Lozinka je predugačka.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Lozinka mora sadržavati slovo i broj.";
  }
  return null;
}
