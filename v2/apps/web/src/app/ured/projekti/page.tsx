import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import ProjectsClient from "./projects-client";

export const dynamic = "force-dynamic";

/**
 * Projekti — `projects.view` za listu i detalj, `projects.manage` za formu, `projects.assign` za
 * tim. Tri dozvole, tri dugmeta: osoba može imati jedno bez drugog (odluka vlasnika 2026-11-09).
 */
export default async function ProjectsPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/projekti", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "projects.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-6xl">
      <ProjectsClient
        canManage={can(auth.ctx.roles, "projects.manage")}
        canAssign={can(auth.ctx.roles, "projects.assign")}
        canOverride={can(auth.ctx.roles, "projects.override")}
      />
    </main>
  );
}
