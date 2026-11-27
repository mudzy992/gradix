import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { ProjectTasks } from "../projekti/project-tabs/project-tasks";

export const dynamic = "force-dynamic";

/**
 * Svi zadaci firme — jedan ekran za pitanje „šta je otvoreno“ bez ulaska u projekat.
 *
 * Isti tab kao u detalju projekta, bez `projectId`: obrazac je jedan, pa se stanje (filter, izmjena,
 * komentari) ne uči dvaput. Dozvola je `projects.view`; dugmad za izmjenu traže `projects.manage`.
 */
export default async function ZadaciPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/zadaci", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "projects.view")) redirect("/nemate-pristup");

  const filter = (await searchParams).filter;
  const dashboardFilter = filter === "kasni" || filter === "otvoreni" ? filter : "";
  return (
    <main className="mx-auto w-full max-w-6xl">
      <h1 className="gx-page-title">Zadaci</h1>
      <p className="gx-page-sub">
        Otvoreni, blokirani i zadaci koji kasne — sa rokom i jednim izvršiocem po zadatku.
      </p>
      <ProjectTasks canManage={can(auth.ctx.roles, "projects.manage")} initialDashboardFilter={dashboardFilter} />
    </main>
  );
}
