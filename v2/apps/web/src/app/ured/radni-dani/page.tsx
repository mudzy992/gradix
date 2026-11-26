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
import { WorkdaysClient } from "./workdays-client";
import {
  listWeekApprovals,
  listWorkdaysForReview,
  resolveViewerWorkerId,
  workdayReviewScopeFor,
} from "@/server/workday-review";
import { reviewLabel } from "./review-label";
import { weekStartFromWorkDate } from "./approval-label";

export const dynamic = "force-dynamic";

/**
 * Radni dani — pregled + R4b potvrda/sedmica/ispravka.
 * Capability flagovi su booleani; funkcije se ne prosljeđuju klijentu (pravilo 12).
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
  const onlyUnconfirmed = first(params.filter) === "bez-potvrde";

  const { days, weeks } = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, auth.ctx.companyId, auth.ctx.userId);
    const all = await listWorkdaysForReview(client, auth.ctx.companyId, workdayReviewScopeFor(auth.ctx.roles, viewerWorkerId), 200,
      onlyUnconfirmed ? {unconfirmed:true, projectIds:auth.ctx.scope === "COMPANY" ? null : auth.ctx.scope === "PROJECTS" ? auth.ctx.projectIds ?? [] : []} : undefined);
    const filtered = all.filter((day) => (!onlyReview || reviewLabel(day) !== null)
      && (!onlyUnconfirmed || (day.status === "SUBMITTED" && day.approval_status === "SUBMITTED")));
    const weekStarts = [...new Set(filtered.map((day) => weekStartFromWorkDate(day.work_date)))];
    const weeks = await listWeekApprovals(client, auth.ctx.companyId, weekStarts);
    return { days: filtered, weeks };
  });

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link className="gx-link" href="/ured/radni-dani/sedmica">
          Sedmični pregled (radnik × dan) →
        </Link>
      </p>
      <PageHeader
        title="Radni dani"
        subtitle={
          onlyReview
            ? "Samo dani s oznakom „Za provjeru“ (otvoren segment ili kraj nepoznat)."
            : onlyUnconfirmed ? "Samo predani dani bez potvrde." : "Pregled dana s terena. Šef potvrđuje dan; ured odobrava, odbija, zaključava ili ispravlja."
        }
      />
      {onlyUnconfirmed ? <p className="gx-page-sub">Prikazuje se najviše 200 najnovijih dana; odaberite sedmicu u listi.</p> : null}
      {onlyReview && days.length === 0 ? (
        <EmptyState
          title="Nema dana za provjeru"
          description="Trenutno nijedan pristigli dan nema otvoren segment ni nepoznat kraj."
          action={<Link href="/ured/radni-dani">Prikaži sve radne dane</Link>}
        />
      ) : (
        <WorkdaysClient
          days={days}
          weeks={weeks}
          caps={{
            canConfirm: can(auth.ctx.roles, "workdays.confirm"),
            canDecide: can(auth.ctx.roles, "workdays.week_decide"),
            canLock: can(auth.ctx.roles, "workdays.lock"),
            canRevise: can(auth.ctx.roles, "workdays.revise"),
          }}
        />
      )}
    </main>
  );
}
