import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { companyId as toCompanyId } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { listProjects } from "@/server/project-service";
import { projectFinancialSummaries, type ProjectFinancialSummary } from "./projects-summary";
import ProjectsClient from "./projects-client";

export const dynamic = "force-dynamic";

/**
 * Projekti — `projects.view` za listu i detalj, `projects.manage` za formu, `projects.assign` za
 * tim. Tri dozvole, tri dugmeta: osoba može imati jedno bez drugog (odluka vlasnika 2026-11-09).
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ projekat?: string }>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/projekti", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "projects.view")) redirect("/nemate-pristup");

  /*
   * F5: marža i % napretka se računaju OVDJE (jedan upit za sve projekte), a ne u klijentu po
   * redu. Lista bez marže je bila razlog što se u projekat ulazilo „da se vidi broj“ — a to je
   * tačno ono što spec 06 §4 traži da bude u listi.
   */
  const { projekat } = await searchParams;
  const initialProjectId = typeof projekat === "string" && projekat.length > 0 ? projekat : null;

  const pool = await getVerifiedPool();
  const projects = await listProjects(pool, toCompanyId(auth.ctx.companyId), {
    userId: auth.ctx.userId,
    roles: auth.ctx.roles,
    scope: auth.ctx.scope ?? "COMPANY",
    projectIds: auth.ctx.projectIds ?? null,
  }, { includeInactive: true });
  const summaries = await projectFinancialSummaries(
    pool,
    toCompanyId(auth.ctx.companyId),
    projects.map((project) => project.id),
  );
  const financials: Record<string, ProjectFinancialSummary> = {};
  for (const [id, summary] of summaries) financials[id] = summary;

  return (
    <main className="mx-auto w-full max-w-6xl">
      <ProjectsClient
        canManage={can(auth.ctx.roles, "projects.manage")}
        canBook={can(auth.ctx.roles, "projects.costs.book")}
        canApproveManual={can(auth.ctx.roles, "purchase.approve")}
        canAssign={can(auth.ctx.roles, "projects.assign")}
        canOverride={can(auth.ctx.roles, "projects.override")}
        canSeeMoney={can(auth.ctx.roles, "projects.costs.view")}
        financials={financials}
        initialOpenProjectId={initialProjectId ?? null}
      />
    </main>
  );
}
