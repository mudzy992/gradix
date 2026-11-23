import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listProjectCostEntries } from "@/server/project-cost-service";
import { ProjectCostsClient } from "./project-costs-client";

export const dynamic = "force-dynamic";

export default async function TroskoviProjektaPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/troskovi-projekta", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "projects.costs.view")) redirect("/nemate-pristup");

  const entries = await listProjectCostEntries(
    await getVerifiedPool(),
    {
      userId: auth.ctx.userId,
      companyId: auth.ctx.companyId,
      roles: auth.ctx.roles as Role[],
    },
    {},
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Troškovi projekta"
        subtitle="Knjiženja sati mašine × stopa na projekat. Idempotentno po izvornom zapisu."
      />
      <ProjectCostsClient
        initialEntries={entries}
        caps={{ canBook: can(auth.ctx.roles, "projects.costs.book") }}
      />
    </main>
  );
}
