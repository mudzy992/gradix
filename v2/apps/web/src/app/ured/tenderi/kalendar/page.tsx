import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { PageHeader, Stack } from "@/components/ui/index";
import { loadTenderCalendar } from "@/server/tender-calendar-service";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

/**
 * Kalendar tenderskih rokova i garancija (spec 08 §4).
 *
 * Događaji: rok dostave, rok za pitanja, obilazak lokacije, otvaranje ponuda i istek
 * garancije. Garancije se čitaju posebno jer nijesu kolone tendera; vraćene se preskaču jer
 * više nijesu obaveza prema banci.
 */
export default async function TenderKalendarPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/tenderi/kalendar", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "tenders.view")) redirect("/nemate-pristup");

  const rows = await loadTenderCalendar(await getVerifiedPool(), auth.ctx);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Kalendar tendera"
        subtitle="Rokovi dostave, pitanja, obilazak, otvaranje i istek garancija — po datumu."
        actions={<Link className="gx-link" href="/ured/tenderi">← Nazad na listu</Link>}
      />
      <Stack>
        <CalendarView rows={rows} />
      </Stack>
    </main>
  );
}
