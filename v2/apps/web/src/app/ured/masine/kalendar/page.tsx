import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { PageHeader } from "@/components/ui/index";
import { AvailabilityCalendar } from "./availability-calendar";

export const dynamic = "force-dynamic";

/**
 * Kalendar zauzetosti (Modul 5 §1.7.28). Dozvola je `equipment.view` — kalendar je PREGLED, ne
 * izmjena; dodjele se prave na projektu, gdje se i provjerava preklapanje.
 */
export default async function KalendarPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/masine/kalendar", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "equipment.view")) redirect("/nemate-pristup");

  // Početni mjesec je mjesec poslovnog datuma firme, ne UTC — kalendar mjeseca se ne smije
  // „pomjeriti" za jedan dan u vremenskoj zoni koja nije Sarajevo.
  const month = new Date().toISOString().slice(0, 7);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Zauzetost mašina"
        subtitle="Koja je mašina gdje po danima. Slobodno je prazna ćelija."
      />
      <AvailabilityCalendar initialMonth={month} />
    </main>
  );
}
