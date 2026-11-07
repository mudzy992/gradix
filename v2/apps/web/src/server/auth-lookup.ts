/**
 * Uske „lookup“ transakcije za prijavu i refresh.
 *
 * Problem koji rješavaju: pri prijavi još ne znamo firmu (a `memberships` i `sessions`
 * su tenant tabele sa FORCE RLS), pa `withCompany` ne možemo koristiti. Rješenje je
 * namjenska RLS politika koja propušta red SAMO kad se poklopi tačan ključ pretrage
 * (`app.auth_lookup_user` / `app.auth_lookup_token`) — vidi migraciju
 * `definer_bypass_rls`.
 *
 * Pravila koja ovaj fajl čuva:
 *  - ključ se postavlja isključivo ovdje, nikad iz zahtjeva klijenta,
 *  - ključ živi samo unutar transakcije (`SET LOCAL`), pa ga sljedeći zahtjev na istoj
 *    konekciji iz pool-a ne može naslijediti,
 *  - opseg čitanja je najviše ono što funkcija ionako vraća za taj jedan parametar.
 */
import type { Pool, PoolClient } from "pg";

async function inLookupTransaction<T>(
  pool: Pool,
  setting: "app.auth_lookup_user" | "app.auth_lookup_token",
  value: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config($1, $2, true)", [setting, value]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Konekcija je mrtva; pool će je odbaciti. Ne maskiramo originalnu grešku.
    }
    throw error;
  } finally {
    client.release();
  }
}

export type MembershipRow = { company_id: string; roles: string[]; company_active: boolean };

/** Članstva jednog korisnika. Zvati SAMO nakon provjerene lozinke. */
export async function lookupMemberships(pool: Pool, userId: string): Promise<MembershipRow[]> {
  return inLookupTransaction(pool, "app.auth_lookup_user", userId, async (client) => {
    const result = await client.query<MembershipRow>(
      "SELECT company_id, roles::text[] AS roles, company_active FROM auth_memberships($1)",
      [userId],
    );
    return result.rows;
  });
}

export type SessionRow = {
  id: string;
  user_id: string;
  company_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};

/** Sesija po hashu refresh tokena. Hash posjeduje samo onaj ko ima token. */
export async function lookupSessionByHash(pool: Pool, tokenHash: string): Promise<SessionRow | null> {
  return inLookupTransaction(pool, "app.auth_lookup_token", tokenHash, async (client) => {
    const result = await client.query<SessionRow>(
      "SELECT id, user_id, company_id, expires_at, revoked_at FROM auth_session_by_hash($1)",
      [tokenHash],
    );
    return result.rows[0] ?? null;
  });
}
