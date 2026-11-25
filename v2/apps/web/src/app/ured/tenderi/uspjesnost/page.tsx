import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { PageHeader, Stack } from "@/components/ui/index";
import { tenderPerformance } from "@/server/tender-outcome-service";
import { PerformanceView } from "./performance-view";

export const dynamic = "force-dynamic";

type Search = { from?: string; to?: string; partnerId?: string };

/**
 * Uspješnost tendera (spec 08 §1.5/21, §4).
 *
 * Brojevi su IZRAČUN, ne tabela: win rate po broju i po vrijednosti, prosječne marže dobijenih
 * vs izgubljenih, po naručiocu i „vrijednost u toku“ bez terminalnih statusa. Ekran ne nudi
 * maržu onome ko je ne smije vidjeti — `tenderPerformance` je ne vraća bez `price.manage`.
 */
export default async function TenderUspjesnostPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const query = await searchParams;
  const request = new NextRequest("http://interni/ured/tenderi/uspjesnost", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "tenders.view")) redirect("/nemate-pristup");

  const result = await tenderPerformance(
    await getVerifiedPool(),
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles as Role[] },
    { from: query.from ?? null, to: query.to ?? null, partnerId: query.partnerId ?? null },
  );

  const header = (
    <PageHeader
      title="Uspješnost tendera"
      subtitle="Win rate, marže i vrijednost u toku — izračun iz tendera, ne ručna tabela."
      actions={<Link className="gx-link" href="/ured/tenderi">← Nazad na listu</Link>}
    />
  );

  if (!("totalCount" in result)) {
    return (
      <main className="mx-auto w-full max-w-6xl">
        {header}
        <p className="gx-page-sub">Nemate pravo pregleda uspješnosti.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl">
      {header}
      <Stack>
        <PerformanceView p={result} />
      </Stack>
    </main>
  );
}
