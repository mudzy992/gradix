import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { companyId as toCompanyId } from "@gradix/db";
import { PageHeader, TextLink } from "@/components/ui/index";
import { listDiaries } from "@/server/diary-service";
import { listProjects } from "@/server/project-service";
import { DnevnikClient } from "./dnevnik-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/dnevnik` — dani po projektu, sa onim što traži pažnju.
 *
 * Zašto lista, a ne kalendar kao prvi pogled: pitanje šefa nije „koji je dan u mjesecu“, nego
 * „koji dan nije potpisan“. Kalendar bez tog odgovora izgleda uredno i kad tri dana nemaju
 * potpis. Zato nestali potpisi stoje iznad liste, kao traka upozorenja.
 */
export default async function DnevnikPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/dnevnik", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "diary.view")) redirect("/nemate-pristup");

  const actor = { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles };
  const pool = await getVerifiedPool();
  const [diaries, unsigned, projects] = await Promise.all([
    listDiaries(pool, actor, { limit: 200 }),
    listDiaries(pool, actor, { unsignedOnly: true, limit: 50 }),
    listProjects(pool, toCompanyId(auth.ctx.companyId), {
      userId: auth.ctx.userId,
      roles: auth.ctx.roles,
      scope: auth.ctx.scope ?? "COMPANY",
      projectIds: auth.ctx.projectIds ?? null,
    }, { includeInactive: false }),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Dnevnik građenja"
        subtitle="Jedan dan po projektu. Radnici, mašine, ture i kvarovi se pune sami; ručno se piše samo ono što sistem ne zna."
        actions={<TextLink href="/ured/postavke">Šablon PDF-a</TextLink>}
      />
      <DnevnikClient
        initialDiaries={diaries}
        unsigned={unsigned}
        projects={projects.map((project) => ({ id: project.id, code: project.code, name: project.name }))}
        caps={{
          canManage: can(auth.ctx.roles, "diary.manage"),
          canSign: can(auth.ctx.roles, "diary.sign"),
        }}
      />
    </main>
  );
}
