import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import { ACCESS_COOKIE } from "@/server/session";
import { authenticate, enrollmentRedirect } from "@/server/tenant-context";
import { can } from "@/server/permissions";
import { getVerifiedPool } from "@/server/db";
import { loadDashboardActionList } from "@/server/dashboard-action-lists";
import { ActionListView } from "./action-list-view";

export const dynamic = "force-dynamic";
export default async function ActionPage({searchParams}:{searchParams:Promise<{key?:string;page?:string}>}) {
  const token=(await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const auth=await authenticate(new NextRequest("http://interni/ured/akcije",{headers:{cookie:`${ACCESS_COOKIE}=${token}`}}));
  if (!auth.ok) redirect("/login");
  const enrollment = enrollmentRedirect(auth.ctx,"/ured/akcije");
  if (enrollment) redirect(enrollment);
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles,"dashboard.actions.view")) redirect("/nemate-pristup");
  const params=await searchParams;
  const list=await loadDashboardActionList(await getVerifiedPool(),auth.ctx,params.key ?? "",Number(params.page ?? "1"));
  if (!list) notFound();
  return <ActionListView list={list} actionKey={params.key ?? ""} />;
}
