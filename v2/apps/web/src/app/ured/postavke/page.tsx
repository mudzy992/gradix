import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import PostavkeClient from "./postavke-client";

export const dynamic = "force-dynamic";

/**
 * Postavke firme (F1). Server provjerava prije renderovanja — klijent ne dobija ništa što
 * nije prošlo sesiju, obaveznu promjenu lozinke i dozvolu `company.settings.view`.
 *
 * Redoslijed provjera je namjeran i drugačiji nego prije:
 *   1. **uparivanje 2FA** — sesija izdata radi uparivanja smije vidjeti SAMO ovaj ekran (tab
 *      Sigurnost). Bez ovoga je nalog koji mora upariti 2FA bio zaključan: API je puštao
 *      `/auth/2fa/enroll`, ali ga je stranica preusmjeravala na `/pregled`, gdje je dobijao 403.
 *   2. promjena lozinke — poslije nje korisnik ide na uparivanje, ne na `/ured/korisnici`.
 *   3. dozvola `company.settings.view` — osim za uparivanje, jer to nije poslovni ekran.
 */
export default async function PostavkePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/postavke", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");

  // Sesija za uparivanje: samo ovaj ekran, i to obavezno na tabu Sigurnost.
  if (auth.ctx.enrollmentPending) {
    return (
      <main className="mx-auto w-full max-w-5xl">
        <PostavkeClient canManage={false} onlyTab="sigurnost" />
      </main>
    );
  }

  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "company.settings.view")) redirect("/nemate-pristup");

  const { tab } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-5xl">
      <PostavkeClient
        canManage={can(auth.ctx.roles, "company.settings.manage")}
        onlyTab={tab === "sigurnost" ? "sigurnost" : undefined}
      />
    </main>
  );
}
