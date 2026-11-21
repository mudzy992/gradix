import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { Breadcrumbs, Inline, PageHeader, TextLink } from "@/components/ui/index";
import { getConflictDetail, listConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";
import { filtersToQuery, parseFilters } from "../conflict-shared";
import { ConflictDetailClient } from "./conflict-detail-client";

export const dynamic = "force-dynamic";

/**
 * R4a-2/B: zasebna stranica jednog sukoba (`/ured/sukobi/[id]`).
 * Pristup je isti kao lista i API: bez `workdays.resolve` → /nemate-pristup
 * (403 obrazac aplikacije); tuđi (izvan opsega) ili nepostojeći sukob →
 * 404, isto kao API detalj (ne otkriva postojanje izvan opsega).
 * Direktan link radi nakon prijave; filteri liste dolaze u adresi i
 * „Nazad na listu" ih čuva.
 */
export default async function SukobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const { id } = await params;
  const request = new NextRequest("http://interni/ured/sukobi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workdays.resolve")) redirect("/nemate-pristup");

  const raw = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const filters = parseFilters({
    stanje: first(raw.stanje),
    starost: first(raw.starost),
    projekat: first(raw.projekat),
  });
  const backHref = `/ured/sukobi?${filtersToQuery(filters)}`;

  const data = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, auth.ctx.companyId, auth.ctx.userId);
    const scope = workdayResolveScopeFor(auth.ctx.roles, viewerWorkerId);
    const detail = await getConflictDetail(client, auth.ctx.companyId, scope, id);
    if (!detail) return { detail: null, nextId: null as string | null };
    const open = await listConflicts(client, auth.ctx.companyId, scope, { status: "OPEN", limit: 200 });
    const openIds = open.conflicts.map((row) => row.id);
    let nextId: string | null = null;
    if (detail.status === "OPEN") {
      const index = openIds.indexOf(detail.id);
      nextId = openIds.find((candidate, i) => candidate !== detail.id && (index === -1 || i > index)) ?? null;
    } else {
      nextId = openIds[0] ?? null;
    }
    return { detail, nextId };
  });

  if (!data.detail) notFound();

  const nextHref = data.nextId ? `/ured/sukobi/${data.nextId}?${filtersToQuery(filters)}` : null;

  return (
    <main>
      <Breadcrumbs
        items={[
          { label: "Radni dani", href: "/ured/radni-dani" },
          { label: "Sukobi", href: backHref },
          { label: "Detalj sukoba" },
        ]}
      />
      <PageHeader
        title="Detalj sukoba"
        subtitle="Oba unosa za isti segment. Odluka se potvrđuje dijalogom s obaveznim razlogom koji vidi autor odbačenog unosa."
      />
      <Inline>
        <TextLink href={backHref}>← Nazad na listu</TextLink>
        {nextHref ? <TextLink href={nextHref}>Sljedeći nerazriješeni →</TextLink> : null}
      </Inline>
      <ConflictDetailClient initial={data.detail} />
    </main>
  );
}
