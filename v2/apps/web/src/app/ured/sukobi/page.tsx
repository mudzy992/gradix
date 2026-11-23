import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { ConflictsClient } from "./conflicts-client";
import { countOpenConflicts, listConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";
import { parseFilters } from "./conflict-shared";

export const dynamic = "force-dynamic";

/**
 * R4a-2: razrješenje sukoba radnih dana. Lista i brojke se računaju na serveru
 * (opseg iz koraka 2a); odluke idu kroz API u jednoj transakciji (korak 2b).
 * Dani za provjeru (otvoren segment / nepoznat kraj) ostaju na ekranu
 * „Radni dani" — ovdje su samo sukobi.
 *
 * B: filteri (stanje, starost, projekat) žive u adresi (?stanje=&starost=&projekat=),
 * pa ih detalj (`/ured/sukobi/[id]`) čuva kroz „Nazad na listu". Klik na red
 * vodi na zasebnu stranicu detalja; detalj se ne otvara ispod tabele.
 */
export default async function SukobiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/sukobi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workdays.resolve")) redirect("/nemate-pristup");

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const filters = parseFilters({
    stanje: first(params.stanje),
    starost: first(params.starost),
    projekat: first(params.projekat),
  });

  const data = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, auth.ctx.companyId, auth.ctx.userId);
    const scope = workdayResolveScopeFor(auth.ctx.roles, viewerWorkerId);
    const list = await listConflicts(client, auth.ctx.companyId, scope, {
      status: filters.status,
      olderThanDays: filters.olderOnly ? 0 : undefined,
      projectId: filters.projectId || undefined,
    });
    const counts = await countOpenConflicts(client, auth.ctx.companyId, scope);
    return { list, counts };
  });

  return (
    <main>
      <PageHeader
        title="Sukobi radnih dana"
        subtitle="Dva unosa za isti segment — ured bira jedan. Razlog vidi autor odbačenog unosa; interna napomena ostaje u uredu."
      />
      <ConflictsClient initial={data.list.conflicts} counts={data.counts} initialFilters={filters} />
    </main>
  );
}
