import { getVerifiedPool } from "@/server/db";
import { healthPage } from "../_components/health-page";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui";
import { WarehouseClient } from "./warehouse-client";

export const dynamic = "force-dynamic";
export default async function SkladistePage({searchParams}: {searchParams: Promise<{filter?:string;page?:string;warehouse?:string}>}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const auth = await authenticate(new NextRequest("http://interni/ured/skladiste", { headers: { cookie: `${ACCESS_COOKIE}=${token}` } }));
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "stock.view")) redirect("/nemate-pristup");
  const params = await searchParams;
  if (params.filter === "bez-minimuma") return healthPage(await getVerifiedPool(), {...auth.ctx, projectIds:auth.ctx.projectIds ?? null}, "warehouses_without_minimum", params.page);
  return <main className="mx-auto w-full max-w-6xl"><PageHeader title="Skladište" subtitle="Stanje po skladištu i artiklu, transferi i popis." />
    <WarehouseClient initialWarehouse={params.warehouse ?? ""} canManage={can(auth.ctx.roles,"stock.manage")} canPurchase={can(auth.ctx.roles,"purchase.manage")} />
  </main>;
}
