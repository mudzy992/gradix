import { tenderRecordAllowed, tenderDenied } from "./tender-scope";
/**
 * F7 — kopiranje iz sličnog tendera (spec 08 §1.3/14).
 *
 * Šta se prenosi: predmjer, resursi, faze i kontrolna lista.
 * Šta se NE prenosi: naručilac, datumi, cijena, ishod.
 *
 * Zašto tako: „sličan tender“ je isti POSAO za drugog naručioca. Prenijeti datum ili cijenu
 * značilo bi da novi tender tvrdi nešto što nije provjereno (rok je prošao, cijena je stara),
 * a naručilac je uvijek novi podatak. Zato kopija nosi SAMO sadržaj koji se piše iznova.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { ensureChecklistTemplates } from "./tender-checklist-service";
import type { TenderActor } from "./tender-service";

export type CopyError = {
  outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND";
  code?: string;
  message: string;
};

export async function copyTenderContent(
  pool: Pool,
  actor: TenderActor,
  targetTenderId: string,
  sourceTenderId: string,
): Promise<{ outcome: "OK"; copied: { boq: number; resources: number; checklist: number } } | CopyError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo kopiranja." };
  }
  if (targetTenderId === sourceTenderId) {
    return { outcome: "VALIDATION_FAILED", message: "Ne možete kopirati tender u sam sebe." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    for (const id of [sourceTenderId, targetTenderId].sort()) {
      if (!await tenderRecordAllowed(client, actor, id, true)) return tenderDenied(actor);
    }
    const target = await client.query<{ status: string }>(
      `SELECT status FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [targetTenderId, actor.companyId],
    );
    if (!target.rows[0]) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." } as CopyError;
    /* Kopiranje u predani tender prepisalo bi ono što je naručiocu poslano. Zato samo dok
       tender nije izašao iz pripreme. */
    if (["SUBMITTED", "EVALUATION", "WON", "LOST", "WITHDRAWN", "CANCELLED"].includes(target.rows[0].status)) {
      return {
        outcome: "CONFLICT",
        code: "TENDER_INVALID_STATUS",
        message: "Kopiranje je dozvoljeno samo dok tender nije predan.",
      } as CopyError;
    }
    const source = await client.query(
      `SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [sourceTenderId, actor.companyId],
    );
    if ((source.rowCount ?? 0) === 0) {
      return { outcome: "NOT_FOUND", message: "Izvorni tender nije pronađen." } as CopyError;
    }

    // Predmjer: iste oznake, isti trošak i cijena — posao je isti.
    const boq = await client.query(
      `INSERT INTO public.tender_boq_items
         (id, company_id, tender_id, code, description, unit, quantity, unit_cost_cents,
          unit_price_cents, sort_order, created_by, updated_by)
       SELECT 'tbi_' || replace(gen_random_uuid()::text, '-', ''), company_id, $3, code, description,
              unit, quantity, unit_cost_cents, unit_price_cents, sort_order, $4, $4
         FROM public.tender_boq_items
        WHERE company_id = $1 AND tender_id = $2
       ON CONFLICT (company_id, tender_id, code) DO NOTHING`,
      [actor.companyId, sourceTenderId, targetTenderId, actor.userId],
    );

    const resources = await client.query(
      `INSERT INTO public.tender_resources
         (id, company_id, tender_id, kind, description, quantity, unit, unit_cost_cents,
          currency_code, worker_rate_ref, machine_id, sort_order, created_by, updated_by)
       SELECT 'trs_' || replace(gen_random_uuid()::text, '-', ''), company_id, $3, kind, description,
              quantity, unit, unit_cost_cents, currency_code, worker_rate_ref, machine_id,
              sort_order, $4, $4
         FROM public.tender_resources
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, sourceTenderId, targetTenderId, actor.userId],
    );

    const phases = await client.query(
      `INSERT INTO public.tender_phases
         (id, company_id, tender_id, code, name, weight, planned_start, planned_end, sort_order, created_by, updated_by)
       SELECT 'tph_' || replace(gen_random_uuid()::text, '-', ''), company_id, $3, code, name, weight,
              planned_start, planned_end, sort_order, $4, $4
         FROM public.tender_phases
        WHERE company_id = $1 AND tender_id = $2
       ON CONFLICT (company_id, tender_id, code) DO NOTHING`,
      [actor.companyId, sourceTenderId, targetTenderId, actor.userId],
    );

    /* Checklista se popunjava iz šifarnika, a NE kopira iz izvora: status („priloženo“) i
       prilog su činjenice o DRUGOM tenderu. Kopija bi tvrdila da novi tender već ima
       potvrdu koju nema. */
    await ensureChecklistTemplates(client, actor.companyId, actor.userId);
    const checklist = await client.query(
      `INSERT INTO public.tender_checklist_items
         (id, company_id, tender_id, code, label, required, status, sort_order, created_by, updated_by)
       SELECT 'tci_' || replace(gen_random_uuid()::text, '-', ''), t.company_id, $2, t.code, t.label,
              t.required, 'MISSING', t.sort_order, $3, $3
         FROM public.tender_checklist_templates t
        WHERE t.company_id = $1 AND t.is_active
       ON CONFLICT (company_id, tender_id, code) DO NOTHING`,
      [actor.companyId, targetTenderId, actor.userId],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.copied",
      entityType: "tender",
      entityId: targetTenderId,
      metadata: {
        from: sourceTenderId,
        boq: boq.rowCount ?? 0,
        resources: resources.rowCount ?? 0,
        phases: phases.rowCount ?? 0,
      },
    });

    return {
      outcome: "OK" as const,
      copied: {
        boq: boq.rowCount ?? 0,
        resources: resources.rowCount ?? 0,
        checklist: checklist.rowCount ?? 0,
      },
    };
  });
}

/**
 * Brzi unos iz sličnog: pravi novi tender (naručilac + naslov su obavezni) i odmah kopira
 * sadržaj. Vraća id novog tendera da UI može skočiti na njega.
 */
export async function createTenderFromSimilar(
  pool: Pool,
  actor: TenderActor,
  input: { sourceTenderId: string },
): Promise<{ outcome: "OK"; id: string; copied: { boq: number; resources: number; checklist: number } } | CopyError> {
  if (actor.scope !== "COMPANY") return tenderDenied(actor);
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo unosa." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const source = await client.query<{
      title: string;
      partner_id: string;
      currency_code: string;
      submitted_value_cents: string;
    }>(
      `SELECT title, partner_id, currency_code, submitted_value_cents::text
         FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [input.sourceTenderId, actor.companyId],
    );
    const row = source.rows[0];
    if (!row) return { outcome: "NOT_FOUND", message: "Izvorni tender nije pronađen." } as CopyError;

    const id = `tnd_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.tenders
         (id, company_id, title, partner_id, submitted_value_cents, currency_code, status,
          note, price_source, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'OPPORTUNITY',$7,'CALCULATED',$8,$8)`,
      [
        id,
        actor.companyId,
        `${row.title} (kopija)`.slice(0, 300),
        row.partner_id,
        // Cijena se NE kopira; do konverzije vrijednost je nula iz kalkulacije.
        "0",
        row.currency_code,
        "Kopirano iz sličnog tendera — datumi, cijena i ishod nijesu preneseni.",
        actor.userId,
      ],
    );

    const boq = await client.query(
      `INSERT INTO public.tender_boq_items
         (id, company_id, tender_id, code, description, unit, quantity, unit_cost_cents,
          unit_price_cents, sort_order, created_by, updated_by)
       SELECT 'tbi_' || replace(gen_random_uuid()::text, '-', ''), company_id, $3, code, description,
              unit, quantity, unit_cost_cents, unit_price_cents, sort_order, $4, $4
         FROM public.tender_boq_items
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, input.sourceTenderId, id, actor.userId],
    );
    const resources = await client.query(
      `INSERT INTO public.tender_resources
         (id, company_id, tender_id, kind, description, quantity, unit, unit_cost_cents,
          currency_code, worker_rate_ref, machine_id, sort_order, created_by, updated_by)
       SELECT 'trs_' || replace(gen_random_uuid()::text, '-', ''), company_id, $3, kind, description,
              quantity, unit, unit_cost_cents, currency_code, worker_rate_ref, machine_id,
              sort_order, $4, $4
         FROM public.tender_resources
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, input.sourceTenderId, id, actor.userId],
    );
    await ensureChecklistTemplates(client, actor.companyId, actor.userId);
    const checklist = await client.query(
      `INSERT INTO public.tender_checklist_items
         (id, company_id, tender_id, code, label, required, status, sort_order, created_by, updated_by)
       SELECT 'tci_' || replace(gen_random_uuid()::text, '-', ''), t.company_id, $2, t.code, t.label,
              t.required, 'MISSING', t.sort_order, $3, $3
         FROM public.tender_checklist_templates t
        WHERE t.company_id = $1 AND t.is_active`,
      [actor.companyId, id, actor.userId],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.copied",
      entityType: "tender",
      entityId: id,
      metadata: { from: input.sourceTenderId, created: true },
    });

    return {
      outcome: "OK" as const,
      id,
      copied: {
        boq: boq.rowCount ?? 0,
        resources: resources.rowCount ?? 0,
        checklist: checklist.rowCount ?? 0,
      },
    };
  });
}
