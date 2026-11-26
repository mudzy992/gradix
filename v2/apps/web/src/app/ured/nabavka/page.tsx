import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui";
import { PurchaseClient } from "./purchase-client";

export const dynamic="force-dynamic";
export default async function NabavkaPage({searchParams}:{searchParams:Promise<{item?:string;warehouse?:string}>}) {
  const token=(await cookies()).get(ACCESS_COOKIE)?.value;
  if(!token) redirect("/login");
  const auth=await authenticate(new NextRequest("http://interni/ured/nabavka",{headers:{cookie:`${ACCESS_COOKIE}=${token}`}}));
  if(!auth.ok) redirect("/login");
  if(auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if(!can(auth.ctx.roles,"purchase.view")) redirect("/nemate-pristup");
  const params=await searchParams;
  return <main className="mx-auto w-full max-w-6xl"><PageHeader title="Nabavka" subtitle="Zahtjevi, narudžbe, prijemi i računi dobavljača." />
    <PurchaseClient canManage={can(auth.ctx.roles,"purchase.manage")} initialItem={params.item ?? ""} initialWarehouse={params.warehouse ?? ""} />
  </main>;
}
