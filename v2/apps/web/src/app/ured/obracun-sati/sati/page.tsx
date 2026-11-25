import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { calendarDateFromLocalDate } from "@gradix/domain";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listHoursForExport } from "@/server/hours-export-service";
import { HoursExportClient } from "./hours-export-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function monthBounds(isoToday: string): { from: string; to: string } {
  return { from: `${isoToday.slice(0, 7)}-01`, to: isoToday };
}

export default async function SiromiSatiPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/obracun-sati/sati", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "payroll.hours.export")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const today = await withCompany(pool, toCompanyId(auth.ctx.companyId), async (client) => {
    const row = await client.query<{ today: string }>(
      `SELECT (clock_timestamp() AT TIME ZONE c.timezone)::date::text AS today
         FROM public.companies c WHERE c.id = $1`,
      [auth.ctx.companyId],
    );
    return row.rows[0]?.today ?? calendarDateFromLocalDate(new Date());
  });
  const defaults = monthBounds(today);
  const params = await searchParams;
  const from = DATE_RE.test(params.from ?? "") ? params.from! : defaults.from;
  const to = DATE_RE.test(params.to ?? "") ? params.to! : defaults.to;
  const range = from <= to ? { from, to } : defaults;
  const rows = await listHoursForExport(
    pool,
    {
      userId: auth.ctx.userId,
      companyId: auth.ctx.companyId,
      roles: auth.ctx.roles as Role[],
      scope: auth.ctx.scope,
      projectIds: auth.ctx.projectIds ?? [],
    },
    range,
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="mb-4">
        <Link className="gx-link text-sm" href="/ured/obracun-sati">
          ← Obračun
        </Link>
      </div>
      <PageHeader
        title="Izvoz sirovih sati"
        subtitle="Potvrđeni i zaključani sati radnika po danu — pregled i CSV. Ovo NIJE obračun sa iznosima."
      />
      <HoursExportClient initialFrom={range.from} initialTo={range.to} initialRows={rows} />
    </main>
  );
}
