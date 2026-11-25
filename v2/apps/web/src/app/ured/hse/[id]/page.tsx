import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect, notFound } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, TextLink } from "@/components/ui/index";
import { getIncident } from "@/server/hse-service";
import { HseIncidentClient } from "./hse-incident-client";

export const dynamic = "force-dynamic";

/** `/ured/hse/[id]` — incident: činjenice, dopune, istraga, mjere, zatvaranje (§4). */
export default async function HseIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/hse", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "hse.view")) redirect("/nemate-pristup");

  const { id } = await params;
  const detail = await getIncident(
    await getVerifiedPool(),
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    id,
  );
  if (!detail) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Incident"
        subtitle="Činjenice se dopunjuju, ne prepisuju. Dopuna je nova izjava svjedoka."
        actions={<TextLink href="/ured/hse">Svi incidenti</TextLink>}
      />
      <HseIncidentClient
        detail={detail}
        caps={{
          canReport: can(auth.ctx.roles, "hse.report"),
          canInvestigate: can(auth.ctx.roles, "hse.investigate"),
        }}
      />
    </main>
  );
}
