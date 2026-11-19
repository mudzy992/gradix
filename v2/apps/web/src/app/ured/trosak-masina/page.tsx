import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listMachineCostRates } from "@/server/machine-cost-rate-service";
import { CostRatesClient } from "./cost-rates-client";

export const dynamic = "force-dynamic";

export default async function TrosakMasinaPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/trosak-masina", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "machines.cost_rate.view")) redirect("/nemate-pristup");

  const rates = await listMachineCostRates(
    await getVerifiedPool(),
    {
      userId: auth.ctx.userId,
      companyId: auth.ctx.companyId,
      roles: auth.ctx.roles as Role[],
    },
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Trošak mašina"
        subtitle="Stope troška po satu rada mašine (Money). Gorivo i servis nisu u ovoj stopi."
      />
      <CostRatesClient
        initialRates={rates}
        caps={{ canManage: can(auth.ctx.roles, "machines.cost_rate.manage") }}
      />
    </main>
  );
}
