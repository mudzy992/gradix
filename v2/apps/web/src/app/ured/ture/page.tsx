import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listHauls } from "@/server/haul-service";
import { HaulsClient } from "./hauls-client";

export const dynamic = "force-dynamic";

export default async function TurePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/ture", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "machines.haul.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const hauls = await listHauls(
    pool,
    auth.ctx,
    {},
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Ture"
        subtitle="Polazište, odredište, materijal i količina po kamionu. Ispravke idu kroz reviziju."
      />
      <HaulsClient
        initialHauls={hauls}
        caps={{
          canCreate: can(auth.ctx.roles, "machines.haul.create"),
          canRevise: can(auth.ctx.roles, "machines.haul.revise"),
          canManageSegments: can(auth.ctx.roles, "machines.haul.manage"),
        }}
      />
    </main>
  );
}
