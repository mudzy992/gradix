/**
 * F7 — atomska konverzija WON tender → projekat (spec 08 §1.6).
 *
 * Jedna `withCompany` transakcija prenosi SVE, ili ništa ne nastaje:
 *   1. `projects` sa `contract_value_cents` = zadnja ODOBRENA revizija ponude, `note`,
 *      `manager_worker_id` iz predloženog tima (§1.6/22.1);
 *   2. predmjer 1:1 u `project_boq_items` (isti `code`, `unit`, `quantity`, `unit_price`) — zato
 *      `tender_boq_items` ima istu strukturu (§1.3/10);
 *   3. faze iz `tender_phases`, ili jedna faza „Izvođenje“ sa težinom 1;
 *   4. obaveze koje pripadaju IZVOĐENJU (građevinska dozvola, saglasnosti) — tender-dokumenti
 *      ostaju na tenderu (§1.6/22.4);
 *   5. prilozi: nove veze na ISTI `object_key` (bajtovi se ne dupliraju);
 *   6. tim kao PREDLOG u `project_assignments` (`note='predlog iz tendera'`) — potvrđuje PM.
 *
 * Claim obrazac ostaje iz R7: `UPDATE ... WHERE status='WON' AND converted_project_id IS NULL`
 * uz `FOR UPDATE`. Djelimična konverzija nije moguća jer je sve u jednoj transakciji.
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";
import { approvedRevisionValue } from "./tender-pricing";

export type ConvertOutcome =
  | { outcome: "OK"; projectId: string; summary: ConvertSummary }
  | { outcome: "FORBIDDEN" | "CONFLICT" | "NOT_FOUND"; code?: string; message?: string };

export type ConvertSummary = {
  boqItems: number;
  phases: number;
  obligations: number;
  attachments: number;
  teamMembers: number;
};

export class ConvertClaimLost extends Error {
  constructor() {
    super("CONVERT_CLAIM_LOST");
    this.name = "ConvertClaimLost";
  }
}

/**
 * Obaveze koje se prenose na projekat: samo one koje su USLOV za izvođenje. Šifre su iz
 * `seed_obligation_types` (Modul 2), ne izmišljene ovdje.
 */
const PROJECT_OBLIGATION_CODES = ["BUILDING_PERMIT", "CONSENT", "ENVIRONMENT", "SITE_PLAN"] as const;

async function uniqueProjectCode(client: PoolClient, companyId: string, title: string): Promise<string> {
  const base = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const root = `T-${base || "NEW"}`.slice(0, 32);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root.slice(0, 28)}-${attempt}`;
    const exists = await client.query(`SELECT 1 FROM projects WHERE company_id = $1 AND code = $2`, [
      companyId,
      candidate,
    ]);
    if ((exists.rowCount ?? 0) === 0) return candidate;
  }
  // Fallback: kratki sufiks od vremena, da konverzija ne padne zbog 16 zauzetih imena.
  return `${root.slice(0, 24)}-${Date.now().toString(36).slice(-6)}`.slice(0, 40);
}

export async function convertTenderToProject(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<ConvertOutcome> {
  if (!can(actor.roles, "tenders.convert")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Nemate pravo konverzije." };
  }
  try {
    return await withCompany(pool, toCompanyId(actor.companyId), (client) =>
      convertLocked(client, actor, tenderId),
    );
  } catch (error) {
    if (error instanceof ConvertClaimLost) {
      return {
        outcome: "CONFLICT",
        code: "ALREADY_CONVERTED",
        message: "Tender je već pretvoren u projekat.",
      };
    }
    throw error;
  }
}

async function convertLocked(
  client: PoolClient,
  actor: TenderActor,
  tenderId: string,
): Promise<ConvertOutcome> {
  const found = await client.query<{
    title: string;
    note: string | null;
    status: string;
    converted_project_id: string | null;
    deadline_at: string | null;
    site_visit_at: string | null;
    currency_code: string;
  }>(
    `SELECT title, note, status, converted_project_id, deadline_at, site_visit_at, currency_code
       FROM public.tenders
      WHERE id = $1 AND company_id = $2
      FOR UPDATE`,
    [tenderId, actor.companyId],
  );
  const row = found.rows[0];
  if (!row) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
  if (row.status !== "WON") {
    return {
      outcome: "CONFLICT",
      code: "TENDER_INVALID_STATUS",
      message: "Konverzija je dozvoljena samo za status Dobijeno.",
    };
  }
  if (row.converted_project_id) {
    return {
      outcome: "CONFLICT",
      code: "ALREADY_CONVERTED",
      message: "Tender je već pretvoren u projekat.",
    };
  }

  /* Vrijednost ugovora = ZADNJA ODOBRENA revizija (§1.6/22.1). Ako revizija nema (stari
   tender iz R7), uzima se ponuđena vrijednost tendera — bolje postojeći broj nego nula, ali
   se to vidi u `note` projekta? Ne: `contract_value_cents` ostaje NULL i marža se računa iz
   BOQ-a, jer izmišljena vrijednost kvari svaki izvještaj. */
  const approved = await approvedRevisionValue(client, actor.companyId, tenderId);
  const code = await uniqueProjectCode(client, actor.companyId, row.title);
  const projectId = `prj_${crypto.randomUUID()}`;

  const team = await client.query<{ worker_id: string }>(
    `SELECT worker_id FROM public.tender_team
      WHERE company_id = $1 AND tender_id = $2 AND role = 'PM'
      ORDER BY created_at LIMIT 1`,
    [actor.companyId, tenderId],
  );
  const managerWorkerId = team.rows[0]?.worker_id ?? null;

  // Datumi: početak iz roka dostave (posao počinje kad se odluči) — bez izmišljanja trajanja.
  const startsOn = row.site_visit_at
    ? new Date(row.site_visit_at).toISOString().slice(0, 10)
    : null;

  await client.query(
    `INSERT INTO public.projects
       (id, company_id, code, name, status, note, is_active, created_by,
        contract_value_cents, currency_code, progress_source)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, true, $6, $7, $8, 'BOQ')`,
    [
      projectId,
      actor.companyId,
      code,
      row.title.trim().slice(0, 200),
      row.note,
      actor.userId,
      approved?.cents.toString() ?? null,
      approved ? approved.currency : null,
    ],
  );
  await writeAudit(client, {
    companyId: actor.companyId,
    actorId: actor.userId,
    actorEmail: null,
    action: "project.created",
    entityType: "project",
    entityId: projectId,
    metadata: { fromTender: true, code },
  });

  /* Faze PRIJE predmjera: `project_boq_items.phase_id` pokazuje na prvu fazu, pa faza mora
     postojati. Tender bez faza dobija jednu „Izvođenje“ sa težinom 1 (§1.6/22.3) — projekat
     bez faze ne bi imao napredak. */
  const tenderPhases = await client.query<{
    code: string;
    name: string;
    weight: number;
    planned_start: string | null;
    planned_end: string | null;
    sort_order: number;
  }>(
    `SELECT code, name, weight, planned_start::text, planned_end::text, sort_order
       FROM public.tender_phases
      WHERE company_id = $1 AND tender_id = $2
      ORDER BY sort_order, code`,
    [actor.companyId, tenderId],
  );

  let firstPhaseId: string | null = null;
  let phasesCreated = 0;
  if (tenderPhases.rows.length === 0) {
    firstPhaseId = `php_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO public.project_phases
         (id, company_id, project_id, code, name, sort_order, weight, planned_start, planned_end, created_by, updated_by)
       VALUES ($1,$2,$3,'IZV','Izvođenje',0,1,$4,NULL,$5,$5)`,
      [firstPhaseId, actor.companyId, projectId, startsOn, actor.userId],
    );
    phasesCreated = 1;
  } else {
    for (const [index, phase] of tenderPhases.rows.entries()) {
      const phaseId = `php_${crypto.randomUUID()}`;
      if (index === 0) firstPhaseId = phaseId;
      await client.query(
        `INSERT INTO public.project_phases
           (id, company_id, project_id, code, name, sort_order, weight, planned_start, planned_end, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          phaseId,
          actor.companyId,
          projectId,
          phase.code.slice(0, 40),
          phase.name.slice(0, 200),
          phase.sort_order,
          phase.weight,
          phase.planned_start,
          phase.planned_end,
          actor.userId,
        ],
      );
      phasesCreated += 1;
    }
  }

  // Predmjer 1:1 — `unit_price_cents` iz tendera je cijena iz ponude, ne trošak.
  const boqInserted = await client.query(
    `INSERT INTO public.project_boq_items
       (id, company_id, project_id, phase_id, code, description, unit, quantity_planned,
        unit_price_cents, sort_order, created_by, updated_by)
     SELECT 'pbi_' || replace(gen_random_uuid()::text, '-', ''), company_id, $3, $4, code, description,
            unit, quantity, unit_price_cents, sort_order, $5, $5
       FROM public.tender_boq_items
      WHERE company_id = $1 AND tender_id = $2
      ORDER BY sort_order, code`,
    [actor.companyId, tenderId, projectId, firstPhaseId, actor.userId],
  );

  /* Obaveze izvođenja: tender-dokumenti (ponudbena garancija, obrazac) ostaju na tenderu.
     Prenose se samo tipovi koji su uslov za rad na gradilištu, i to kao NOVE obaveze projekta
     (tender ostaje netaknut — njegovi rokovi su historija). */
  const obligations = await client.query(
    `INSERT INTO public.obligations (id, company_id, type_id, project_id, created_by)
     SELECT 'obl_' || replace(gen_random_uuid()::text, '-', ''), o.company_id, o.type_id, $3, $4
       FROM public.obligations o
       JOIN public.obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
      WHERE o.company_id = $1 AND o.tender_id = $2 AND o.superseded_by IS NULL
        AND t.code = ANY($5::text[])
        AND NOT EXISTS (
          SELECT 1 FROM public.obligations p
           WHERE p.company_id = o.company_id AND p.project_id = $3 AND p.type_id = o.type_id
             AND p.superseded_by IS NULL
        )`,
    [actor.companyId, tenderId, projectId, actor.userId, PROJECT_OBLIGATION_CODES],
  );

  /* Prilozi: nove veze na ISTI `object_key` (§1.6/22.5). Bajtovi se ne dupliraju, a projekat
     dobija svoju listu priloga — sa vlastitim životnim ciklusom (brisanje na projektu ne
     briše tender). */
  const attachments = await client.query(
    `INSERT INTO public.attachments
       (id, company_id, entity_type, entity_id, object_key, file_name, content_type,
        size_bytes, sha256, status, retention_until, uploaded_at, created_by)
     SELECT 'att_' || replace(gen_random_uuid()::text, '-', ''), a.company_id, 'PROJECT', $3,
            a.object_key, a.file_name, a.content_type, a.size_bytes, a.sha256, 'ready',
            a.retention_until, a.uploaded_at, $4
       FROM public.attachments a
      WHERE a.company_id = $1 AND a.entity_type = 'TENDER' AND a.entity_id = $2
        AND a.status = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM public.attachments p
           WHERE p.company_id = a.company_id AND p.entity_type = 'PROJECT'
             AND p.entity_id = $3 AND p.sha256 = a.sha256 AND p.status <> 'deleted'
        )`,
    [actor.companyId, tenderId, projectId, actor.userId],
  );

  /* Tim kao PREDLOG (§1.6/22.6): dodjela sa `note='predlog iz tendera'`. PM je već postavljen
     kao rukovodilac, pa ide samo kao članovi; potvrđuje ih PM kroz ekran dodjela. */
  const projectStart = startsOn ?? new Date().toISOString().slice(0, 10);
  const teamInserted = await client.query(
    `INSERT INTO public.project_assignments
       (id, company_id, project_id, worker_id, from_date, note, created_by)
     SELECT 'pas_' || replace(gen_random_uuid()::text, '-', ''), tt.company_id, $3, tt.worker_id,
            $4::date, 'predlog iz tendera', $5
       FROM public.tender_team tt
      WHERE tt.company_id = $1 AND tt.tender_id = $2 AND tt.role <> 'PM'
        AND NOT EXISTS (
          SELECT 1 FROM public.project_assignments pa
           WHERE pa.company_id = tt.company_id AND pa.project_id = $3
             AND pa.worker_id = tt.worker_id AND pa.voided_at IS NULL
        )`,
    [actor.companyId, tenderId, projectId, projectStart, actor.userId],
  );

  if (managerWorkerId) {
    await client.query(
      `UPDATE public.projects SET manager_worker_id = $3 WHERE id = $1 AND company_id = $2`,
      [projectId, actor.companyId, managerWorkerId],
    );
  }

  const claimed = await client.query(
    `UPDATE public.tenders
        SET converted_project_id = $3, updated_by = $4, updated_at = clock_timestamp()
      WHERE id = $1 AND company_id = $2
        AND status = 'WON' AND converted_project_id IS NULL`,
    [tenderId, actor.companyId, projectId, actor.userId],
  );
  if (claimed.rowCount === 0) throw new ConvertClaimLost();

  await writeAudit(client, {
    companyId: actor.companyId,
    actorId: actor.userId,
    actorEmail: null,
    action: "tender.converted",
    entityType: "tender",
    entityId: tenderId,
    metadata: {
      projectId,
      boqItems: boqInserted.rowCount ?? 0,
      phases: phasesCreated,
      obligations: obligations.rowCount ?? 0,
      attachments: attachments.rowCount ?? 0,
      teamMembers: teamInserted.rowCount ?? 0,
    },
  });

  return {
    outcome: "OK",
    projectId,
    summary: {
      boqItems: boqInserted.rowCount ?? 0,
      phases: phasesCreated,
      obligations: obligations.rowCount ?? 0,
      attachments: attachments.rowCount ?? 0,
      teamMembers: teamInserted.rowCount ?? 0,
    },
  };
}
