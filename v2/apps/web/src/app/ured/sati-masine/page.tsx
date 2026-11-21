import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listMachineWorkLogs } from "@/server/machine-work-log-service";
import { MachineWorkLogsClient } from "./machine-work-logs-client";

export const dynamic = "force-dynamic";

/** R5.1: sati mašina — lista, unos i ispravka (capability booleani, pravilo 12). */
export default async function SatiMasinePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/sati-masine", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "machines.work_log.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const logs = await listMachineWorkLogs(
    pool,
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    {},
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Sati mašina"
        subtitle="Radni intervali mašina, očitanja brojila i uredske ispravke. Original ostaje nepromijenjen."
      />
      <MachineWorkLogsClient
        initialLogs={logs}
        caps={{
          canCreate: can(auth.ctx.roles, "machines.work_log.create"),
          canRevise: can(auth.ctx.roles, "machines.work_log.revise"),
        }}
      />
    </main>
  );
}