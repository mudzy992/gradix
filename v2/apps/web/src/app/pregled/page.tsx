import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withCompany, type CompanyId } from "@gradix/db";
import { getPool } from "@/server/db";
import { ACCESS_COOKIE, verifyAccessToken } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Zaštićena stranica (R0). Provjera ide na serveru, prije renderovanja:
 * cookie → JWT → sesija u bazi → membership → tenant scope → podaci.
 * Klijent ne dobija ništa što nije prošlo ovu provjeru.
 */
export default async function PregledPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) redirect("/login");

  const data = await withCompany(getPool(), claims.companyId as CompanyId, async (client) => {
    const session = await client.query(
      "SELECT id FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()",
      [claims.sid],
    );
    if (session.rowCount === 0) return null;

    const profile = await client.query<{ first_name: string; last_name: string; email: string }>(
      "SELECT first_name, last_name, email FROM users WHERE id = $1",
      [claims.sub],
    );
    const company = await client.query<{ name: string; slug: string; currency: string }>(
      "SELECT name, slug, currency FROM companies WHERE id = $1",
      [claims.companyId],
    );
    const machines = await client.query<{ code: string; name: string }>(
      "SELECT code, name FROM machines ORDER BY code",
    );
    const notes = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM sync_items");
    return {
      profile: profile.rows[0],
      company: company.rows[0],
      machines: machines.rows,
      noteCount: Number(notes.rows[0]?.count ?? 0),
    };
  });

  if (!data) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-5xl">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{data.company?.name ?? "Firma"}</h1>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {data.profile?.first_name} {data.profile?.last_name} · {data.company?.currency}
          </p>
        </div>
      </header>

      <section aria-labelledby="machines-heading" className="mt-8">
        <h2 id="machines-heading" className="text-lg font-medium">
          Mašine ({data.machines.length})
        </h2>
        {data.machines.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-[var(--color-border-strong)] p-4 text-sm text-[var(--color-text-muted)]">
            Nema mašina u ovoj firmi. Dodajte prvu mašinu da biste počeli.
          </p>
        ) : (
          <ul className="gx-panel mt-3 divide-y divide-[var(--color-border)]">
            {data.machines.map((machine) => (
              <li key={machine.code} className="flex justify-between px-4 py-3 hover:bg-[var(--color-brand-soft)]">
                <span className="font-medium">{machine.name}</span>
                <span className="text-sm text-[var(--color-text-muted)]">{machine.code}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sync-heading" className="mt-8">
        <h2 id="sync-heading" className="text-lg font-medium">
          Offline zapisi
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          U bazi je {data.noteCount} zapisa poslanih s terena. Ova stranica ne piše — upis ide kroz
          mobilni offline red i <code>/api/sync/push</code>.
        </p>
      </section>
    </main>
  );
}
