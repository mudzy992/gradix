import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { REPORT_DEFINITIONS, type ReportKey } from "@gradix/domain";
import { ACCESS_COOKIE } from "@/server/session";
import { authenticate } from "@/server/tenant-context";
import { can } from "@/server/permissions";
import { SOURCE_PERMISSION } from "@/server/report-job-permissions";
import { ReportsClient } from "./reports-client";

export const dynamic="force-dynamic";
export default async function ReportsPage() {
  const token=(await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const auth=await authenticate(new NextRequest("http://interni/ured/izvjestaji",{headers:{cookie:`${ACCESS_COOKIE}=${token}`}}));
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles,"reports.view")) redirect("/nemate-pristup");
  const keys=(Object.keys(REPORT_DEFINITIONS) as ReportKey[]).filter(key=>can(auth.ctx.roles,SOURCE_PERMISSION[key]));
  return <ReportsClient keys={keys} canExport={can(auth.ctx.roles,"export.data")} canSeeProjects={can(auth.ctx.roles,"projects.view")} />;
}
