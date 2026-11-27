import { hseScope } from "@/server/hse-scope";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, TextLink } from "@/components/ui/index";
import { ObukeClient, type TrainingRow } from "./obuke-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/hse/obuke` — održane obuke i toolbox razgovori (§1.4).
 *
 * Razlika prema Modulu 2 mora biti vidljiva na ekranu: `obligation` prati VAŽENJE certifikata,
 * `hse_trainings` evidentira ODRŽANU obuku. Zato ekran piše „održano“ i traži potpise, a ne datum
 * isteka.
 */
export default async function ObukePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/hse/obuke", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "hse.training.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const [trainings, workers] = await withCompany(pool, auth.ctx.companyId, async (client) => {
    const scopeParams: unknown[] = [auth.ctx.companyId];
    const scopeSql = hseScope(auth.ctx, scopeParams, "t", "training");
    const list = await client.query<{
      id: string; kind: string; title: string; topic: string | null; held_at: string;
      duration_minutes: number | null; location: string | null; project_name: string | null; attendees: string;
    }>(
      `SELECT t.id, t.kind, t.title, t.topic, t.held_at::text, t.duration_minutes, t.location,
              p.name AS project_name,
              (SELECT count(*)::text FROM public.hse_training_attendees a
                WHERE a.company_id = t.company_id AND a.training_id = t.id) AS attendees
         FROM public.hse_trainings t
         LEFT JOIN public.projects p ON p.company_id = t.company_id AND p.id = t.project_id
        WHERE t.company_id = $1 AND ${scopeSql}
        ORDER BY t.held_at DESC
        LIMIT 200`,
      scopeParams,
    );
    const people = await client.query<{ id: string; full_name: string }>(
      `SELECT id, btrim(first_name || ' ' || coalesce(last_name, '')) AS full_name
         FROM public.workers w WHERE company_id = $1 AND is_active AND ($2::text='COMPANY' OR ($2::text='SELF' AND w.user_id=$3) OR ($2::text='PROJECTS' AND EXISTS (SELECT 1 FROM public.project_assignments pa JOIN public.companies c ON c.id=pa.company_id WHERE pa.company_id=w.company_id AND pa.worker_id=w.id AND pa.project_id=ANY($4::text[]) AND pa.voided_at IS NULL AND pa.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date AND (pa.to_date IS NULL OR pa.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)))) ORDER BY first_name, last_name`,
      [auth.ctx.companyId, auth.ctx.scope, auth.ctx.userId, auth.ctx.projectIds ?? []],
    );
    return [
      list.rows.map((row): TrainingRow => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        topic: row.topic,
        heldAt: row.held_at,
        durationMinutes: row.duration_minutes,
        location: row.location,
        projectName: row.project_name,
        attendees: Number(row.attendees),
      })),
      people.rows,
    ] as const;
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Obuke i toolbox"
        subtitle="Prisustvo je potpis, ne checkbox. Toolbox je 30 sekundi: tema, prisutni, trajanje."
        actions={<TextLink href="/ured/hse">HSE pregled</TextLink>}
      />
      <ObukeClient
        initial={trainings}
        workers={workers}
        caps={{ canManage: can(auth.ctx.roles, "hse.training.manage") }}
      />
    </main>
  );
}
