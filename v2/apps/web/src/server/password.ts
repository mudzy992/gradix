/**
 * Lozinke: Argon2id (A3.3 / B7) + politika iz `@gradix/domain`.
 *
 * Hash je infrastruktura i paramtri su u kodu da ne ovise o okruženju; mijenjaju se ADR-om,
 * ne env varijablom (inače stara baza i novi server ne mogu provjeriti hash).
 *
 * PRAVILA (dužina, lista 10k, identitet, istorija) žive u `@gradix/domain` — jedan izvor za
 * web, mobilni, pozivnicu i reset. Ovaj modul dodaje samo ono što traži bazu: provjeru
 * ponovne upotrebe zadnje 3 lozinke i upis u istoriju.
 */
import argon2 from "argon2";
import type { PoolClient } from "pg";
import { checkPasswordPolicy as domainPolicy, PASSWORD_HISTORY_DEPTH } from "@gradix/domain";

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

/** Minimalna pravila bez identiteta — za mjesta gdje korisnik još nije poznat (login). */
export function checkPasswordPolicy(password: string): string | null {
  return domainPolicy({ password });
}

/**
 * Provjera ponovne upotrebe: novo ne smije biti jednako nijednoj od zadnje 3 lozinke.
 *
 * `users.password_hash` je jedna od njih (tekuća), a `password_history` čuva prethodne.
 * Zato je 3 = tekuća + 2 iz istorije, pa se iz istorije uzima `PASSWORD_HISTORY_DEPTH - 1`.
 * Namjerno se ne uzima više: svaki dodatni Argon2 verify je ~40 ms, a pravilo je fiksno.
 */
export async function isPasswordReused(
  client: PoolClient,
  userId: string,
  newPassword: string,
  currentHash: string,
): Promise<boolean> {
  if (await verifyPassword(currentHash, newPassword)) return true;
  const history = await client.query<{ password_hash: string }>(
    `SELECT password_hash FROM password_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, PASSWORD_HISTORY_DEPTH - 1],
  );
  for (const row of history.rows) {
    if (await verifyPassword(row.password_hash, newPassword)) return true;
  }
  return false;
}

/**
 * Upisuje novi hash u istoriju i održava pravilo „max 3“.
 *
 * Trim je OVDJE, a ne u triggeru: trigger bi tražio SECURITY DEFINER funkciju, a nova
 * izvršiva definer funkcija je nova površina napada za pravilo od tri reda. Servis je jedini
 * put pisanja u istoriju, pa je trim na tom mjestu dovoljan i vidi se u testu.
 */
export async function rememberPassword(
  client: PoolClient,
  userId: string,
  previousHash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO password_history (id, user_id, password_hash)
     VALUES (gen_random_uuid()::text, $1, $2)`,
    [userId, previousHash],
  );
  await client.query(
    `DELETE FROM password_history
      WHERE user_id = $1
        AND id NOT IN (
          SELECT id FROM password_history
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2
        )`,
    [userId, PASSWORD_HISTORY_DEPTH - 1],
  );
}
