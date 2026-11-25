import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect, notFound } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, TextLink } from "@/components/ui/index";
import { getDiary } from "@/server/diary-service";
import { DnevnikDetailClient } from "./dnevnik-detail-client";

export const dynamic = "force-dynamic";

/**
 * `/ured/dnevnik/[id]` — jedan dan: automatski popunjene sekcije, ručni unos, zastoji, potpis, PDF.
 *
 * Automatske sekcije (radnici, mašine, ture, kvarovi) se ne uređuju ovdje: one dolaze iz Modula 3/5
 * i ekran ih pokazuje onakve kakve su u evidenciji, sa napomenom da se ispravka radi tamo. Tako
 * dnevnik ne postaje drugo mjesto gdje sati mogu biti drugačiji.
 */
export default async function DnevnikDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/dnevnik", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "diary.view")) redirect("/nemate-pristup");

  const { id } = await params;
  const detail = await getDiary(
    await getVerifiedPool(),
    { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles },
    id,
  );
  if (!detail) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={`Dnevnik ${detail.diary.diaryDate}`}
        subtitle={`${detail.diary.projectCode} — ${detail.diary.projectName}`}
        actions={<TextLink href="/ured/dnevnik">Svi dnevnici</TextLink>}
      />
      <DnevnikDetailClient
        detail={detail}
        caps={{
          canManage: can(auth.ctx.roles, "diary.manage"),
          canSign: can(auth.ctx.roles, "diary.sign"),
        }}
      />
    </main>
  );
}
