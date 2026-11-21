import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listMachineFaults } from "@/server/machine-fault-service";
import { FaultsClient } from "./faults-client";

export const dynamic = "force-dynamic";

export default async function KvaroviPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/kvarovi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "machines.fault.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const faults = await listMachineFaults(
    pool,
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    {},
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Kvarovi"
        subtitle="Prijave kvarova. Trošak iznad praga ide na odobrenje vlasnika."
      />
      <FaultsClient
        initialFaults={faults}
        caps={{
          canCreate: can(auth.ctx.roles, "machines.fault.create"),
          canRevise: can(auth.ctx.roles, "machines.fault.revise"),
          canApprove: can(auth.ctx.roles, "machines.fault.approve"),
        }}
      />
    </main>
  );
}
