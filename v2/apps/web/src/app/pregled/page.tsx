import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withCompany, type CompanyId } from "@gradix/db";
import { getPool, getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE, verifyAccessToken } from "@/server/session";
import { Card, Chip, EmptyState, Icon, Inline, PageHeader, Stack, Stat } from "@/components/ui/index";
import { MachinesTable } from "./machines-table";
import { ScopeNotice } from "@/components/scope-notice";
import { ObligationSummary } from "@/components/obligation-summary";
import { can } from "@/server/permissions";
import { listObligations } from "@/server/obligation-service";
import { countOpenConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Pregled — ekran na koji se dolazi poslije prijave.
 *
 * Provjera ide na serveru, prije renderovanja: cookie → JWT → sesija u bazi → membership →
 * tenant scope → podaci. Klijent ne dobija ništa što nije prošlo ovu provjeru.
 *
 * Sadržaj prikazuje firmu, osobu i mašine. R0 note counter je uklonjen zajedno sa legacy
 * sync protokolom; mobilni R4 unos čeka lokalni SQLite outbox korak.
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
    const memberships = await client.query<{ roles: string[]; scope: string }>(
      "SELECT roles::text[] AS roles, scope FROM memberships WHERE user_id = $1",
      [claims.sub],
    );
    const roles = memberships.rows[0]?.roles ?? [];
    /*
     * `PROJECTS` opseg se računa ovdje da bi ekran mogao reći ISTINU kad dodjela nema. Samo za taj
     * opseg — `COMPANY` i `SELF` ne plaćaju ni jedan upit.
     */
    const scope = memberships.rows[0]?.scope ?? "SELF";
    const assignments =
      scope === "PROJECTS"
        ? await client.query<{ count: string }>(
            `SELECT count(*)::text AS count
               FROM project_assignments a
               JOIN workers w ON w.company_id = a.company_id AND w.id = a.worker_id
               JOIN companies c ON c.id = a.company_id
              WHERE a.company_id = $2 AND w.user_id = $1
                AND a.voided_at IS NULL
                AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
                AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)`,
            [claims.sub, claims.companyId],
          )
        : null;
    return {
      profile: profile.rows[0],
      company: company.rows[0],
      machines: machines.rows,
      roles,
      scope,
      assignmentCount: Number(assignments?.rows[0]?.count ?? 0),
    };
  });

  if (!data) redirect("/login");

  // Rokovi se broje SAMO ako osoba smije da ih vidi; inače kartice nema (nema ni prazne kutije
  // koja bi rekla „0“ i time slagala da rokova nema).
  const canSeeObligations = can(data.roles, "obligations.view");
  const obligationCounts = canSeeObligations
    ? (
        await listObligations(await getVerifiedPool(), claims.companyId as CompanyId, {}, {
          scope: data.scope === "SELF" ? "SELF" : "COMPANY",
          userId: claims.sub,
        })
      ).counts
    : null;


  // Kartica sukoba samo za one koji ih smiju razrješavati (workdays.resolve).
  const conflictCounts = can(data.roles, "workdays.resolve")
    ? await withCompany(await getVerifiedPool(), claims.companyId as CompanyId, async (client) => {
        const viewerWorkerId = await resolveViewerWorkerId(client, claims.companyId, claims.sub);
        return countOpenConflicts(client, claims.companyId, workdayResolveScopeFor(data.roles, viewerWorkerId));
      })
    : null;

  const firstName = data.profile?.first_name ?? "";
  const machineCount = data.machines.length;

  return (
    <div>
      <PageHeader
        title={firstName ? `Dobro došli, ${firstName}` : "Pregled"}
        subtitle={`${data.company?.name ?? "Firma"} · ${data.profile?.first_name} ${data.profile?.last_name} · ${data.company?.currency}`}
      />

      <ScopeNotice scope={data.scope} assignmentCount={data.assignmentCount} />

      <div className="gx-cols">
        <Card>
          <h2 className="gx-section-title">Mehanizacija</h2>
          <p className="gx-page-sub">
            {machineCount === 0
              ? "U ovoj firmi još nema mašina."
              : `${machineCount} ${machineCount === 1 ? "mašina" : "mašine"} u evidenciji.`}
          </p>

          {machineCount === 0 ? (
            <EmptyState
              title="Nema mašina"
              description="Mašine se dodaju u bazi; ekran ih samo prikazuje dok ne dođe unos iz interfejsa."
            />
          ) : (
<MachinesTable machines={data.machines} />
          )}
        </Card>

        <Card>
          <h2 className="gx-section-title">Radni zapisi</h2>
          <p className="gx-page-sub">
            R4 push/pull API je tenant-scoped. Mobilni unos će se uključiti nakon lokalnog SQLite outbox koraka;
            stari R0 notes sync je isključen.
          </p>
        </Card>
      </div>

      {obligationCounts ? <ObligationSummary counts={obligationCounts} /> : null}

      {conflictCounts ? (
        <Card>
          <h2 className="gx-section-title">Sukobi radnih dana</h2>
          <Inline>
            <Stat label="Nerazriješeni sukobi" value={String(conflictCounts.open)} />
            <Stat label={`Stariji od ${conflictCounts.thresholdDays} dana`} value={String(conflictCounts.olderThanThreshold)} />
            {conflictCounts.olderThanThreshold > 0 ? (
              <Chip tone="hot">{conflictCounts.olderThanThreshold} stariji od {conflictCounts.thresholdDays} dana</Chip>
            ) : null}
            <Link href="/ured/sukobi?stanje=OPEN">Otvori razrješenje</Link>
          </Inline>
        </Card>
      ) : null}

      <Card>
        <div className="gx-section-head">
          <div className="gx-section-head__text">
            <h2 className="gx-section-title">Šta dalje</h2>
            <span className="gx-section-hint">ono što je otvoreno u ovoj fazi</span>
          </div>
        </div>
        <Stack>
          <Inline>
            <Icon name="users" />
            <span>
              <strong>Korisnici</strong> — pozovite osobu, dodijelite rolu i opseg.
            </span>
          </Inline>
          <Inline>
            <Icon name="shield" />
            <span>
              <strong>Pristup i role</strong> — pregled ko šta smije; dozvole se još ne mijenjaju iz
              ekrana.
            </span>
          </Inline>
          <Inline>
            <Icon name="list" />
            <span>
              <strong>Audit trag</strong> — svaka promjena pristupa ostaje zapisana.
            </span>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}
