import { cookies } from "next/headers";
import Link from "next/link";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { Card, PageHeader, SectionTitle, Stack } from "@/components/ui/index";

export const dynamic = "force-dynamic";

/**
 * Profil — ulaz u „Moje sesije“ i (kasnije) lične postavke. Bez posebne dozvole: svako
 * ima pravo vidjeti svoje uređaje i svoju 2FA.
 */
export default async function ProfilePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/profil", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");

  return (
    <main className="mx-auto w-full max-w-3xl">
      <Stack>
        {/* Naslov stranice je `h1`; `SectionTitle` je `h2` i ne smije nositi naslov ekrana. */}
        <PageHeader title="Moj profil" subtitle="Uređaji na kojima ste prijavljeni i sigurnost naloga." />
        <Card>
          <SectionTitle>Prečice</SectionTitle>
          <Stack>
            <p>
              <Link className="gx-link" href="/ured/profil/sesije">
                Moje sesije i uređaji
              </Link>{" "}
              — popis prijavljenih uređaja, odjava pojedinačnog i „odjavi sve ostale“.
            </p>
            <p>
              <Link className="gx-link" href="/ured/postavke">
                Postavke firme
              </Link>{" "}
              — podaci firme, radno vrijeme, praznici i 2FA (traži dozvolu).
            </p>
          </Stack>
        </Card>
      </Stack>
    </main>
  );
}
