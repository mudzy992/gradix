import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { Breadcrumbs, PageHeader } from "@/components/ui/index";
import { listMaintenanceTemplates } from "@/server/maintenance-service";
import { PlanoviClient } from "./planovi-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/servis/planovi` — šabloni po kategoriji i planovi po mašini.
 *
 * Šablon se definiše JEDNOM po kategoriji („zamjena ulja svakih 250 h“), a plan je kopija koja
 * važi za konkretnu mašinu. Zato su na istom ekranu: ko mijenja šablon mora vidjeti koliko
 * mašina ga koristi, inače izmjena izgleda bezopasno.
 */
export default async function PlanoviPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/servis/planovi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "service.view")) redirect("/nemate-pristup");

  const templates = await listMaintenanceTemplates(await getVerifiedPool(), {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles,
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <Breadcrumbs items={[{ label: "Servis", href: "/ured/servis" }, { label: "Planovi održavanja" }]} />
      <PageHeader
        title="Planovi održavanja"
        subtitle="Šablon po kategoriji mašine, plan po mašini. Prag je upozorenje; blokada je odluka firme u postavkama."
      />
      <PlanoviClient
        initialTemplates={templates}
        caps={{ canManage: can(auth.ctx.roles, "service.manage") }}
      />
    </main>
  );
}
