import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect, notFound } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import type { CompanyId } from "@gradix/db";
import { getTender } from "@/server/tender-service";
import { listTenderAttachments } from "@/server/tender-attachment-service";
import { listObligations } from "@/server/obligation-service";
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

  return (
    <main className="mx-auto w-full max-w-6xl">
      <TenderDetailClient
        tender={tender}
        initialAttachments={attachments}
        initialObligations={obligationsPage.obligations}
        caps={{
          canManage: can(auth.ctx.roles, "tenders.manage"),
          canConvert: can(auth.ctx.roles, "tenders.convert"),
        }}
      />
    </main>
  );
}
