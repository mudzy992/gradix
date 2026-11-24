import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { EmptyState, PageHeader } from "@/components/ui/index";
import { weekView } from "@/server/workday-timer-service";
import { weekStartFromWorkDate } from "../approval-label";
import { WeekClient } from "./week-client";

export const dynamic = "force-dynamic";

/**
 * Sedmica — tabela radnik × dan sa sumama.
 *
 * Podrazumijeva se TEKUĆA sedmica kad `weekStart` nije zadat: ured najčešće otvara upravo nju,
 * a prazan ekran bi tražio da korisnik pogodi datum prije nego što vidi ijedan podatak.
 */
export default async function SedmicaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/radni-dani/sedmica", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workdays.view")) redirect("/nemate-pristup");

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const weekStart = first(params.weekStart) ?? weekStartFromWorkDate(new Date().toISOString().slice(0, 10));

  const pool = await getVerifiedPool();
  const actor = { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles };
  const result = await weekView(pool, actor, weekStart);

  const projects = await withCompany(pool, auth.ctx.companyId, async (client) => {
    const rows = await client.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM projects
        WHERE company_id = $1 AND is_active
        ORDER BY code`,
      [auth.ctx.companyId],
    );
    return rows.rows;
  });

  return (
    <main>
      <PageHeader
        title="Sedmica"
        subtitle="Radnik × dan, sa sumama. Prazna ćelija znači da nema dana — nije isto kao nula sati."
      />
      <p className="mb-4 text-sm">
        <Link className="gx-link" href="/ured/radni-dani">
          ← Pregled dana
        </Link>
      </p>
      {result.ok ? (
        <WeekClient
          week={result.week}
          projects={projects}
          canConfirm={can(auth.ctx.roles, "workdays.confirm")}
        />
      ) : (
        <EmptyState title="Sedmica nije dostupna" description={result.message} />
      )}
    </main>
  );
}
