import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { canViewFuelPrice } from "@/server/fuel-entry-price";
import { PageHeader } from "@/components/ui/index";
import { listFuelEntries } from "@/server/fuel-entry-service";
import { listFuelTanks } from "@/server/fuel-price-service";
import { FuelEntriesClient } from "./fuel-entries-client";

export const dynamic = "force-dynamic";

export default async function GorivoPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/gorivo", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "machines.fuel.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const entries = await listFuelEntries(
    pool,
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    {},
  );

  /*
   * F4: cisterna je uključena PO FIRMI. Kad nije, točenja idu na pumpu i stanje se ne vodi —
   * zato se lista cisterni i ne učitava, a ekran ne nudi izbor koji ne postoji.
   */
  const tankEnabled = can(auth.ctx.roles, "machines.fuel.view")
    ? await (async () => {
        const row = await pool.query<{ fuel_tank_enabled: boolean }>(
          "SELECT fuel_tank_enabled FROM public.companies WHERE id = $1",
          [auth.ctx.companyId],
        );
        return Boolean(row.rows[0]?.fuel_tank_enabled);
      })()
    : false;
  const tanks = tankEnabled
    ? (await listFuelTanks(pool, {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        roles: auth.ctx.roles as Role[],
      })).map((tank) => ({ id: tank.id, name: tank.name, current_l: tank.current_l }))
    : [];

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Gorivo"
        subtitle="Točenja po mašini i vozaču. Cijena je vidljiva samo uredu i računovođi."
      />
      <FuelEntriesClient
        initialEntries={entries}
        caps={{
          canCreate: can(auth.ctx.roles, "machines.fuel.create"),
          canRevise: can(auth.ctx.roles, "machines.fuel.revise"),
          showPrice: canViewFuelPrice(auth.ctx.roles),
          canManageFuel: can(auth.ctx.roles, "machines.fuel.manage"),
          tankEnabled,
          tanks,
        }}
      />
    </main>
  );
}