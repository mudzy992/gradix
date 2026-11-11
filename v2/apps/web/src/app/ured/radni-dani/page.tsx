import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/index";
import { WorkdaysTable } from "./workdays-table";
import { listWorkdaysForReview, resolveViewerWorkerId, workdayReviewScopeFor } from "@/server/workday-review";

export const dynamic = "force-dynamic";

/**
 * Uredski pregled radnih dana (UI Step 7) — samo čitanje.
 *
 * Oznake za provjeru se računaju iz serverovog stanja, ne iz klijenta: nepoznat kraj,
 * otvoren segment, sukob u sync-u. Potvrđivanje/razrješenje nije dio ovog koraka (R4b).
 */
export default async function RadniDaniPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/radni-dani", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workdays.view")) redirect("/nemate-pristup");

  const days = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, auth.ctx.companyId, auth.ctx.userId);
    return listWorkdaysForReview(client, auth.ctx.companyId, workdayReviewScopeFor(auth.ctx.roles, viewerWorkerId));
  });

  return (
    <main>
      <PageHeader
        title="Radni dani"
        subtitle="Pregled dana pristiglih sa terena. Samo čitanje — potvrda i razrješenje nisu dio ovog koraka."
      />
<WorkdaysTable days={days} />
    </main>
  );
}
