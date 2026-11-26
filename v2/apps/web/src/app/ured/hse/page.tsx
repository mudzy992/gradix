import { healthPage } from "../_components/health-page";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, TextLink } from "@/components/ui/index";
import { companyToday } from "@/server/project-service";
import { hseAttention, hseStats, listIncidents } from "@/server/hse-service";
import { withCompany } from "@gradix/db";
import { HseClient } from "./hse-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/hse` — stanje zaštite na radu: incidenti, mjere koje kasne, statistika i zabrana rada.
 *
 * Statistika ide uz listu, a ne na poseban ekran: LTIFR bez incidenata iz kojih je izračunat je
 * broj koji se ne može provjeriti. `activeProhibition` je prvo što ekran kaže, jer zabrana rada
 * zaustavlja gradilište.
 */
export default async function HsePage({searchParams}: {searchParams: Promise<{filter?:string;page?:string;warehouse?:string}>}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/hse", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "hse.view")) redirect("/nemate-pristup");
  const params = await searchParams;
  if (params.filter === "bez-mjera") return healthPage(await getVerifiedPool(), {...auth.ctx, projectIds:auth.ctx.projectIds ?? null}, "incidents_without_actions", params.page);

  const actor = { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles };
  const pool = await getVerifiedPool();
  const today = await withCompany(pool, auth.ctx.companyId, (client) => companyToday(client, auth.ctx.companyId));
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const [incidents, stats, attention] = await Promise.all([
    listIncidents(pool, actor, {}),
    hseStats(pool, actor, { from: yearStart, to: today }),
    withCompany(pool, auth.ctx.companyId, (client) => hseAttention(client, actor)),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Zaštita na radu (HSE)"
        subtitle="Incidenti, istrage, korektivne mjere, obuke i inspekcije. NEAR_MISS je ravnopravna kategorija, ne manji incident."
        actions={
          <>
            <TextLink href="/ured/hse/inspekcije">Inspekcije</TextLink>
            <TextLink href="/ured/hse/obuke">Obuke</TextLink>
          </>
        }
      />
      <HseClient
        initialIncidents={incidents}
        stats={stats}
        attention={attention}
        today={today}
        caps={{
          canReport: can(auth.ctx.roles, "hse.report"),
          canInvestigate: can(auth.ctx.roles, "hse.investigate"),
          canManageTrainings: can(auth.ctx.roles, "hse.training.manage"),
        }}
      />
    </main>
  );
}
