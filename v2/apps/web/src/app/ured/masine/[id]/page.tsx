import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import { withCompany, companyId as toCompanyId } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { Breadcrumbs, PageHeader } from "@/components/ui/index";
import { listMaintenancePlans } from "@/server/maintenance-service";
import { machineMaintenanceView } from "@/server/machine-reliability-service";
import { MasinaOdrzavanjeClient } from "./odrzavanje-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/masine/[id]` — kartica mašine, tab „Održavanje“.
 *
 * Ekran odgovara na tri pitanja koja se postavljaju za mašinu: (1) kada je sljedeći servis i koliko
 * je pređeno; (2) koliko je mašina stajala i koliko se kvari (MTTR/MTBF); (3) koliko održavanje
 * košta po satu rada. Sve tri brojke su izvedene — nijedna nije unesena.
 */
export default async function MasinaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest(`http://interni/ured/masine/${id}`, {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "service.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const machine = await withCompany(pool, toCompanyId(auth.ctx.companyId), async (client) => {
    const row = await client.query<{ id: string; code: string; name: string; is_active: boolean; meter_value: string | null }>(
      "SELECT id, code, name, is_active, meter_value::text FROM public.machines WHERE company_id = $1 AND id = $2",
      [auth.ctx.companyId, id],
    );
    return row.rows[0] ?? null;
  });
  if (!machine) notFound();

  const actor = { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles };
  const plans = await listMaintenancePlans(pool, actor, id);
  const view = await withCompany(pool, toCompanyId(auth.ctx.companyId), (client) =>
    machineMaintenanceView(client, { companyId: auth.ctx.companyId, machineId: id }),
  );

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Breadcrumbs items={[{ label: "Mašine", href: "/ured/masine" }, { label: machine.code }]} />
      <PageHeader
        title={`${machine.code} — ${machine.name}`}
        subtitle="Održavanje: planovi, historija naloga, pouzdanost i trošak po satu rada."
      />
      <MasinaOdrzavanjeClient
        machineId={machine.id}
        plans={plans}
        orders={view.orders}
        reliability={view.reliability}
      />
    </main>
  );
}
