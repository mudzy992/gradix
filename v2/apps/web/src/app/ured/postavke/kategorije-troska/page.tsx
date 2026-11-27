import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { KategorijeTroskaClient } from "./kategorije-troska-client";

export const dynamic = "force-dynamic";

/**
 * Kategorije troška — šifarnik firme (spec 06 §1.3.14).
 *
 * Zašto sopstvena stranica, a ne tab u Postavkama: kategorija troška je dio knjige troškova, ne
 * postavka firme. Vidi je onaj ko vidi troškove (`projects.costs.view`), mijenja onaj ko upravlja
 * budžetom — a to nije nužno ista osoba koja mijenja radnu sedmicu.
 */
export default async function KategorijeTroskaPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/postavke/kategorije-troska", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "projects.costs.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-5xl">
      <KategorijeTroskaClient canManage={can(auth.ctx.roles, "projects.costs.manage")} />
    </main>
  );
}
