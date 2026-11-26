import { getVerifiedPool } from "@/server/db";
import { healthPage } from "../_components/health-page";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import WorkersClient from "./workers-client";

export const dynamic = "force-dynamic";

/**
 * Ista provjera kao na ostalim ekranima, prije renderovanja: sesija → dozvola → lozinka.
 * `workers.view` je širi od `manage` (šef gradilišta vidi ljude, ali ih ne mijenja), pa ekran
 * dobija obje zastavice i sam odlučuje šta prikazuje.
 */
export default async function WorkersPage({searchParams}: {searchParams: Promise<{filter?:string;page?:string;warehouse?:string}>}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/radnici", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workers.view")) redirect("/nemate-pristup");
  const params = await searchParams;
  if (params.filter === "bez-satnice") return healthPage(await getVerifiedPool(), {...auth.ctx, projectIds:auth.ctx.projectIds ?? null}, "workers_without_rate", params.page);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <WorkersClient
        canManage={can(auth.ctx.roles, "workers.manage")}
        canLinkUser={can(auth.ctx.roles, "users.manage")}
      />
    </main>
  );
}
