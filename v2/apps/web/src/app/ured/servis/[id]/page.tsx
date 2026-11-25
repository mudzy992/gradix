import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { Breadcrumbs, PageHeader } from "@/components/ui/index";
import { getServiceOrder } from "@/server/service-order-service";
import { listStockItems } from "@/server/stock-service";
import { OrderDetailClient } from "./order-detail-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/servis/[id]` — jedan nalog: rad, dijelovi, trošak, tok i odobrenje.
 *
 * Jedan server poziv donosi sve (`serviceOrderDetail`), pa ekran ne prikazuje „pola naloga“ dok
 * drugi zahtjev ne stigne. Dijelovi se nude iz šifarnika — mehaničar ne kuca šifru artikla.
 */
export default async function ServisNalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest(`http://interni/ured/servis/${id}`, {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "service.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const actor = { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles };
  const detail = await getServiceOrder(pool, actor, id);
  if (!detail) notFound();
  const stockItems = await listStockItems(pool, actor);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Breadcrumbs items={[{ label: "Servis", href: "/ured/servis" }, { label: detail.order.machine_code }]} />
      <PageHeader
        title={`${detail.order.machine_code} — ${detail.order.machine_name}`}
        subtitle={detail.order.description ?? undefined}
      />
      <OrderDetailClient
        detail={detail}
        stockItems={stockItems.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          onHand: item.on_hand,
        }))}
        caps={{
          canManage: can(auth.ctx.roles, "service.manage"),
          canApprove: can(auth.ctx.roles, "service.approve"),
          canStock: can(auth.ctx.roles, "stock.manage"),
        }}
      />
    </main>
  );
}
