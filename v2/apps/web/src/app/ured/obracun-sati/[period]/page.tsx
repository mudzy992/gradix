import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { Inline, PageHeader } from "@/components/ui/index";
import {
  isPayrollError,
  listLines,
  listPeriods,
} from "@/server/payroll-period-service";
import { PeriodDetailClient } from "../period-detail-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/obracun-sati/[period]` — jedna revizija obračuna (F6, spec 07 §4).
 *
 * Server nosi podatke, klijent nosi radnje. Izračun je nova revizija, pa se tabela poslije
 * izračuna OBAVEZNO ponovo čita sa servera (`router.refresh()`), a ne krpi lokalno: revizija
 * je zapis, ne pogled.
 */
export default async function PeriodPage({ params }: { params: Promise<{ period: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/obracun-sati", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "payroll.view")) redirect("/nemate-pristup");

  const { period } = await params;
  const pool = await getVerifiedPool();
  const actor = {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles as Role[],
  };

  const [periods, lines] = await Promise.all([
    listPeriods(pool, actor, {}),
    listLines(pool, actor, period),
  ]);
  if (isPayrollError(periods)) notFound();
  const meta = periods.periods.find((row) => row.id === period);
  if (!meta) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="mb-4">
        <Link className="gx-link text-sm" href="/ured/obracun-sati">
          ← Obračun
        </Link>
      </div>
      <PageHeader
        title={`Obračun ${meta.month}. ${meta.year}.`}
        subtitle="Sati po vrsti i iznosi po radniku. Klik na liniju otvara raspis: koji su dani i parametri ušli u iznos."
      />
      <Inline>
        <Link className="gx-link text-sm" href="/ured/obracun-sati/postavke">
          Komponente i parametri →
        </Link>
      </Inline>
      <PeriodDetailClient
        period={meta}
        initialLines={isPayrollError(lines) ? null : lines}
        lineError={isPayrollError(lines) ? lines.message : null}
        caps={{
          canCalculate: can(auth.ctx.roles, "payroll.manage"),
          canApprove: can(auth.ctx.roles, "payroll.approve"),
          canExport: can(auth.ctx.roles, "payroll.hours.export"),
        }}
      />
    </main>
  );
}
