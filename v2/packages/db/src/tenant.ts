/**
 * Tenant scope: JEDNO mjesto gdje upit dobija firmu (A3.3.1).
 *
 * Pravilo: pozivni kod nikad ne piše `WHERE company_id = ...` ručno. Sve ide kroz
 * `withCompany`, koji u ISTOJ transakciji:
 *   1. postavlja `app.company_id` kao SET LOCAL (RLS čita tu vrijednost),
 *   2. izvršava posao.
 *
 * Zašto transakcija: `SET LOCAL` živi samo do kraja transakcije. Da postavljamo
 * varijablu na sesiji, sljedeći zahtjev koji dobije istu konekciju iz pool-a
 * naslijedio bi tuđu firmu — najgori mogući bug u multi-tenant sistemu.
 *
 * Zašto RLS pored ovoga: ako neko ipak napiše upit bez scope-a, baza ne vraća tuđe redove.
 * Dubinska zaštita, ne zamjena za disciplinu (ADR 0003).
 */
import type { Pool, PoolClient } from "pg";

export type CompanyId = string & { readonly __brand: "CompanyId" };

export function companyId(value: string): CompanyId {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error(`Neispravan companyId: "${value}"`);
  }
  return value as CompanyId;
}

/** Postavlja tenant za trajanje transakcije. Ne otvara i ne zatvara transakciju. */
export async function setTenant(client: PoolClient, id: CompanyId): Promise<void> {
  // set_config sa parametrima, ne string concatenation — nema injekcije.
  await client.query("SELECT set_config('app.company_id', $1, true)", [id]);
}

/**
 * Izvršava `fn` u transakciji sa postavljenim tenantom.
 * `fn` dobija klijenta — svi upiti unutar njega su tenant-scope-ovani u bazi.
 */
export async function withCompany<T>(
  pool: Pool,
  id: CompanyId,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenant(client, id);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Konekcija je već mrtva; pool će je odbaciti. Ne maskiramo originalnu grešku.
    }
    throw error;
  } finally {
    client.release();
  }
}
