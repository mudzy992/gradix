import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect, notFound } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import type { CompanyId } from "@gradix/db";
import { getTender } from "@/server/tender-service";
import { nextTenderStatuses } from "@/server/tender-status";
import { listTenderAttachments } from "@/server/tender-attachment-service";
import { listObligations } from "@/server/obligation-service";
import { listTenderChecklist } from "@/server/tender-checklist-service";
import { calculateTenderOffer, listTenderBoq, listTenderPriceRevisions, listTenderResources } from "@/server/tender-pricing";
import { getTenderOutcome } from "@/server/tender-outcome-service";
import { listTenderTeam } from "@/server/tender-team-service";
import { TenderDetailClient } from "./tender-detail-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export default async function TenderDetailPage({ params }: Ctx) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const { id } = await params;
  const request = new NextRequest(`http://interni/ured/tenderi/${id}`, {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "tenders.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const actor = {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles as Role[],
  };
  const tender = await getTender(pool, actor, id);
  if (!tender) notFound();

  const attachmentsResult = await listTenderAttachments(pool, actor, id);
  const attachments = Array.isArray(attachmentsResult) ? attachmentsResult : [];

  const obligationsPage = await listObligations(
    pool,
    auth.ctx.companyId as CompanyId,
    { tenderId: id },
    { scope: "COMPANY", userId: auth.ctx.userId, includeAttachments: false },
  );

  const checklist = await listTenderChecklist(pool, actor, id);
  const checklistItems = "items" in checklist ? checklist.items : [];
  const blocking = "blocking" in checklist ? checklist.blocking : [];

  /* Kalkulacija se učitava SAMO onome ko smije: ACCOUNTANT dobija prazan skup i tab mu se ne
     prikazuje — podatak ne postoji u odgovoru, ne samo u UI-u (spec 08 §1.7/26). */
  const canPrice = can(auth.ctx.roles, "tenders.price.manage");
  const canApprovePrice = can(auth.ctx.roles, "tenders.price.approve");

  const boq = canPrice ? await listTenderBoq(pool, actor, id) : [];
  const resources = canPrice ? await listTenderResources(pool, actor, id) : [];
  const revisions = canPrice ? await listTenderPriceRevisions(pool, actor, id) : [];
  const calculationResult = canPrice ? await calculateTenderOffer(pool, actor, id) : null;

  const outcomeResult = await getTenderOutcome(pool, actor, id);
  const outcome = outcomeResult.ok ? outcomeResult.outcome : null;

  const teamResult = await listTenderTeam(pool, actor, id);
  const team = teamResult && "team" in teamResult ? teamResult.team : [];
  const phases = teamResult && "phases" in teamResult ? teamResult.phases : [];

  return (
    <main className="mx-auto w-full max-w-6xl">
      <TenderDetailClient
        tender={tender}
        nextStatuses={nextTenderStatuses(tender.status)}
        initialAttachments={attachments}
        initialObligations={obligationsPage.obligations}
        initialChecklist={checklistItems}
        initialBlocking={blocking}
        initialCalculation={
          calculationResult && "calculation" in calculationResult ? calculationResult.calculation : null
        }
        initialBoq={Array.isArray(boq) ? boq : []}
        initialResources={Array.isArray(resources) ? resources : []}
        initialRevisions={Array.isArray(revisions) ? revisions : []}
        initialOutcome={outcome}
        initialTeam={team}
        initialPhases={phases}
        caps={{
          canManage: can(auth.ctx.roles, "tenders.manage"),
          canConvert: can(auth.ctx.roles, "tenders.convert"),
          canPrice,
          canApprovePrice,
          canOutcome: can(auth.ctx.roles, "tenders.outcome.manage"),
        }}
      />
    </main>
  );
}
