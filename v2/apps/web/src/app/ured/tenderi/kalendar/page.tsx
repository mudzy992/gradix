import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { withCompany, type CompanyId } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { can, type Role } from "@/server/permissions";
import { PageHeader, Stack } from "@/components/ui/index";
import { listTenders } from "@/server/tender-service";
import type { TenderStatus } from "@gradix/contracts";
import { CalendarView, type CalendarRow } from "./calendar-view";

export const dynamic = "force-dynamic";

type EventDraft = Omit<CalendarRow, "status" | "days">;

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

  const pool = await getVerifiedPool();
  const tenders = await listTenders(pool, {
    userId: auth.ctx.userId,
    companyId: auth.ctx.companyId,
    roles: auth.ctx.roles as Role[],
  });

  const statusById = new Map<string, TenderStatus>(tenders.map((row) => [row.id, row.status]));
  const events: EventDraft[] = [];
  for (const tender of tenders) {
    const push = (kind: string, at: string | null, extra: string | null = null) => {
      if (at) events.push({ kind, tenderId: tender.id, title: tender.title, at, extra });
    };
    push("Rok dostave", tender.deadlineAt);
    push("Rok za pitanja", tender.questionsDeadlineAt);
    push("Obilazak lokacije", tender.siteVisitAt);
    push("Otvaranje ponuda", tender.openedAt);
  }

  const guarantees = await withCompany(pool, auth.ctx.companyId as CompanyId, (client) =>
    client.query<{ tender_id: string; title: string; label: string; valid_until: string; bank: string | null }>(
      `SELECT c.tender_id, t.title, c.label, c.valid_until::text, c.bank
         FROM public.tender_checklist_items c
         JOIN public.tenders t ON t.company_id = c.company_id AND t.id = c.tender_id
        WHERE c.company_id = $1 AND c.guarantee_type IS NOT NULL AND c.returned_at IS NULL
        ORDER BY c.valid_until`,
      [auth.ctx.companyId],
    ),
  );
  for (const row of guarantees.rows) {
    events.push({
      kind: "Istek garancije",
      tenderId: row.tender_id,
      title: row.title,
      at: `${row.valid_until}T00:00:00.000Z`,
      extra: `${row.label}${row.bank ? ` · ${row.bank}` : ""}`,
    });
  }

  const now = Date.now();
  const rows: CalendarRow[] = events
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((event) => ({
      ...event,
      days: Math.round((Date.parse(event.at) - now) / 86_400_000),
      status: statusById.get(event.tenderId) ?? "OPPORTUNITY",
    }));

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
