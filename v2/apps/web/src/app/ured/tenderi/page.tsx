import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { Inline, PageHeader } from "@/components/ui/index";
import { listTenders } from "@/server/tender-service";
import { TendersClient } from "./tenders-client";

export const dynamic = "force-dynamic";

export default async function TenderiPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/tenderi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "tenders.view")) redirect("/nemate-pristup");

  const pool = await getVerifiedPool();
  const tenders = await listTenders(pool, {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles as Role[],
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Tenderi"
        subtitle="Od prilike do ishoda i konverzije u projekat."
        actions={
          <Inline>
            <Link className="gx-link" href="/ured/tenderi/kalendar">Kalendar rokova →</Link>
            <Link className="gx-link" href="/ured/tenderi/uspjesnost">Uspješnost →</Link>
          </Inline>
        }
      />
      <TendersClient
        initialTenders={tenders}
        caps={{
          canExport: auth.ctx.scope === "COMPANY" && can(auth.ctx.roles, "export.data"),
          canManage: can(auth.ctx.roles, "tenders.manage"),
          canConvert: can(auth.ctx.roles, "tenders.convert"),
          canPrice: can(auth.ctx.roles, "tenders.price.manage"),
          canApprovePrice: can(auth.ctx.roles, "tenders.price.approve"),
          canOutcome: can(auth.ctx.roles, "tenders.outcome.manage"),
        }}
      />
    </main>
  );
}
