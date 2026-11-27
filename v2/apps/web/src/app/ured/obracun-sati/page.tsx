import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { PageHeader, Inline } from "@/components/ui/index";
import { listPeriods } from "@/server/payroll-period-service";
import { PeriodsClient } from "./periods-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/obracun-sati` — mjesečni periodi obračuna (F6, spec 07 §4).
 *
 * Dozvola je `payroll.view`: lista perioda nosi bruto osnovu, a to nije podatak koji PM ili šef
 * smiju vidjeti (vidi §1.8/29 — oni vide SATE kroz `payroll.hours.export` i izvoz).
 *
 * Izvoz sirovih sati (dosadašnji ekran) ostaje dostupan kao zasebna stranica
 * `/ured/obracun-sati/sati` — jer ga koriste i PM i šef, koji u ovaj ekran ne ulaze.
 */
export default async function ObracunSatiPage({
  searchParams,
}: {
  searchParams: Promise<{ godina?: string }>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/obracun-sati", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "payroll.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const actor = {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles as Role[],
  };
  const params = await searchParams;
  const year = /^[0-9]{4}$/.test(params.godina ?? "") ? Number(params.godina) : new Date().getFullYear();

  const result = await listPeriods(pool, actor, { year });
  const periods = "code" in result ? [] : result.periods;
  const canCreate = "code" in result ? false : result.can_create;

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Obračun"
        subtitle="Mjesečni periodi: sati po vrsti, iznosi po radniku, odobrenje i zaključavanje."
      />
      <Inline>
        <Link className="gx-link text-sm" href="/ured/obracun-sati/postavke">
          Komponente i parametri obračuna →
        </Link>
        <Link className="gx-link text-sm" href="/ured/obracun-sati/sati">
          Izvoz sirovih sati (CSV) →
        </Link>
      </Inline>
      {"code" in result ? (
        <p className="gx-page-sub" role="alert">{result.message}</p>
      ) : (
        <PeriodsClient initialPeriods={periods} canCreate={canCreate} year={year} />
      )}
    </main>
  );
}
