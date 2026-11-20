import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listPartners } from "@/server/partner-service";
import { PartnersClient } from "./partners-client";

export const dynamic = "force-dynamic";

export default async function PartneriPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/partneri", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "partners.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const partners = await listPartners(
    pool,
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    { includeInactive: true },
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader title="Partneri" subtitle="Naručioci, dobavljači i servisi." />
      <PartnersClient
        initialPartners={partners}
        canManage={can(auth.ctx.roles, "partners.manage")}
      />
    </main>
  );
}
