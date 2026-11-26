import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { CompanyId } from "@gradix/db";
import type { Project } from "@gradix/contracts";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { getVerifiedPool } from "@/server/db";
import { getProject, isServiceError } from "@/server/project-service";
import { ProjectPageClient } from "./project-page-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/projekti/{id}` — duboki link do projekta (spec 06 §4).
 *
 * Zašto postoji, kad se detalj već otvara iz liste: link mora raditi. Trošak vodi na izvorni
 * zapis, obavještenje o pragu budžeta vodi na projekat — bez rute bi ti linkovi završavali na
 * listi i čovjek bi opet tražio red. Isti `ProjectDetail` se koristi i ovdje, pa nema dva prikaza
 * koji se razilaze.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/projekti", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "projects.view")) redirect("/nemate-pristup");

  const { id } = await params;
  const project = await getProject(await getVerifiedPool(), auth.ctx.companyId as CompanyId, {
    userId: auth.ctx.userId,
    roles: auth.ctx.roles,
    scope: auth.ctx.scope,
    projectIds: auth.ctx.projectIds ?? null,
  }, id);
  if (isServiceError(project)) notFound();
  /*
   * Servis vraća `status` kao `string` (baza ga ne ograničava tipom), a ugovor kao uniju. Provjera
   * je već iznad — projekat koji ne postoji/ne pripada firmi daje `NOT_FOUND`. Vrijednost statusa
   * u bazi nosi CHECK, pa je tvrdnja tipa sigurna.
   */
  const dto: Project = { ...project, status: project.status as Project["status"] };

  return (
    <main className="mx-auto w-full max-w-6xl">
      <ProjectPageClient
        project={dto}
        canManage={can(auth.ctx.roles, "projects.manage")}
        canBook={can(auth.ctx.roles, "projects.costs.book")}
        canApproveManual={can(auth.ctx.roles, "purchase.approve")}
        canAssign={can(auth.ctx.roles, "projects.assign")}
        canOverride={can(auth.ctx.roles, "projects.override")}
        canSeeMoney={can(auth.ctx.roles, "projects.costs.view")}
      />
    </main>
  );
}
