import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, TextLink } from "@/components/ui/index";
import { InspekcijeClient, type InspectionRow } from "./inspekcije-client";

export const dynamic = "force-dynamic";

/** `/ured/hse/inspekcije` — nalazi inspekcija; aktivna `PROHIBITION` je prva (§4, §1.5/25). */
export default async function InspekcijePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/hse/inspekcije", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "hse.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const inspections = await withCompany(pool, auth.ctx.companyId, async (client) => {
    const result = await client.query<{
      id: string; kind: string; authority_name: string | null; inspected_at: string;
      inspector_name: string | null; summary: string | null; result: string;
      lifted_at: string | null; project_name: string | null; open_actions: string;
    }>(
      `SELECT i.id, i.kind, i.authority_name, i.inspected_at::text, i.inspector_name, i.summary,
              i.result, i.prohibition_lifted_at::text AS lifted_at, p.name AS project_name,
              (SELECT count(*)::text FROM public.hse_actions a
                WHERE a.company_id = i.company_id AND a.inspection_id = i.id AND a.status = 'OPEN') AS open_actions
         FROM public.hse_inspections i
         LEFT JOIN public.projects p ON p.company_id = i.company_id AND p.id = i.project_id
        WHERE i.company_id = $1
        ORDER BY (i.result = 'PROHIBITION' AND i.prohibition_lifted_at IS NULL) DESC, i.inspected_at DESC
        LIMIT 200`,
      [auth.ctx.companyId],
    );
    return result.rows.map((row): InspectionRow => ({
      id: row.id,
      kind: row.kind,
      authorityName: row.authority_name,
      inspectedAt: row.inspected_at,
      inspectorName: row.inspector_name,
      summary: row.summary,
      result: row.result,
      prohibitionLiftedAt: row.lifted_at,
      projectName: row.project_name,
      openActions: Number(row.open_actions),
    }));
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Inspekcije"
        subtitle="Zabrana rada (PROHIBITION) zaustavlja gradilište: obavještenje vlasniku ide odmah, a nalaz ostaje istaknut do podizanja zabrane."
        actions={<TextLink href="/ured/hse">HSE pregled</TextLink>}
      />
      <InspekcijeClient
        initial={inspections}
        caps={{ canInvestigate: can(auth.ctx.roles, "hse.investigate") }}
      />
    </main>
  );
}
