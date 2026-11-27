import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE } from "@/server/session";
import { authenticate } from "@/server/tenant-context";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { listSubcontractorPartners } from "@/server/subcontract-contract-service";
import { PageHeader } from "@/components/ui";
import { SubcontractClient } from "./subcontract-client";

export const dynamic="force-dynamic";
export default async function SubcontractPage() {
  const token=(await cookies()).get(ACCESS_COOKIE)?.value;
  if(!token) redirect("/login");
  const auth=await authenticate(new NextRequest("http://interni/ured/podizvodjaci",{headers:{cookie:`${ACCESS_COOKIE}=${token}`}}));
  if(!auth.ok) redirect("/login");
  if(auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if(!can(auth.ctx.roles,"subcontractors.view")) redirect("/nemate-pristup");
  const canManage=can(auth.ctx.roles,"subcontractors.manage");
  const partners=canManage ? await listSubcontractorPartners(await getVerifiedPool(),auth.ctx) : [];
  return <main className="mx-auto w-full max-w-6xl"><PageHeader title="Podizvođači" subtitle="Ugovori, aneksi i situacije po projektu." />
    <SubcontractClient canManage={canManage} partners={partners}/></main>;
}
