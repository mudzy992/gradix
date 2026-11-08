import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withCompany, type CompanyId } from "@gradix/db";
import { getPool, getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE, verifyAccessToken } from "@/server/session";
import { Card, Chip, Icon, Mono } from "@/components/ui";
import { ObligationSummary } from "@/components/obligation-summary";
import { can } from "@/server/permissions";
import { listObligations } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

/**
 * Pregled — ekran na koji se dolazi poslije prijave.
 *
 * Provjera ide na serveru, prije renderovanja: cookie → JWT → sesija u bazi → membership →
 * tenant scope → podaci. Klijent ne dobija ništa što nije prošlo ovu provjeru.
 *
 * Sadržaj je postojeći: firma, osoba, mašine i broj offline zapisa. Nove funkcionalnosti nema —
 * ravnalo stacionaže iz reference je prikaz istih podataka (kod mašine + stanje), bez novih
 * polja u bazi.
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
    const memberships = await client.query<{ roles: string[] }>(
      "SELECT roles::text[] AS roles FROM memberships WHERE user_id = $1",
      [claims.sub],
    );
    const roles = memberships.rows[0]?.roles ?? [];
    return {
      profile: profile.rows[0],
      company: company.rows[0],
      machines: machines.rows,
      noteCount: Number(notes.rows[0]?.count ?? 0),
      roles,
    };
  });

  if (!data) redirect("/login");

  // Rokovi se broje SAMO ako osoba smije da ih vidi; inače kartice nema (nema ni prazne kutije
  // koja bi rekla „0“ i time slagala da rokova nema).
  const canSeeObligations = can(data.roles, "obligations.view");
  const obligationCounts = canSeeObligations
    ? (await listObligations(await getVerifiedPool(), claims.companyId as CompanyId)).counts
    : null;

  const firstName = data.profile?.first_name ?? "";
  const machineCount = data.machines.length;

  return (
    <div>
      <div className="gx-page-head">
        <div className="gx-page-head__text">
          <h1 className="gx-page-title">{firstName ? `Dobro došli, ${firstName}` : "Pregled"}</h1>
          <p className="gx-page-sub">
            {data.company?.name ?? "Firma"} · {data.profile?.first_name} {data.profile?.last_name} ·{" "}
            {data.company?.currency}
          </p>
        </div>
      </div>

      <div className="gx-cols">
        <Card>
          <h2 className="gx-section-title">Mehanizacija</h2>
          <p className="gx-page-sub" style={{ marginTop: "var(--space-1)" }}>
            {machineCount === 0
              ? "U ovoj firmi još nema mašina."
              : `${machineCount} ${machineCount === 1 ? "mašina" : "mašine"} u evidenciji.`}
          </p>

          {machineCount === 0 ? (
            <div className="gx-empty" style={{ marginTop: "var(--space-5)" }}>
              <p className="gx-empty__title">Nema mašina</p>
              <p className="gx-empty__text">
                Mašine se dodaju u bazi; ekran ih samo prikazuje dok ne dođe unos iz interfejsa.
              </p>
            </div>
          ) : (
            <table className="gx-table" style={{ marginTop: "var(--space-4)" }}>
              <thead>
                <tr>
                  <th>Mašina</th>
                  <th>Šifra</th>
                </tr>
              </thead>
              <tbody>
                {data.machines.map((machine) => (
                  <tr key={machine.code}>
                    <td>
                      <div className="gx-who">{machine.name}</div>
                    </td>
                    <td>
                      <Mono>{machine.code}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="gx-section-title">Sa terena</h2>
          <p className="gx-page-sub" style={{ marginTop: "var(--space-1)" }}>
            Zapisi poslani s mobilnog, kroz offline red.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-2)",
              marginTop: "var(--space-5)",
            }}
          >
            <span className="gx-mono" style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em" }}>
              {data.noteCount}
            </span>
            <span style={{ color: "var(--muted)" }}>
              {data.noteCount === 1 ? "zapis u bazi" : "zapisa u bazi"}
            </span>
          </div>

          <div style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
            <Chip tone="full">Sync radi</Chip>
            <p style={{ fontSize: "var(--text-small)", color: "var(--muted)" }}>
              Ova stranica ne piše. Upis ide kroz mobilni red i <Mono>/api/sync/push</Mono>.
            </p>
          </div>
        </Card>
      </div>

      {obligationCounts ? <ObligationSummary counts={obligationCounts} /> : null}

      <Card>
        <div className="gx-section-head">
          <div className="gx-section-head__text">
            <h2 className="gx-section-title">Šta dalje</h2>
            <span className="gx-section-hint">ono što je otvoreno u ovoj fazi</span>
          </div>
        </div>
        <ul style={{ display: "grid", gap: "var(--space-3)", listStyle: "none", padding: 0 }}>
          <li style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <Icon name="users" />
            <span>
              <strong>Korisnici</strong> — pozovite osobu, dodijelite rolu i opseg.
            </span>
          </li>
          <li style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <Icon name="shield" />
            <span>
              <strong>Pristup i role</strong> — pregled ko šta smije; dozvole se još ne mijenjaju iz
              ekrana.
            </span>
          </li>
          <li style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <Icon name="list" />
            <span>
              <strong>Audit trag</strong> — svaka promjena pristupa ostaje zapisana.
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
