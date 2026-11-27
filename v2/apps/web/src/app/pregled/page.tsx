import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { withCompany, type CompanyId } from "@gradix/db";
import { getPool, getVerifiedPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can, ROLE_LABELS, type Role } from "@/server/permissions";
import { buildPregled } from "@/server/pregled-service";
import { Card, Chip, EmptyState, Icon, Inline, PageHeader, Stack, Stat } from "@/components/ui/index";
import { MachinesTable } from "./machines-table";
import { ScopeNotice } from "@/components/scope-notice";
import { ObligationSummary } from "@/components/obligation-summary";
import { listObligations } from "@/server/obligation-service";
import { countOpenConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";
import { PregledBoard } from "./pregled-board";
import { GettingStarted } from "./onboarding";
import { WorkerOverviewPanel } from "./worker-overview";
import { workerOverview } from "@/server/worker-overview";
import { RoleDashboard } from "./role-dashboard";
import { RiskyProjectsCard } from "./risky-projects-card";
import { listRiskyProjects } from "@/server/pregled-risky";
import { payrollReminder } from "@/server/payroll-reminder";
import { PayrollReminderCard } from "./payroll-reminder-card";
import { serviceAttention } from "@/server/service-attention";
import { ServiceAttentionCard } from "@/components/service-attention-card";
import { HseAttentionCard } from "@/components/hse-attention-card";
import { hseAttention } from "@/server/hse-service";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Pregled — ekran na koji se dolazi poslije prijave.
 *
 * Provjera ide na serveru, prije renderovanja: cookie → sesija u bazi → membership →
 * tenant scope → podaci. Klijent ne dobija ništa što nije prošlo ovu provjeru.
 *
 * C.1 (odobren dizajn): OWNER, ADMIN, PROJECT_MANAGER i SITE_SUPERVISOR dobijaju
 * „šta moram danas uraditi?“ — redove pažnje, sažetak i (samo vlasnik/admin)
 * stanje sinhronizacije, svaki broj u njihovom opsegu. WORKER, DRIVER i ostali
 * ostaju na starom pregledu — ista stranica, druga grana, jedna dozvola
 * (`pregled.view`) kao granica.
 */
export default async function PregledPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/pregled", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  const ctx = auth.ctx;

  const data = await withCompany(getPool(), ctx.companyId as CompanyId, async (client) => {
    const profile = await client.query<{ first_name: string; last_name: string; email: string }>(
      "SELECT first_name, last_name, email FROM users WHERE id = $1",
      [ctx.userId],
    );
    const company = await client.query<{ name: string; slug: string; currency: string; timezone: string }>(
      "SELECT name, slug, currency, timezone FROM companies WHERE id = $1",
      [ctx.companyId],
    );
    const machines = await client.query<{ code: string; name: string }>(
      "SELECT code, name FROM machines ORDER BY code",
    );
    /*
     * `PROJECTS` opseg se računa ovdje da bi ekran mogao reći ISTINU kad dodjela nema. Samo za taj
     * opseg — `COMPANY` i `SELF` ne plaćaju ni jedan upit.
     */
    const assignmentCount =
      ctx.scope === "PROJECTS"
        ? Number(
            (
              await client.query<{ count: string }>(
                `SELECT count(*)::text AS count
                   FROM project_assignments a
                   JOIN workers w ON w.company_id = a.company_id AND w.id = a.worker_id
                   JOIN companies c ON c.id = a.company_id
                  WHERE a.company_id = $2 AND w.user_id = $1
                    AND a.voided_at IS NULL
                    AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
                    AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)`,
                [ctx.userId, ctx.companyId],
              )
            ).rows[0]?.count ?? "0",
          )
        : 0;
    return {
      profile: profile.rows[0],
      company: company.rows[0],
      machines: machines.rows,
      assignmentCount,
    };
  });

  const firstName = data.profile?.first_name ?? null;

  /*
   * F5: rizični projekti i broj troškova bez cijene. Traži `projects.costs.view` — bez te dozvole
   * kartice NEMA (ni prazne), jer bi prazna kartica tvrdila da rizika nema.
   *
   * Upit se izvršava samo za one koji smiju vidjeti novac; `listRiskyProjects` i sam provjerava
   * `dashboard.view`, ali poziv se ne pravi uzalud.
   */
  const risky = can(ctx.roles, "projects.costs.view")
    ? await listRiskyProjects(await getVerifiedPool(), {
        userId: ctx.userId,
        companyId: ctx.companyId,
        roles: ctx.roles,
      })
    : null;
  const riskyData = risky && !("code" in risky) ? risky : null;

  /*
   * F8: preventiva i nalozi koji čekaju. Isti `dueMaintenancePlans` koji zove worker — pa
   * podsjetnik i ekran ne mogu reći različito „dospjelo“. Bez `service.view` kartice NEMA
   * (ni prazne), jer bi prazna kartica tvrdila da servisa nema.
   */
  const service = can(ctx.roles, "service.view")
    ? await withCompany(await getVerifiedPool(), ctx.companyId as CompanyId, (client) =>
        serviceAttention(client, { userId: ctx.userId, companyId: ctx.companyId, roles: ctx.roles as Role[], scope: ctx.scope, projectIds: ctx.projectIds }),
      )
    : null;

  /*
   * F9: HSE kartica — zabrana rada, mjere koje kasne, incidenti i dnevnik bez potpisa. Bez
   * `hse.view` kartice nema; ista funkcija puni i HSE ekran, pa brojevi ne mogu biti različiti.
   */
  const hse = can(ctx.roles, "hse.view")
    ? await withCompany(await getVerifiedPool(), ctx.companyId as CompanyId, (client) =>
        hseAttention(client, { userId: ctx.userId, companyId: ctx.companyId, roles: ctx.roles as Role[], scope: ctx.scope, projectIds: ctx.projectIds }),
      )
    : null;

  /* F6: podsjetnik „period nije zaključan“ — samo za one koji vide obračun i samo poslije 5. */
  const reminder = await payrollReminder(await getVerifiedPool(), {
    userId: ctx.userId,
    companyId: ctx.companyId,
    roles: ctx.roles,
  });

  // --- C.1 grana: „šta moram danas uraditi?“ (samo pregled.view). ---
  if (can(ctx.roles, "pregled.view")) {
    const pregled = await buildPregled(await getVerifiedPool(), ctx.companyId as CompanyId, {
      userId: ctx.userId,
      roles: ctx.roles,
      scope: ctx.scope,
      projectIds: ctx.projectIds ?? [],
    });
    if (pregled) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: pregled.timezone,
          hour: "numeric",
          hour12: false,
        }).format(new Date()),
      );
      const greeting = hour >= 5 && hour < 11 ? "Dobro jutro" : hour >= 11 && hour < 18 ? "Dobar dan" : "Dobro veče";
      return (
        <div>
          <ScopeNotice scope={ctx.scope} assignmentCount={data.assignmentCount} />
          <PregledBoard data={pregled} firstName={firstName} greeting={greeting} premium
            companyName={data.company?.name} rolesLabel={ctx.roles.map(role => ROLE_LABELS[role as Role]?.label ?? role).join(", ")}
            canViewProjects={can(ctx.roles, "projects.view")}
            canViewActions={can(ctx.roles, "dashboard.actions.view")} canViewHealth={can(ctx.roles, "users.manage")}
            onboarding={Object.values(pregled.summary).every(value => value === 0) ? <GettingStarted roles={ctx.roles} /> : null}
            extras={<>{reminder ? <PayrollReminderCard reminder={reminder} /> : null}
              {riskyData ? <RiskyProjectsCard data={riskyData} /> : null}
              {service ? <ServiceAttentionCard data={service} /> : null}
              {hse ? <HseAttentionCard data={hse} /> : null}</>} />
        </div>
      );
    }
  }

  // --- Stara grana: radnik, vozač i ostali ostaju na ovome. ---
  // Rokovi se broje SAMO ako osoba smije da ih vidi; inače kartice nema (nema ni prazne kutije
  // koja bi rekla „0“ i time slagala da rokova nema).
  const canSeeObligations = can(ctx.roles, "obligations.view");
  const obligationCounts = canSeeObligations
    ? (
        await listObligations(await getVerifiedPool(), ctx.companyId as CompanyId, {}, {
          scope: ctx.scope, projectIds: ctx.projectIds,
          userId: ctx.userId,
        })
      ).counts
    : null;

  // Kartica sukoba samo za one koji ih smiju razrješavati (workdays.resolve).
  const conflictCounts = can(ctx.roles, "workdays.resolve")
    ? await withCompany(await getVerifiedPool(), ctx.companyId as CompanyId, async (client) => {
        const viewerWorkerId = await resolveViewerWorkerId(client, ctx.companyId, ctx.userId);
        return countOpenConflicts(client, ctx.companyId, workdayResolveScopeFor(ctx.roles, viewerWorkerId, ctx));
      })
    : null;

  const machineCount = data.machines.length;
  const workerData = ctx.roles.includes("WORKER") ? await workerOverview(await getVerifiedPool(), {
    companyId: ctx.companyId as CompanyId, userId: ctx.userId, roles: ctx.roles,
  }) : null;

  return (
    <div>
      <PageHeader
        title={firstName ? `Dobro došli, ${firstName}` : "Pregled"}
        subtitle={`${data.company?.name ?? "Firma"} · ${ctx.roles.map(role => ROLE_LABELS[role as Role]?.label ?? role).join(", ")} · ${data.company?.currency ?? ""}`}
        actions={can(ctx.roles, "service.view") ? <Link className="gx-btn gx-btn--primary" href="/ured/servis">Otvori servis</Link> :
          can(ctx.roles, "payroll.view") ? <Link className="gx-btn gx-btn--primary" href="/ured/obracun-sati">Otvori obračun</Link> :
          <Link className="gx-btn gx-btn--quiet" href="/ured/profil">Moj profil</Link>}
      />

      <ScopeNotice scope={ctx.scope} assignmentCount={data.assignmentCount} />
      {workerData ? <WorkerOverviewPanel data={workerData} /> : machineCount === 0 ? <GettingStarted roles={ctx.roles} /> : null}
      <RoleDashboard canViewActions={can(ctx.roles, "dashboard.actions.view")} canViewHealth={can(ctx.roles, "users.manage")} showKpis />

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
              description="Kada se mašine dodaju u evidenciju, pojavit će se ovdje."
            />
          ) : (
<MachinesTable machines={data.machines} />
          )}
        </Card>

        <Card>
          <h2 className="gx-section-title">Radni zapisi</h2>
          <p className="gx-page-sub">
            Radne zapise možete pregledati i unositi u mobilnoj aplikaciji.
          </p>
        </Card>
      </div>

      {riskyData ? <RiskyProjectsCard data={riskyData} /> : null}

      {service ? <ServiceAttentionCard data={service} /> : null}

      {hse ? <HseAttentionCard data={hse} /> : null}

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
