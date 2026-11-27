import { withCompany, companyId } from "@gradix/db";
import type { Pool } from "pg";
import { can } from "./permissions";
import type { EquipmentActor } from "./equipment-scope";
import type { TenderStatus } from "@gradix/contracts";

export type TenderCalendarEvent = {
  kind: string; tenderId: string; title: string; at: string; extra: string | null; status: TenderStatus; days: number;
};

/** The only PROJECTS link is the converted project. Unlinked tenders fail closed. */
export async function loadTenderCalendar(pool: Pool, actor: EquipmentActor, now = Date.now()): Promise<TenderCalendarEvent[]> {
  if (!can(actor.roles, "tenders.view") || actor.scope === "SELF") return [];
  return withCompany(pool, companyId(actor.companyId), async client => {
    const rows = await client.query<{
      id:string; title:string; status:TenderStatus; deadline_at:string|null; questions_deadline_at:string|null;
      site_visit_at:string|null; opened_at:string|null; guarantee_label:string|null; valid_until:string|null; bank:string|null;
    }>(`SELECT t.id,t.title,t.status,t.deadline_at::text,t.questions_deadline_at::text,t.site_visit_at::text,t.opened_at::text,
          c.label AS guarantee_label,c.valid_until::text,c.bank
        FROM public.tenders t LEFT JOIN public.tender_checklist_items c ON c.company_id=t.company_id AND c.tender_id=t.id
          AND c.guarantee_type IS NOT NULL AND c.returned_at IS NULL AND c.valid_until IS NOT NULL
        WHERE t.company_id=$1 AND ($2::text='COMPANY' OR ($2::text='PROJECTS' AND t.converted_project_id=ANY($3::text[])
          AND EXISTS (SELECT 1 FROM public.project_assignments pa
            JOIN public.workers w ON w.company_id=pa.company_id AND w.id=pa.worker_id
            JOIN public.companies co ON co.id=pa.company_id
            WHERE pa.company_id=t.company_id AND pa.project_id=t.converted_project_id AND w.user_id=$4 AND w.is_active
              AND pa.voided_at IS NULL AND pa.from_date <= (clock_timestamp() AT TIME ZONE co.timezone)::date
              AND (pa.to_date IS NULL OR pa.to_date >= (clock_timestamp() AT TIME ZONE co.timezone)::date))))
        ORDER BY t.id,c.valid_until,c.id`, [actor.companyId,actor.scope,actor.projectIds ?? [],actor.userId]);
    const events: TenderCalendarEvent[] = [];
    const seen = new Set<string>();
    const add = (row: typeof rows.rows[number], kind:string, at:string|null, extra:string|null = null) => {
      if (!at) return;
      events.push({kind,tenderId:row.id,title:row.title,at,extra,status:row.status,days:Math.round((Date.parse(at)-now)/86_400_000)});
    };
    for (const row of rows.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        add(row,"Rok dostave",row.deadline_at); add(row,"Rok za pitanja",row.questions_deadline_at);
        add(row,"Obilazak lokacije",row.site_visit_at); add(row,"Otvaranje ponuda",row.opened_at);
      }
      if (row.valid_until && row.guarantee_label) add(row,"Istek garancije",`${row.valid_until}T00:00:00.000Z`,`${row.guarantee_label}${row.bank ? ` · ${row.bank}` : ""}`);
    }
    return events.sort((a,b) => a.at.localeCompare(b.at));
  });
}
