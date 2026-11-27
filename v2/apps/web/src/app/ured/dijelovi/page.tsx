import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { listStockItems } from "@/server/stock-service";
import { DijeloviClient } from "./dijelovi-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/dijelovi` — artikli i stanje iz zbira kretnji.
 *
 * Na ekranu NEMA polja „stanje“. To nije nedostatak nego pravilo (spec 09 §1.3/14): stanje je
 * izvod iz dokumenata. Ko želi da promijeni broj, unosi kretnju — i tada se vidi zašto se broj
 * promijenio.
 */
export default async function DijeloviPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/dijelovi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "stock.view")) redirect("/nemate-pristup");

  const items = await listStockItems(await getVerifiedPool(), {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles,
  });

  return (
    <main className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Dijelovi"
        subtitle="Stanje je zbir kretnji (primanja i izdavanja), nikad prepisan broj. Pad ispod minimuma je upozorenje."
      />
      <DijeloviClient
        initialItems={items}
        caps={{
          canManage: can(auth.ctx.roles, "stock.manage"),
          canViewMovements: can(auth.ctx.roles, "stock.view"),
        }}
      />
    </main>
  );
}
