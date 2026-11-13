import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import ObligationsClient from "./obligations-client";
import { STATE_FROM_URL } from "./obligations-shared";

export const dynamic = "force-dynamic";

/**
 * Rokovi — `obligations.view` za listu, `obligations.manage` za unos, obnovu i priloge.
 *
 * C.1: stanje može doći i iz adrese (`?stanje=isteklo|uskoro|31-90`) — red na Pregledu
 * vodi OVAMO, pa filter mora živjeti u URL-u da „šta traži pažnju“ ne završi na
 * ne filtriranoj listi. Vrijednosti su riječi iz URL-a, NE interna stanja: ručno
 * kucanje "expired" ne prolazi (whitelist), jer bi inače URL bio API.
 */
export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/rokovi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "obligations.view")) redirect("/nemate-pristup");

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const initialStateFilter = STATE_FROM_URL[first(params.stanje) ?? ""] ?? "";

  return (
    <main className="mx-auto w-full max-w-6xl">
      <ObligationsClient
        canManage={can(auth.ctx.roles, "obligations.manage")}
        initialStateFilter={initialStateFilter}
      />
    </main>
  );
}
