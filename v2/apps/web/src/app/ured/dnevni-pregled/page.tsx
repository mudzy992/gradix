import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listDailyChecks } from "@/server/daily-check-service";
import { DailyChecksClient } from "./daily-checks-client";

export const dynamic = "force-dynamic";

export default async function DnevniPregledPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/dnevni-pregled", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "machines.check.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const checks = await listDailyChecks(
    pool,
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    {},
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Dnevni pregled"
        subtitle="Pregled mašine prije rada. Ispravke idu kroz reviziju; foto kao prilog."
      />
      <DailyChecksClient
        initialChecks={checks}
        caps={{
          canCreate: can(auth.ctx.roles, "machines.check.create"),
          canRevise: can(auth.ctx.roles, "machines.check.revise"),
          canManageTemplates: can(auth.ctx.roles, "machines.check.manage"),
        }}
      />
    </main>
  );
}
