import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { EmptyState, PageHeader } from "@/components/ui/index";
import { WorkdaysTable } from "./workdays-table";
import { listWorkdaysForReview, resolveViewerWorkerId, workdayReviewScopeFor } from "@/server/workday-review";
import { reviewLabel } from "./review-label";

export const dynamic = "force-dynamic";

/**
 * Uredski pregled radnih dana (UI Step 7) — samo čitanje.
 *
 * Oznake za provjeru se računaju iz serverovog stanja, ne iz klijenta: nepoznat kraj,
 * otvoren segment, sukob u sync-u. Potvrđivanje/razrješenje nije dio ovog koraka (R4b).
 *
 * C.1: `?filter=za-provjeru` sužava listu na dane s oznakom — na nj vodi red
 * „Dani za provjeru“ s Pregleda, pa šta god taj broj kaže, to čovjek ovdje vidi.
 */
export default async function RadniDaniPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/radni-dani", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workdays.view")) redirect("/nemate-pristup");

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const onlyReview = first(params.filter) === "za-provjeru";

  const days = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, auth.ctx.companyId, auth.ctx.userId);
    const all = await listWorkdaysForReview(client, auth.ctx.companyId, workdayReviewScopeFor(auth.ctx.roles, viewerWorkerId));
    return onlyReview ? all.filter((day) => reviewLabel(day) !== null) : all;
  });

  return (
    <main>
      <PageHeader
        title="Radni dani"
        subtitle={
          onlyReview
            ? "Samo dani s oznakom „Za provjeru“ (otvoren segment ili kraj nepoznat)."
            : "Pregled dana pristiglih sa terena. Samo čitanje — potvrda i razrješenje nisu dio ovog koraka."
        }
      />
      {onlyReview && days.length === 0 ? (
        <EmptyState
          title="Nema dana za provjeru"
          description="Trenutno nijedan pristigli dan nema otvoren segment ni nepoznat kraj."
          action={<Link href="/ured/radni-dani">Prikaži sve radne dane</Link>}
        />
      ) : (
        <WorkdaysTable days={days} />
      )}
    </main>
  );
}
