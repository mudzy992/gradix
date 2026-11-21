/**
 * Server omotač okvira: iz sesije izvlači ime, firmu i role, pa gradi SAMO stavke koje
 * osoba smije otvoriti.
 *
 * Zašto filter ovdje, a ne u klijentu: meni koji nudi stavku koja vraća 403 je isti problem
 * kao dugme koje ne može proći. Ruta i dalje provjerava sve (guard), ovo je samo da se ne
 * nudi ono što je zabranjeno.
 *
 * Ako sesije nema, okvir se ne renderuje — stranica koja ga koristi ionako preusmjerava na
 * prijavu, pa ovdje nema drugog puta.
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import Shell, { type NavGroup } from "./shell";
import { navGroupsForRoles } from "./nav";
import { can } from "@/server/permissions";
import { countOpenConflicts } from "@/server/workday-resolve";
import { resolveViewerWorkerId, workdayResolveScopeFor } from "@/server/workday-review";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return <>{children}</>;

  // `authenticate` čita cookie kroz `request.cookies` — samo NextRequest to ima.
  const request = new NextRequest("http://interni/okvir", { headers: { cookie: `${ACCESS_COOKIE}=${token}` } });
  const auth = await authenticate(request);
  if (!auth.ok) return <>{children}</>;

  const ctx = auth.ctx;
  const pool = await getVerifiedPool();

  const profile = await withCompany(pool, ctx.companyId, async (client) => {
    const result = await client.query<{ first_name: string; last_name: string; email: string; name: string }>(
      `SELECT u.first_name, u.last_name, u.email, c.name
         FROM users u JOIN companies c ON c.id = $2
        WHERE u.id = $1`,
      [ctx.userId, ctx.companyId],
    );
    return result.rows[0] ?? null;
  });

  // Bedž broji samo nerazriješene sukobe u opsegu osobe; bez dozvole nema ni upita.
  let badges: Partial<Record<string, { count: number; older: number }>> = {};
  if (can(ctx.roles, "workdays.resolve")) {
    const conflictCounts = await withCompany(pool, ctx.companyId, async (client) => {
      const viewerWorkerId = await resolveViewerWorkerId(client, ctx.companyId, ctx.userId);
      return countOpenConflicts(client, ctx.companyId, workdayResolveScopeFor(ctx.roles, viewerWorkerId));
    });
    badges = { "/ured/sukobi": { count: conflictCounts.open, older: conflictCounts.olderThanThreshold } };
  }

  const groups: NavGroup[] = navGroupsForRoles(ctx.roles, badges);

  // Ime za header: ime i prezime iz baze, ne iz tokena (token nosi samo id).
  const displayName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : "Korisnik";

  return (
    <Shell
      groups={groups}
      user={{
        displayName,
        email: profile?.email ?? "",
        companyName: profile?.name ?? "Firma",
        roles: ctx.roles,
      }}
    >
      {children}
    </Shell>
  );
}
