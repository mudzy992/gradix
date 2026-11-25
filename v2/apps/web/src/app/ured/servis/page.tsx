import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, TextLink } from "@/components/ui/index";
import { listServiceOrders } from "@/server/service-order-service";
import { ServisClient } from "./servis-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/servis` — radionica, ne arhiva naloga.
 *
 * Redoslijed koji server vraća je redoslijed RADA: `WAITING_PARTS` prvo (posao stoji i čeka
 * odluku), pa `IN_PROGRESS`, pa odobreni/planirani. Sortiranje je u servisu, a ne u ekranu, jer
 * isti redoslijed mora da važi i na mobilnom.
 */
export default async function ServisPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/servis", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "service.view")) redirect("/nemate-pristup");

  const orders = await listServiceOrders(
    await getVerifiedPool(),
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    {},
  );

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Servis"
        subtitle="Red čekanja radionice: šta stoji, koliko dugo i ko radi. Preventivni servis se otvara sam."
        actions={
          <>
            <TextLink href="/ured/servis/planovi">Planovi održavanja</TextLink>
            <TextLink href="/ured/dijelovi">Dijelovi</TextLink>
          </>
        }
      />
      <ServisClient
        initialOrders={orders}
        caps={{
          canManage: can(auth.ctx.roles, "service.manage"),
          canApprove: can(auth.ctx.roles, "service.approve"),
        }}
      />
    </main>
  );
}
