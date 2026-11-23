import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { canViewFuelPrice } from "@/server/fuel-entry-price";
import { PageHeader } from "@/components/ui/index";
import { listFuelEntries } from "@/server/fuel-entry-service";
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
        }}
      />
    </main>
  );
}