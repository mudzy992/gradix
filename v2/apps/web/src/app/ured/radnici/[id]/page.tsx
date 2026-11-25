import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getVerifiedPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { getWorkerProfile, businessToday, listRates, workerLeave, listIssuances, workerHistory } from "@/server/worker-service";
import { WorkerDetailClient } from "./worker-detail-client";

export const dynamic = "force-dynamic";

/**
 * Kartica radnika — jedan ekran, pet sekcija.
 *
 * Dozvole se rješavaju OVDJE, na serveru, i to po sekciji: `workers.view` daje karticu,
 * ali cijene traže `workers.rates.view`, a osjetljiva polja `workers.sensitive.view`. Klijent
 * dobija samo ono što smije da vidi — sekcija koja nije dozvoljena se ne renderuje, ne skriva CSS-om.
 */
export default async function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/radnici", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workers.view")) redirect("/nemate-pristup");

  const { id } = await params;
  const pool = await getVerifiedPool();
  const actor = { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles };

  const sawSensitive = can(auth.ctx.roles, "workers.sensitive.view");
  const profile = await getWorkerProfile(pool, actor, id, { canSeeSensitive: sawSensitive });
  if (!profile.ok) notFound();

  const canSeeRates = can(auth.ctx.roles, "workers.rates.view");
  const [rates, leave, issuances, history] = await Promise.all([
    canSeeRates ? listRates(pool, actor, id, await businessToday(pool, auth.ctx.companyId)) : Promise.resolve(null),
    can(auth.ctx.roles, "workers.leave.view") ? workerLeave(pool, actor, id) : Promise.resolve(null),
    can(auth.ctx.roles, "workers.issuances.view") ? listIssuances(pool, actor, id, true) : Promise.resolve(null),
    workerHistory(pool, actor, id),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <div className="mb-4">
        <Link className="gx-link text-sm" href="/ured/radnici">
          ← Radnici
        </Link>
      </div>
      <WorkerDetailClient
        worker={profile.worker}
        caps={{
          canManage: can(auth.ctx.roles, "workers.manage"),
          canSeeSensitive: sawSensitive,
          canSeeRates,
          canManageRates: can(auth.ctx.roles, "workers.rates.manage"),
          canManageLeave: can(auth.ctx.roles, "workers.leave.manage"),
          canManageIssuances: can(auth.ctx.roles, "workers.issuances.manage"),
          canSeePayroll: can(auth.ctx.roles, "payroll.view"),
          canManagePayroll: can(auth.ctx.roles, "payroll.manage"),
        }}
        rates={rates && rates.ok ? { rates: rates.rates, current: rates.current } : null}
        leave={leave && leave.ok ? leave.years : null}
        issuances={issuances && issuances.ok ? { issuances: issuances.issuances, activeCount: issuances.activeCount } : null}
        history={history.ok ? history.entries : []}
      />
    </main>
  );
}
