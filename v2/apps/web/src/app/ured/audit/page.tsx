import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { listUsers } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import AuditClient from "./audit-client";

export const dynamic = "force-dynamic";

/**
 * Server priprema spisak osoba za filter (samo id + ime); klijent ne dobija ništa što
 * `authenticate` nije propustio.
 */
export default async function AuditPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  // `authenticate` čita cookie kroz `request.cookies` — samo NextRequest to ima.
  const request = new NextRequest("http://interni/ured/audit", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "audit.view")) redirect("/pregled");

  const users = await listUsers(await getVerifiedPool(), auth.ctx.companyId);
  const actors = users.map((user) => ({
    id: user.id,
    label: `${user.firstName} ${user.lastName}`.trim() || user.email,
  }));

  return (
    <main className="mx-auto w-full max-w-6xl">
      <AuditClient actors={actors} />
    </main>
  );
}
