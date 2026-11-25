import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { PayrollSettingsClient } from "./payroll-settings-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/obracun-sati/postavke` — šifarnik komponenti i parametri sa datumom važenja (spec 07 §4).
 *
 * Dozvola za OTVARANJE je `payroll.view`, a za pisanje `payroll.manage` — ekran mora biti
 * čitljiv i onome ko smije da gleda obračun ali ne da mijenja stope. Server odlučuje šta
 * klijent smije; klijent ne dobija `canManage` iz lažnog izvora.
 */
export default async function PayrollSettingsPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/obracun-sati/postavke", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "payroll.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="mb-4">
        <Link className="gx-link text-sm" href="/ured/obracun-sati">
          ← Obračun
        </Link>
      </div>
      <PageHeader
        /* Naslov je ISTI kao stavka u meniju (`nav.ts`) — E2E @smoke provjerava da dozvoljena
           ruta pokaže naslov svoje stavke; dva naziva za isti ekran padaju na tom testu. */
        title="Komponente obračuna"
        subtitle="Šifarnik komponenti firme i parametri sa datumom važenja. Nijedna stopa nije ugrađena u program."
      />
      <PayrollSettingsClient canManage={can(auth.ctx.roles, "payroll.manage")} />
    </main>
  );
}
