/**
 * F5 (Modul 6 §1.3): JEDAN ledger troška — automatsko knjiženje, PENDING i storno.
 *
 * Zašto ovaj fajl postoji umjesto `bookProjectCosts`:
 *
 *  - **Knjiženje je posljedica događaja.** Nema dugmeta: kad dan rada pređe u `FOREMAN_CONFIRMED`
 *    ili `LOCKED`, kad sat mašine postane `WORK`, kad se upiše točenje ili tura — trošak nastaje
 *    u ISTOJ transakciji. Dugme je značilo da trošak postoji samo ako se neko sjeti, a „stvarni
 *    trošak naspram budžeta u svakom trenutku“ (B1.3.4) tada nije mjerenje nego obećanje.
 *  - **Jedan događaj = jedan trošak.** `ON CONFLICT` na djelimični unikat
 *    `(company_id, source_type, source_id) WHERE status <> 'REVERSED'` čini svaki prolaz
 *    idempotentnim; ponovni sync, retry posla ili dvostruki klik ne prave drugi red.
 *  - **`PENDING` nije nula.** Gorivo bez iznosa i tura bez cijene ulaze u ledger sa `amount=NULL`.
 *    Zbir ih preskače, a ekran ih broji odvojeno — inače bi „nepoznato“ izgledalo kao besplatno.
 *  - **Storno, ne brisanje.** Ispravka je `REVERSED` na originalu + novi `POSTED` red sa razlogom.
 *    `DELETE` grant ne postoji, a i triger u bazi ga brani.
 *
 * Kategorija: `cost_categories.default_for_source_type` je mapiranje PO FIRMI (§1.3.14); izvor bez
 * mapiranja ide na `OSTALO`. Mapiranje se čita u trenutku knjiženja i NE dira postojeće troškove.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  FALLBACK_COST_CATEGORY_CODE,
  computeCostAmount,
  computeHoursFromInterval,
  isCurrency,
  money,
  toAmountString,
  type CostSourceType,
  type Currency,
} from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { snapshotCostRate } from "./machine-cost-component-service";
import { companyToday } from "./project-service";
import type {
  CostActor,
  CostEntryFilters,
  CostEntryRow,
  CostListResult,
  CostPostOutcome,
  CostReverseInput,
  CostReverseOutcome,
  ManualCostInput,
} from "./cost-entry-types";

/** Prefiks `id`-ja po tipu izvora — isti obrazac kao ostatak sistema (`mwl_`, `fuel_`, `haul_`). */
const ID_PREFIX: Record<CostSourceType, string> = {
  WORKDAY: "cst_wd",
  MACHINE_WORK_LOG: "cst_mwl",
  FUEL_ENTRY: "cst_fuel",
  HAUL: "cst_haul",
  SERVICE_ORDER: "cst_so",
  PURCHASE: "cst_pur",
  SUBCONTRACTOR: "cst_sub",
  MANUAL: "cst_man",
};

function newCostId(sourceType: CostSourceType): string {
  return `${ID_PREFIX[sourceType]}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

/**
 * Kategorija za izvor. Redoslijed: (1) eksplicitna kategorija, (2) mapiranje firme za izvor,
 * (3) `OSTALO`, (4) BILO KOJA aktivna kategorija kao posljednja linija.
 *
 * Zašto posljednja linija: firma bez šifarnika (nastala prije F5, bez ijednog člana u trenutku
 * trigera) inače ne bi mogla proknjižiti ništa, a trošak je stvarnost koja čeka. Bolje knjižiti u
 * kategoriju koja postoji nego odbiti knjiženje zbog šifarnika.
 */
export async function resolveCostCategory(
  client: PoolClient,
  companyId: string,
  sourceType: CostSourceType,
  explicitCategoryId?: string | null,
): Promise<string | null> {
  if (explicitCategoryId) {
    const explicit = await client.query<{ id: string }>(
      "SELECT id FROM public.cost_categories WHERE company_id = $1 AND id = $2",
      [companyId, explicitCategoryId],
    );
    if (explicit.rows[0]) return explicit.rows[0].id;
  }
  /*
   * `NULLS LAST` je OBAVEZAN: `OSTALO` ima `default_for_source_type = NULL`, pa poređenje daje
   * NULL, a Postgres u `DESC` poretku stavlja NULL PRVE — bez ovoga bi SVAKI trošak završio u
   * „Ostalo“, i kad mapiranje za izvor postoji (nađeno testom `f8-service-sync`).
   */
  const mapped = await client.query<{ id: string }>(
    `SELECT id FROM public.cost_categories
      WHERE company_id = $1 AND is_active
        AND (default_for_source_type = $2 OR code = $3)
      ORDER BY (default_for_source_type = $2) DESC NULLS LAST, sort_order, code
      LIMIT 1`,
    [companyId, sourceType, FALLBACK_COST_CATEGORY_CODE],
  );
  if (mapped.rows[0]) return mapped.rows[0].id;
  const any = await client.query<{ id: string }>(
    `SELECT id FROM public.cost_categories
      WHERE company_id = $1 AND is_active ORDER BY sort_order, code LIMIT 1`,
    [companyId],
  );
  return any.rows[0]?.id ?? null;
}

/**
 * Šifarnik može biti prazan ako je firma nastala dok još nije imala nijednog člana (`created_by`
 * je NOT NULL, pa ga seed ne izmišlja). Ovdje se dopunjava u trenutku kad korisnik STVARNO
 * postoji — dakle pri prvom knjiženju, ne pri onboarding-u.
 *
 * DOPUNA, ne „samo ako je prazno“: firma koja je šifarnik dobila prije F8 nema kategoriju za
 * `SERVIS`, pa bi prvi završeni servis pao u `OSTALO` — ili bi, uz staro rano vraćanje, ostao
 * neknjižen. Postojeće kategorije se ne diraju (`ON CONFLICT DO NOTHING`); dodaje se samo ono
 * što nedostaje.
 */
export async function ensureCostCategories(
  client: PoolClient,
  companyId: string,
  actorId: string,
): Promise<void> {
  const seeds: Array<{ code: string; name: string; sortOrder: number; source: CostSourceType | null }> = [
    { code: "RAD", name: "Rad", sortOrder: 10, source: "WORKDAY" },
    { code: "MEHANIZACIJA", name: "Mehanizacija", sortOrder: 20, source: "MACHINE_WORK_LOG" },
    { code: "GORIVO", name: "Gorivo", sortOrder: 30, source: "FUEL_ENTRY" },
    { code: "MATERIJAL", name: "Materijal", sortOrder: 40, source: "PURCHASE" },
    { code: "PODIZVOĐAČI", name: "Podizvođači", sortOrder: 50, source: "SUBCONTRACTOR" },
    { code: "TRANSPORT", name: "Transport", sortOrder: 60, source: "HAUL" },
    /* F8: servis mašina. Kategorija postoji UVIJEK, i kad firma još nema ni jedan nalog — inače bi
       prvi završeni nalog pao na „nema kategorije za SERVICE_ORDER“ i trošak bi ostao neknjižen. */
    { code: "SERVIS", name: "Servis mašina", sortOrder: 70, source: "SERVICE_ORDER" },
    { code: "OSTALO", name: "Ostalo", sortOrder: 99, source: null },
  ];
  for (const seed of seeds) {
    await client.query(
      `INSERT INTO public.cost_categories
         (id, company_id, code, name, sort_order, default_for_source_type, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT DO NOTHING`,
      [
        `cc_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        companyId,
        seed.code,
        seed.name,
        seed.sortOrder,
        seed.source,
        actorId,
      ],
    );
  }
}

export type CostPostDraft = {
  companyId: string;
  /**
   * `null` = trošak SAMO na mašini (spec 09 §1.4/20): servis mašine koja nije bila na projektu.
   * Red tada mora nositi `machineId` — baza to provjerava `cost_entries_subject_check`-om.
   */
  projectId: string | null;
  phaseId?: string | null;
  categoryId?: string | null;
  sourceType: CostSourceType;
  sourceId: string;
  machineId?: string | null;
  entryKind?: "CHARGE" | "OVERHEAD" | "OFFSET";
  supplierInvoiceId?: string | null;
  materialIssueItemId?: string | null;
  clientGeneratedId?: string | null;
  occurredOn: string;
  amountCents: bigint | null;
  currency?: Currency | null;
  quantity?: number | null;
  unit?: string | null;
  rateSnapshot?: Record<string, unknown> | null;
  note?: string | null;
  actorId: string;
};

/**
 * Upis troška. Idempotentno po izvoru — drugi poziv za isti `(source_type, source_id)` vraća
 * postojeći `id` sa `created: false`, ne grešku i ne duplikat.
 *
 * `amountCents === null` znači `PENDING`; to je jedini način da red u ledgeru bude bez iznosa
 * (baza ga CHECK-om veže na `amount IS NULL AND currency IS NULL`, pa „PENDING sa nulom“ ne
 * prolazi ni kroz direktan INSERT).
 */
/** Serialize retries with reversals, including when the only historical row is REVERSED. */
async function lockCostSource(client: PoolClient, companyId: string, sourceType: string, sourceId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended(json_build_array($1::text,$2::text,$3::text)::text, 0))", [companyId, sourceType, sourceId]);
}

export async function postCost(
  client: PoolClient,
  draft: CostPostDraft,
): Promise<{ id: string; created: boolean; status: "POSTED" | "PENDING" | "REVERSED" }> {
  await lockCostSource(client, draft.companyId, draft.sourceType, draft.sourceId);
  const prior = await client.query<{id:string;status:"POSTED" | "PENDING" | "REVERSED"}>(
    `SELECT id,status FROM public.cost_entries WHERE company_id=$1 AND source_type=$2 AND source_id=$3
      ORDER BY (status <> 'REVERSED') DESC, booked_at DESC LIMIT 1`,
    [draft.companyId,draft.sourceType,draft.sourceId]);
  if (prior.rows[0]) return {id:prior.rows[0].id, status:prior.rows[0].status, created:false};
  await ensureCostCategories(client, draft.companyId, draft.actorId);
  const categoryId = await resolveCostCategory(
    client,
    draft.companyId,
    draft.sourceType,
    draft.categoryId,
  );
  if (!categoryId) throw new Error("COST_CATEGORY_MISSING");

  const pending = draft.amountCents === null;
  const status = pending ? "PENDING" : "POSTED";
  const currency = pending ? null : (draft.currency ?? "BAM");
  const id = newCostId(draft.sourceType);
  const inserted = await client.query<{ id: string; status: string }>(
    `INSERT INTO public.cost_entries
       (id, company_id, project_id, phase_id, category_id, source_type, source_id, machine_id,
        occurred_on, amount_cents, currency_code, quantity, unit, rate_snapshot, status, note,
        booked_by, entry_kind, supplier_invoice_id, material_issue_item_id, client_generated_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (company_id, source_type, source_id) WHERE status <> 'REVERSED' DO NOTHING
     RETURNING id, status`,
    [
      id,
      draft.companyId,
      draft.projectId,
      draft.phaseId ?? null,
      categoryId,
      draft.sourceType,
      draft.sourceId,
      draft.machineId ?? null,
      draft.occurredOn,
      pending ? null : draft.amountCents!.toString(),
      currency,
      draft.quantity ?? null,
      draft.unit ?? null,
      draft.rateSnapshot ? JSON.stringify(draft.rateSnapshot) : null,
      status,
      draft.note ?? null,
      draft.actorId,
      draft.entryKind ?? "CHARGE",
      draft.supplierInvoiceId ?? null,
      draft.materialIssueItemId ?? null,
      draft.clientGeneratedId ?? null,
    ],
  );
  const row = inserted.rows[0];
  if (row) {
    await writeAudit(client, {
      companyId: draft.companyId,
      actorId: draft.actorId,
      actorEmail: null,
      action: pending ? "project.cost_pending" : "project.cost_posted",
      entityType: "project_cost_entry",
      entityId: row.id,
      metadata: {
        projectId: draft.projectId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        occurredOn: draft.occurredOn,
        amountCents: pending ? null : draft.amountCents!.toString(),
      },
      retentionClass: "FINANCIAL",
    });
    return { id: row.id, created: true, status: pending ? "PENDING" : "POSTED" };
  }

  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM public.cost_entries
      WHERE company_id = $1 AND source_type = $2 AND source_id = $3 AND status <> 'REVERSED'`,
    [draft.companyId, draft.sourceType, draft.sourceId],
  );
  const found = existing.rows[0];
  if (!found) throw new Error("COST_ENTRY_CONFLICT_UNRESOLVED");
  return {
    id: found.id,
    created: false,
    status: found.status === "PENDING" ? "PENDING" : "POSTED",
  };
}

/**
 * `PENDING` → `POSTED` kad cijena stigne (npr. gorivo je uneseno bez iznosa, pa račun dođe).
 *
 * Triger dozvoljava SAMO taj prelaz i samo na njemu mijenja `amount_cents`/`currency_code`;
 * iznos se ne može „ispraviti“ na `POSTED` redu — to je storno.
 */
export async function settlePendingCost(
  client: PoolClient,
  params: {
    companyId: string;
    sourceType: CostSourceType;
    sourceId: string;
    amountCents: bigint;
    currency: Currency;
    actorId: string;
  },
): Promise<{ id: string; settled: boolean } | null> {
  const row = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM public.cost_entries
      WHERE company_id = $1 AND source_type = $2 AND source_id = $3 AND status <> 'REVERSED' FOR UPDATE`,
    [params.companyId, params.sourceType, params.sourceId],
  );
  const entry = row.rows[0];
  if (!entry) return null;
  if (entry.status !== "PENDING") return { id: entry.id, settled: false };
  /* Numeracija parametara mora biti neprekinuta: `$3` se koristi u SET-u, a ne u WHERE-u, pa
     niz od pet vrijednosti sa praznim `$3` daje 42P18 „could not determine data type“. */
  await client.query(
    `UPDATE public.cost_entries
        SET status = 'POSTED', amount_cents = $3, currency_code = $4, version = version + 1
      WHERE company_id = $1 AND id = $2 AND status = 'PENDING'`,
    [params.companyId, entry.id, params.amountCents.toString(), params.currency],
  );
  await writeAudit(client, {
    companyId: params.companyId,
    actorId: params.actorId,
    actorEmail: null,
    action: "project.cost_posted",
    entityType: "project_cost_entry",
    entityId: entry.id,
    metadata: { settledFrom: "PENDING", amountCents: params.amountCents.toString() },
    retentionClass: "FINANCIAL",
  });
  return { id: entry.id, settled: true };
}

/** Background booking owns its transaction; a failure must reach the caller. */
async function bookInCompany(
  pool: Pool,
  companyId: string,
  fn: (client: PoolClient) => Promise<{ posted: number; pending: number; skipped: number }>,
): Promise<{ posted: number; pending: number; skipped: number }> {
  return withCompany(pool, toCompanyId(companyId), fn);
}

/* ============================================================ automatsko knjiženje */

/**
 * Sati rada × satnica važeća NA DAN RADA (ne „trenutna“): dan rada od prošle sedmice mora ući u
 * trošak po cijeni koja je tada važila, inače promjena satnice retroaktivno mijenja zatvorene
 * mjesece.
 *
 * `BREAK` i izostanci ne ulaze (§1.3.13): `kind = 'WORK'` i `day_kind` koji nije izostanak.
 * Satnica: `HOURLY` direktno; `DAILY` podijeljeno sa 8 (radni dan); `MONTHLY` sa 160 (isti
 * imenilac kao kod mašine, `DEFAULT_PLANNED_HOURS_PER_MONTH`); `COEFFICIENT` se ne knjiži —
 * koeficijent nije novac, a izmišljena osnovica bi bila lažni trošak.
 */
async function bookWorkdayCostWithClient(
  client: PoolClient,
  params: { companyId: string; actorId: string; workdayId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  const day = await client.query<{
    id: string;
    worker_id: string;
    work_date: string;
    phase_id: string | null;
    approval_status: string;
    day_kind: string;
  }>(
    `SELECT d.id, d.worker_id, d.work_date::text AS work_date, d.phase_id, d.approval_status, d.day_kind
       FROM public.workdays d WHERE d.company_id = $1 AND d.id = $2`,
    [params.companyId, params.workdayId],
  );
  const header = day.rows[0];
  if (!header) return { posted: 0, pending: 0, skipped: 1 };
  if (header.approval_status !== "FOREMAN_CONFIRMED" && header.approval_status !== "LOCKED") {
    return { posted: 0, pending: 0, skipped: 1 };
  }
  const segments = await client.query<{
    project_id: string;
    hours: string;
  }>(
    `SELECT e.project_id,
            (sum(extract(epoch FROM (e.ended_at - e.started_at))) / 3600.0)::numeric(14,3)::text AS hours
       FROM public.work_entries e
      WHERE e.company_id = $1 AND e.workday_id = $2
        AND e.project_id IS NOT NULL
        AND e.kind = 'WORK' AND e.end_state = 'KNOWN_END' AND e.ended_at IS NOT NULL
        AND e.resolution_state = 'ACTIVE'
      GROUP BY e.project_id`,
    [params.companyId, params.workdayId],
  );
  if (segments.rows.length === 0) return { posted: 0, pending: 0, skipped: 1 };

  const rate = await client.query<{
    rate_kind: string;
    amount_cents: string | null;
    currency_code: string | null;
  }>(
    `SELECT rate_kind, amount_cents::text, currency_code
       FROM public.worker_rates
      WHERE company_id = $1 AND worker_id = $2
        AND valid_from <= $3::date AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY valid_from DESC, created_at DESC
      LIMIT 1`,
    [params.companyId, header.worker_id, header.work_date],
  );
  const payRate = rate.rows[0];

  let posted = 0;
  let pending = 0;
  let skipped = 0;
  for (const segment of segments.rows) {
    if (!segment.project_id) continue;
    const hours = Number(segment.hours);
    if (!(hours > 0)) {
      skipped += 1;
      continue;
    }
    // Jedna knjižba po danu i projektu; izvor je dan rada (ne segment), pa `source_id` mora biti
    // složen — inače bi dan sa dva projekta knjižio samo prvi.
    const sourceId = `${header.id}:${segment.project_id}`;
    if (!payRate || payRate.amount_cents === null || !isCurrency(payRate.currency_code)) {
      const result = await postCost(client, {
        companyId: params.companyId,
        projectId: segment.project_id,
        phaseId: header.phase_id,
        sourceType: "WORKDAY",
        sourceId,
        occurredOn: header.work_date,
        amountCents: null,
        quantity: hours,
        unit: "h",
        note: "Satnica radnika nije unesena — trošak čeka cijenu.",
        actorId: params.actorId,
      });
      if (result.created) pending += 1;
      else skipped += 1;
      continue;
    }
    const currency = payRate.currency_code;
    const rateCents =
      payRate.rate_kind === "HOURLY"
        ? BigInt(payRate.amount_cents)
        : payRate.rate_kind === "DAILY"
          ? BigInt(Math.round(Number(payRate.amount_cents) / 8))
          : payRate.rate_kind === "MONTHLY"
            ? BigInt(Math.round(Number(payRate.amount_cents) / 160))
            : null;
    if (rateCents === null) {
      const result = await postCost(client, {
        companyId: params.companyId,projectId: segment.project_id,phaseId: header.phase_id,
        sourceType: "WORKDAY",sourceId,occurredOn: header.work_date,amountCents: null,
        quantity: hours,unit: "h",note: "Satnica nije utvrđena — trošak čeka cijenu.",actorId: params.actorId,
      });
      if (result.created) pending += 1;
      else skipped += 1;
      continue;
    }
    const amount = computeCostAmount(hours, rateCents, currency);
    const result = await postCost(client, {
      companyId: params.companyId,
      projectId: segment.project_id,
      phaseId: header.phase_id,
      sourceType: "WORKDAY",
      sourceId,
      occurredOn: header.work_date,
      amountCents: amount.cents,
      currency,
      quantity: hours,
      unit: "h",
      rateSnapshot: {
        rate_kind: payRate.rate_kind,
        rate_cents: rateCents.toString(),
        amount_cents: payRate.amount_cents,
        currency_code: currency,
        on_date: header.work_date,
      },
      actorId: params.actorId,
    });
    if (result.created) posted += 1;
    else skipped += 1;
  }
  return { posted, pending, skipped };
}

/**
 * Sati mašine × zamrznuta stopa (§1.3.13). Stopa se snapshot-uje istim pozivom kao u F4, pa se
 * razlaganje (depresijacija, servis, operater…) čuva uz trošak i ostaje objašnjivo poslije
 * promjene komponenti. Samo `WORK` režim pravi trošak — `IDLE` i `BREAKDOWN` su tu zbog
 * iskorištenosti, ne zbog naplate.
 */
async function bookMachineWorkLogCostWithClient(
  client: PoolClient,
  params: { companyId: string; actorId: string; workLogId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  const log = await client.query<{
    id: string;
    machine_id: string;
    project_id: string | null;
    phase_id: string | null;
    started_at: string;
    ended_at: string;
    mode: string;
  }>(
    `SELECT id, machine_id, project_id, phase_id, started_at::text, ended_at::text, mode
       FROM public.machine_work_logs WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.workLogId],
  );
  const row = log.rows[0];
  if (!row || !row.project_id || row.mode !== "WORK") return { posted: 0, pending: 0, skipped: 1 };
  const onDate = row.started_at.slice(0, 10);
  const snapshot = await snapshotCostRate(client, {
    companyId: params.companyId,
    machineId: row.machine_id,
    onDate,
    createdBy: params.actorId,
  });
  if (!snapshot) {
    // Nema stope: trošak POSTOJI (sati su odrađeni), samo cijena nije poznata. `PENDING` je tačan
    // ishod; preskakanje bi značilo da mašina radi besplatno dok se stopa ne unese.
    const result = await postCost(client, {
      companyId: params.companyId,
      projectId: row.project_id,
      phaseId: row.phase_id,
      sourceType: "MACHINE_WORK_LOG",
      sourceId: row.id,
      machineId: row.machine_id,
      occurredOn: onDate,
      amountCents: null,
      quantity: computeHoursFromInterval(new Date(row.started_at), new Date(row.ended_at)),
      unit: "h",
      note: "Stopa troška mašine nije unesena — trošak čeka cijenu.",
      actorId: params.actorId,
    });
    return result.created ? { posted: 0, pending: 1, skipped: 0 } : { posted: 0, pending: 0, skipped: 1 };
  }
  const hours = computeHoursFromInterval(new Date(row.started_at), new Date(row.ended_at));
  const amount = computeCostAmount(hours, snapshot.rateCents, snapshot.currency);
  const result = await postCost(client, {
    companyId: params.companyId,
    projectId: row.project_id,
    phaseId: row.phase_id,
    sourceType: "MACHINE_WORK_LOG",
    sourceId: row.id,
    machineId: row.machine_id,
    occurredOn: onDate,
    amountCents: amount.cents,
    currency: snapshot.currency,
    quantity: hours,
    unit: "h",
    rateSnapshot: {
      snapshot_id: snapshot.snapshotId,
      rate_cents: snapshot.rateCents.toString(),
      currency_code: snapshot.currency,
      on_date: onDate,
      components: snapshot.components,
    },
    actorId: params.actorId,
  });
  return result.created ? { posted: 1, pending: 0, skipped: 0 } : { posted: 0, pending: 0, skipped: 1 };
}

/** Gorivo: iznos ako postoji, inače `PENDING` sa litrima (§1.3.13). */
async function bookFuelEntryCostWithClient(
  client: PoolClient,
  params: { companyId: string; actorId: string; fuelEntryId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  const row = await client.query<{
    id: string;
    project_id: string | null;
    machine_id: string;
    filled_at: string;
    liters: string;
    amount_cents: string | null;
    currency_code: string;
  }>(
    `SELECT id, project_id, machine_id, filled_at::text, liters::text,
            amount_cents::text, currency_code
       FROM public.fuel_entries WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.fuelEntryId],
  );
  const fuel = row.rows[0];
  if (!fuel || !fuel.project_id) return { posted: 0, pending: 0, skipped: 1 };
  const onDate = fuel.filled_at.slice(0, 10);
  const currency = isCurrency(fuel.currency_code) ? fuel.currency_code : "BAM";
  const result = await postCost(client, {
    companyId: params.companyId,
    projectId: fuel.project_id,
    sourceType: "FUEL_ENTRY",
    sourceId: fuel.id,
    machineId: fuel.machine_id,
    occurredOn: onDate,
    amountCents: fuel.amount_cents === null ? null : BigInt(fuel.amount_cents),
    currency,
    quantity: Number(fuel.liters),
    unit: "l",
    note: fuel.amount_cents === null ? "Iznos točenja nije poznat — trošak čeka cijenu." : null,
    actorId: params.actorId,
  });
  if (!result.created) return { posted: 0, pending: 0, skipped: 1 };
  return result.status === "PENDING"
    ? { posted: 0, pending: 1, skipped: 0 }
    : { posted: 1, pending: 0, skipped: 0 };
}

/**
 * Tura: `količina × cijena` kad cijena postoji, inače `PENDING` sa količinom.
 *
 * Cijena dolazi iz dionice (`route_segments`) — kvantitativni podatak, nema svoj trošak trošak
 * se ne izmišlja. Kad dionica nema cijenu, tura je `PENDING` i to je vidljivo, a ne nula.
 */
async function bookHaulCostWithClient(
  client: PoolClient,
  params: { companyId: string; actorId: string; haulId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  const row = await client.query<{
    id: string;
    project_id: string | null;
    phase_id: string | null;
    machine_id: string;
    hauled_at: string;
    quantity: string;
    quantity_unit: string;
    segment_id: string | null;
  }>(
    `SELECT id, project_id, phase_id, machine_id, hauled_at::text, quantity::text,
            quantity_unit, segment_id
       FROM public.hauls WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.haulId],
  );
  const haul = row.rows[0];
  if (!haul || !haul.project_id) return { posted: 0, pending: 0, skipped: 1 };
  const onDate = haul.hauled_at.slice(0, 10);
  const result = await postCost(client, {
    companyId: params.companyId,
    projectId: haul.project_id,
    phaseId: haul.phase_id,
    sourceType: "HAUL",
    sourceId: haul.id,
    machineId: haul.machine_id,
    occurredOn: onDate,
    amountCents: null,
    quantity: Number(haul.quantity),
    unit: haul.quantity_unit,
    note: haul.segment_id
      ? "Cijena ture nije definisana — trošak čeka cijenu."
      : "Tura bez dionice — trošak čeka cijenu.",
    actorId: params.actorId,
  });
  if (!result.created) return { posted: 0, pending: 0, skipped: 1 };
  return result.status === "PENDING"
    ? { posted: 0, pending: 1, skipped: 0 }
    : { posted: 1, pending: 0, skipped: 0 };
}

/** Servis: iznos naloga, `PENDING` dok nalog nema iznos (Modul 8). */
async function bookServiceOrderCostWithClient(
  client: PoolClient,
  params: { companyId: string; actorId: string; serviceOrderId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  const row = await client.query<{
    id: string;
    machine_id: string;
    amount_cents: string | null;
    total_cost_cents: string;
    currency_code: string | null;
    closed_at: string | null;
    opened_at: string;
    project_id: string | null;
    warranty_claim: boolean;
  }>(
    /* `project_id` je SADA na nalogu (F8 §1.4/20): puni se iz kvara kad je kvar nastao u radu na
       projektu. Ranije se tražio kroz `machine_work_logs` sa ISTIM id-jem kao nalog — veza koja
       gotovo nikad ne postoji, pa trošak servisa skoro nikad nije ni knjižen. */
    `SELECT so.id, so.machine_id, so.amount_cents::text, so.total_cost_cents::text,
            so.currency_code, so.closed_at::text, so.opened_at::text, so.project_id,
            so.warranty_claim
       FROM public.service_orders so
      WHERE so.company_id = $1 AND so.id = $2`,
    [params.companyId, params.serviceOrderId],
  );
  const order = row.rows[0];
  if (!order) return { posted: 0, pending: 0, skipped: 1 };

  /*
   * Garancija na izvedeni rad (spec 09 §1.7/32): popravka u garanciji NE stvara novi trošak.
   * Knjiži se red sa iznosom 0 i napomenom „garancija“ — tako je u ledgeru VIDLJIVO da je posao
   * obavljen, a da firma nije platila drugi put. Preskakanje bi značilo da garancijska popravka
   * ne postoji u trošku održavanja, pa bi trošak po satu rada bio lažno manji.
   */
  const onDate = (order.closed_at ?? order.opened_at).slice(0, 10);
  const currency = isCurrency(order.currency_code) ? order.currency_code : "BAM";
  if (order.warranty_claim) {
    await ensureCostCategories(client, params.companyId, params.actorId);
    const result = await postCost(client, {
      companyId: params.companyId,
      projectId: order.project_id,
      sourceType: "SERVICE_ORDER",
      sourceId: order.id,
      machineId: order.machine_id,
      occurredOn: onDate,
      amountCents: 0n,
      currency,
      unit: null,
      note: "Garancija — popravka bez novog troška.",
      actorId: params.actorId,
    });
    if (!result.created) return { posted: 0, pending: 0, skipped: 1 };
    return { posted: 1, pending: 0, skipped: 0 };
  }

  /*
   * Iznos: `total_cost_cents` (labor + dijelovi + vanjski) je izveden i tačan. `amount_cents` je
   * stari procjenski iznos kvarda i koristi se samo za redove koji još nemaju razrađen trošak.
   *
   * Trošak BEZ iznosa je `PENDING`, ne preskočen red (D1 iz Modula 5): „nepoznato“ ne smije
   * izgledati kao besplatno, a ne smije ni nestati iz ledžera.
   */
  const total = BigInt(order.total_cost_cents);
  const amountCents = total > 0n ? total : order.amount_cents === null ? null : BigInt(order.amount_cents);
  const result = await postCost(client, {
    companyId: params.companyId,
    projectId: order.project_id,
    sourceType: "SERVICE_ORDER",
    sourceId: order.id,
    machineId: order.machine_id,
    occurredOn: onDate,
    amountCents,
    currency,
    unit: null,
    note: amountCents === null ? "Servisni nalog još nema iznos." : null,
    actorId: params.actorId,
  });
  if (!result.created) return { posted: 0, pending: 0, skipped: 1 };
  return result.status === "PENDING"
    ? { posted: 0, pending: 1, skipped: 0 }
    : { posted: 1, pending: 0, skipped: 0 };
}

/** Booking shares the caller's transaction. Failures roll back the business action. */
export function bookWorkdayCost(
  client: PoolClient,
  params: { companyId: string; actorId: string; workdayId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookWorkdayCostWithClient(client, params);
}

export function bookMachineWorkLogCost(
  client: PoolClient,
  params: { companyId: string; actorId: string; workLogId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookMachineWorkLogCostWithClient(client, params);
}

export function bookFuelEntryCost(
  client: PoolClient,
  params: { companyId: string; actorId: string; fuelEntryId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookFuelEntryCostWithClient(client, params);
}

export function bookHaulCost(
  client: PoolClient,
  params: { companyId: string; actorId: string; haulId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookHaulCostWithClient(client, params);
}

export function bookServiceOrderCost(
  client: PoolClient,
  params: { companyId: string; actorId: string; serviceOrderId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookServiceOrderCostWithClient(client, params);
}

/**
 * Varijante sa `pool`-om: za poslove (worker, noćni prolaz) koji NEMAJU svoju transakciju.
 * Ovdje `withCompany` otvara transakciju — jedina razlika je vlasništvo nad transakcijom.
 */
export function bookWorkdayCostInCompany(
  pool: Pool,
  params: { companyId: string; actorId: string; workdayId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookInCompany(pool, params.companyId, (client) => bookWorkdayCostWithClient(client, params));
}

export function bookServiceOrderCostInCompany(
  pool: Pool,
  params: { companyId: string; actorId: string; serviceOrderId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookInCompany(pool, params.companyId, (client) =>
    bookServiceOrderCostWithClient(client, params),
  );
}

export function bookMachineWorkLogCostInCompany(
  pool: Pool,
  params: { companyId: string; actorId: string; workLogId: string },
): Promise<{ posted: number; pending: number; skipped: number }> {
  return bookInCompany(pool, params.companyId, (client) =>
    bookMachineWorkLogCostWithClient(client, params),
  );
}

/* ============================================================ storno i upiti */

/**
 * Storno (§1.3.16). Original ide u `REVERSED` (i dobija `reversed_by`), a novi `POSTED` red nosi
 * razlog i, kad je dat, novi iznos. Bez `replacement`-a radi se samo poništenje troška.
 *
 * Zašto novi red umjesto `UPDATE`-a iznosa: `cost_entry_guard()` to ne dozvoljava, i to je
 * namjerno — istorija mora ostati čitljiva poslije ispravke, a „trag“ je jedini način da se
 * odgovori na „zašto je ovaj trošak bio 300 a sada je 250“.
 */
export async function reverseCost(
  pool: Pool,
  actor: CostActor,
  costId: string,
  input: CostReverseInput,
): Promise<CostReverseOutcome> {
  if (!can(actor.roles, "projects.costs.book")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo storna." };
  }
  if (input.reason.trim().length < 10) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "COST_REVERSAL_REASON_REQUIRED",
      message: "Razlog storna mora imati najmanje 10 znakova.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const source = await client.query<{source_type:string;source_id:string}>(
      "SELECT source_type,source_id FROM public.cost_entries WHERE company_id=$1 AND id=$2", [actor.companyId,costId]);
    if (source.rows[0]) await lockCostSource(client, actor.companyId, source.rows[0].source_type, source.rows[0].source_id);
    const found = await client.query<{
      id: string;
      project_id: string;
      phase_id: string | null;
      category_id: string;
      source_type: string;
      source_id: string;
      machine_id: string | null;
      occurred_on: string;
      amount_cents: string | null;
      currency_code: string | null;
      quantity: string | null;
      unit: string | null;
      status: string;
    }>(
      `SELECT id, project_id, phase_id, category_id, source_type, source_id, machine_id,
              occurred_on::text, amount_cents::text, currency_code, quantity::text, unit, status
         FROM public.cost_entries WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [actor.companyId, costId],
    );
    const original = found.rows[0];
    if (!original) return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Trošak ne postoji." };
    if (original.source_type === "PURCHASE" || original.source_type === "SUBCONTRACTOR") {
      return { outcome: "CONFLICT", code: "PURCHASE_COST_REVERSAL_FORBIDDEN", message: "Trošak nabavke ili podizvođača ne može se jednostrano stornirati bez povezanog dokumenta." };
    }
    if (original.status === "REVERSED") {
      return { outcome: "CONFLICT", code: "COST_ALREADY_POSTED", message: "Trošak je već storniran." };
    }

    const replacementId = `${newCostId("MANUAL")}_r`;
    const currency = isCurrency(original.currency_code) ? original.currency_code : "BAM";
    /*
     * Storno uvijek upisuje JEDAN novi red — to je onaj na koji `reversed_by` pokazuje. Dva
     * oblika, jedna tabela:
     *
     *  - **korekcija** (dat `replacement`): novi red nosi ispravljeni iznos i `reverses_id` na
     *    original, pa se u ledgeru vidi „bio 300, sada 250, evo zašto“;
     *  - **poništenje** (bez `replacement`): original je bio greška, pa zamjenski red nosi 0.00
     *    i razlog. Nula je tačna: troška nema. Ona se NE pojavljuje u marži kao „besplatno“ jer
     *    je original `REVERSED`, a nula ne mijenja zbir.
     *
     * Zašto ne „samo označi original“: `POSTED` trošak mora ostati čitljiv, a bez novog reda se
     * ne vidi ni kad je storniran ni zašto — trag bi živio samo u auditu, koji nije knjiga.
     */
    const replacementCents = input.replacement?.amount
      ? money(input.replacement.amount, currency).cents
      : 0n;
    if (input.replacement?.amount && replacementCents <= 0n) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "INPUT",
        message: "Ispravljeni iznos mora biti veći od nule; za poništenje pošalji storno bez iznosa.",
      };
    }

    await client.query(
      `INSERT INTO public.cost_entries
         (id, company_id, project_id, phase_id, category_id, source_type, source_id, machine_id,
          occurred_on, amount_cents, currency_code, quantity, unit, status, reverses_id, note,
          booked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,'POSTED',$14,$15,$16)`,
      [
        replacementId,
        actor.companyId,
        original.project_id,
        input.replacement?.phaseId === undefined ? original.phase_id : input.replacement.phaseId,
        input.replacement?.categoryId ?? original.category_id,
        /*
         * Izvor zamjenskog reda je `MANUAL`: izvorni događaj (dan rada, točenje…) već nosi
         * original i njegov `source_id` je zauzet. Novi red NIJE taj događaj — on je odluka
         * čovjeka o ispravci, i tako se i knjiži.
         */
        "MANUAL",
        `${original.source_type}:${original.source_id}:reversal:${replacementId}`,
        original.machine_id,
        input.replacement?.occurredOn ?? original.occurred_on,
        replacementCents.toString(),
        currency,
        original.quantity,
        original.unit,
        original.id,
        input.replacement?.note ?? `Storno: ${input.reason.trim()}`,
        actor.userId,
      ],
    );
    await client.query(
      `UPDATE public.cost_entries
          SET status = 'REVERSED', reversed_by = $3, note = coalesce(note, $4),
              version = version + 1
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, original.id, replacementId, `Storno: ${input.reason.trim()}`],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.cost_reversed",
      entityType: "project_cost_entry",
      entityId: original.id,
      metadata: {
        reason: input.reason.trim(),
        replacementId,
        amountCents: replacementCents === null ? null : replacementCents.toString(),
      },
      retentionClass: "FINANCIAL",
    });

    return { outcome: "OK", id: original.id, replaced_by: replacementId };
  });
}

/**
 * Storno zbog NAKNADNE IZMJENE izvornog zapisa (§1.3.16).
 *
 * Kad se točenje, tura ili rad mašine isprave (revizija je append-only, original ostaje), trošak
 * koji je od njih nastao više ne odgovara stvarnosti. Zato se stornira u ISTOJ transakciji koja
 * upisuje reviziju — ako revizija padne, trošak ostaje.
 *
 * Vraća `null` kad izvor nema aktivan trošak (nikad nije knjižen) ili kad je već storniran. To nije
 * greška: revizija može doći i na zapis koji nije ušao u ledger, a ponovni prolaz ne smije praviti
 * drugi storno.
 *
 * `PENDING` red se takođe stornira: izvor bez cijene je i dalje izvor, a ispravka količine bi
 * ostavila „bez cijene“ zapis sa starom količinom.
 */
async function reverseCostWithClient(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    sourceType: CostSourceType;
    sourceId: string;
    reason: string;
    note: string;
  },
): Promise<{ id: string; replacementId: string } | null> {
  await lockCostSource(client, params.companyId, params.sourceType, params.sourceId);
  const found = await client.query<{
    id: string;
    project_id: string;
    phase_id: string | null;
    category_id: string;
    machine_id: string | null;
    occurred_on: string;
    amount_cents: string | null;
    currency_code: string | null;
    quantity: string | null;
    unit: string | null;
  }>(
    `SELECT id, project_id, phase_id, category_id, machine_id, occurred_on::text,
            amount_cents::text, currency_code, quantity::text, unit
       FROM public.cost_entries
      WHERE company_id = $1 AND source_type = $2 AND source_id = $3 AND status <> 'REVERSED'
      FOR UPDATE`,
    [params.companyId, params.sourceType, params.sourceId],
  );
  const original = found.rows[0];
  if (!original) return null;

  const replacementId = `${newCostId("MANUAL")}_r`;
  const currency = isCurrency(original.currency_code) ? original.currency_code : "BAM";
  /*
   * Zamjenski red nosi 0.00: izvorni događaj je ispravljen, pa ovaj trošak u knjizi više ne
   * postoji. Nula NE ulazi u maržu kao „besplatno“ jer je original `REVERSED` — zbir se ne mijenja,
   * ali se u ledgeru vidi da je trošak bio i da je ukinut, i zašto.
   */
  await client.query(
    `INSERT INTO public.cost_entries
       (id, company_id, project_id, phase_id, category_id, source_type, source_id, machine_id,
        occurred_on, amount_cents, currency_code, quantity, unit, status, reverses_id, note, booked_by)
     VALUES ($1,$2,$3,$4,$5,'MANUAL',$6,$7,$8::date,0,$9,$10,$11,'POSTED',$12,$13,$14)`,
    [
      replacementId,
      params.companyId,
      original.project_id,
      original.phase_id,
      original.category_id,
      `${params.sourceType}:${params.sourceId}:reversal:${replacementId}`,
      original.machine_id,
      original.occurred_on,
      currency,
      original.quantity,
      original.unit,
      original.id,
      params.note,
      params.actorId,
    ],
  );
  await client.query(
    `UPDATE public.cost_entries
        SET status = 'REVERSED', reversed_by = $3, note = coalesce(note, $4), version = version + 1
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, original.id, replacementId, params.note],
  );
  await writeAudit(client, {
    companyId: params.companyId,
    actorId: params.actorId,
    actorEmail: null,
    action: "project.cost_reversed",
    entityType: "project_cost_entry",
    entityId: original.id,
    metadata: {
      reason: params.reason,
      replacementId,
      trigger: "SOURCE_REVISED",
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    },
    retentionClass: "FINANCIAL",
  });
  return { id: original.id, replacementId };
}

/**
 * Javni ulaz za servise revizije (`*-revise.ts`): storniraj trošak nastao iz izvora.
 *
 * Zatvoren projekat ne prima storno; savepoint čuva ostatak transakcije u tom slučaju.
 * Neočekivane greške se propagiraju kako se ne bi tiho izgubio storno.
 */
export async function reverseSourceCost(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    sourceType: CostSourceType;
    sourceId: string;
    reason: string;
  },
): Promise<{ reversed: boolean }> {
  await client.query("SAVEPOINT reverse_source_cost");
  try {
    const result = await reverseCostWithClient(client, {
      ...params,
      note: `Storno zbog ispravke izvornog zapisa: ${params.reason.trim()}`,
    });
    await client.query("RELEASE SAVEPOINT reverse_source_cost");
    return { reversed: result !== null };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT reverse_source_cost");
    await client.query("RELEASE SAVEPOINT reverse_source_cost");
    if (error instanceof Error && error.message.includes("PROJECT_CLOSED")) return { reversed: false };
    throw error;
  }
}

/** Ručni trošak (§3 `POST /api/costs/manual`). */
export async function createManualCost(
  pool: Pool,
  actor: CostActor,
  input: ManualCostInput,
): Promise<CostPostOutcome> {
  if (!can(actor.roles, "projects.costs.book")) return { outcome:"FORBIDDEN",message:"Nemate pravo knjiženja." };
  if (actor.scope && actor.scope!=="COMPANY" && (actor.scope!=="PROJECTS" || !(actor.projectIds ?? []).includes(input.projectId))) return {outcome:"FORBIDDEN",message:"Projekat nije u vašem opsegu."};
  const clientId=input.clientGeneratedId ?? randomUUID();
  const hash=createHash("sha256").update(JSON.stringify({...input,clientGeneratedId:clientId})).digest("hex");
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('manual-cost:' || $1 || ':' || $2,0))",[actor.companyId,clientId]);
    const previous=await client.query<{id:string;project_id:string;request_hash:string;status:"PENDING"|"APPROVED"|"REJECTED";cost_entry_id:string|null}>(
      "SELECT id,project_id,request_hash,status,cost_entry_id FROM public.manual_cost_requests WHERE company_id=$1 AND client_generated_id=$2",[actor.companyId,clientId]);
    const old=previous.rows[0];
    if(old) {
      if(actor.scope && actor.scope!=="COMPANY" && (actor.scope!=="PROJECTS" || !(actor.projectIds ?? []).includes(old.project_id))) return {outcome:"FORBIDDEN",message:"Projekat nije u vašem opsegu."};
      if(old.request_hash!==hash) return {outcome:"CONFLICT",message:"Identifikator je već korišten za drugi trošak."};
      return {outcome:"OK",id:old.cost_entry_id ?? old.id,approvalRequired:old.status==='PENDING',approvalStatus:old.status};
    }
    const project=await client.query("SELECT id FROM public.projects WHERE company_id=$1 AND id=$2 AND status<>'FINISHED'",[actor.companyId,input.projectId]);
    if(!project.rowCount) return {outcome:"VALIDATION_FAILED",code:"NOT_FOUND",message:"Projekat nije pronađen ili je završen."};
    const category=await client.query("SELECT id FROM public.cost_categories WHERE company_id=$1 AND id=$2 AND is_active FOR SHARE",[actor.companyId,input.categoryId]);
    if(!category.rowCount) return {outcome:"VALIDATION_FAILED",code:"CATEGORY",message:"Aktivna kategorija troška nije pronađena."};
    if(input.phaseId) {
      const phase=await client.query("SELECT id FROM public.project_phases WHERE company_id=$1 AND project_id=$2 AND id=$3",[actor.companyId,input.projectId,input.phaseId]);
      if(!phase.rowCount) return {outcome:"VALIDATION_FAILED",message:"Faza ne pripada projektu."};
    }
    if(input.attachmentId) {
      const attachment=await client.query(`SELECT id FROM public.attachments WHERE company_id=$1 AND id=$2 AND entity_type='PROJECT' AND entity_id=$3 AND status='ready' FOR SHARE`,[actor.companyId,input.attachmentId,input.projectId]);
      if(!attachment.rowCount) return {outcome:"VALIDATION_FAILED",code:"ATTACHMENT",message:"Fotografija računa nije spremna ili ne pripada ovom projektu."};
    }
    const currency:Currency=input.currencyCode ?? "BAM", amount=money(input.amount,currency);
    if(amount.cents<0n || amount.cents>9223372036854775807n) return {outcome:"VALIDATION_FAILED",message:"Iznos nije validan."};
    const company=await client.query<{threshold:string;currency:string}>("SELECT manual_cost_approval_threshold_cents::text AS threshold,currency FROM public.companies WHERE id=$1",[actor.companyId]);
    if(company.rows[0]?.currency!==currency) return {outcome:"VALIDATION_FAILED",message:"Valuta nije valuta firme."};
    const approvalRequired=amount.cents>BigInt(company.rows[0]!.threshold), requestId=`mcr_${randomUUID().replace(/-/g,"")}`;
    await client.query(`INSERT INTO public.manual_cost_requests(id,company_id,client_generated_id,request_hash,project_id,phase_id,category_id,occurred_on,amount_cents,currency_code,quantity,unit,note,attachment_id,status,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING',$15)`,
    [requestId,actor.companyId,clientId,hash,input.projectId,input.phaseId ?? null,input.categoryId,input.occurredOn,amount.cents.toString(),currency,input.quantity ?? null,input.unit ?? null,input.note ?? null,input.attachmentId ?? null,actor.userId]);
    if(approvalRequired) {
      await client.query(`INSERT INTO public.approval_requests(id,company_id,subject_type,subject_id,amount_cents,currency_code,status,requested_by)
        VALUES ($1,$2,'purchase',$3,$4,$5,'OPEN',$6)`,[`apr_${randomUUID().replace(/-/g,"")}`,actor.companyId,requestId,amount.cents.toString(),currency,actor.userId]);
      await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"manual_cost.requested",entityType:"manual_cost_request",entityId:requestId,retentionClass:"FINANCIAL",metadata:{projectId:input.projectId,amountCents:amount.cents.toString()}});
      return {outcome:"OK",id:requestId,approvalRequired:true,approvalStatus:"PENDING"};
    }
    const result=await postCost(client,{companyId:actor.companyId,projectId:input.projectId,phaseId:input.phaseId ?? null,categoryId:input.categoryId,sourceType:"MANUAL",sourceId:requestId,
      occurredOn:input.occurredOn,amountCents:amount.cents,currency,quantity:input.quantity ?? null,unit:input.unit ?? null,
      rateSnapshot:input.attachmentId ? {attachment_id:input.attachmentId} : null,note:input.note ?? null,actorId:actor.userId,clientGeneratedId:clientId});
    await client.query("UPDATE public.manual_cost_requests SET status='APPROVED',cost_entry_id=$3,updated_at=clock_timestamp() WHERE company_id=$1 AND id=$2",[actor.companyId,requestId,result.id]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,action:"project.cost_posted_manual",entityType:"project_cost_entry",entityId:result.id,metadata:{projectId:input.projectId,amount:input.amount,occurredOn:input.occurredOn},retentionClass:"FINANCIAL"});
    return {outcome:"OK",id:result.id,approvalRequired:false,approvalStatus:"APPROVED"};
  });
}

function mapCostRow(row: Record<string, unknown>): CostEntryRow {
  const currency = isCurrency(row.currency_code) ? row.currency_code : "BAM";
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    project_code: String(row.project_code),
    project_name: String(row.project_name),
    phase_id: row.phase_id ? String(row.phase_id) : null,
    phase_name: row.phase_name ? String(row.phase_name) : null,
    category_id: String(row.category_id),
    category_code: String(row.category_code),
    category_name: String(row.category_name),
    source_type: String(row.source_type) as CostEntryRow["source_type"],
    source_id: String(row.source_id),
    source_href: row.source_href ? String(row.source_href) : null,
    machine_id: row.machine_id ? String(row.machine_id) : null,
    machine_code: row.machine_code ? String(row.machine_code) : null,
    occurred_on: String(row.occurred_on),
    amount: row.amount_cents === null ? null : toAmountString({ cents: BigInt(String(row.amount_cents)), currency }),
    currency_code: currency,
    quantity: row.quantity === null ? null : String(row.quantity),
    unit: row.unit ? String(row.unit) : null,
    status: String(row.status) as CostEntryRow["status"],
    reversed_by: row.reversed_by ? String(row.reversed_by) : null,
    reverses_id: row.reverses_id ? String(row.reverses_id) : null,
    note: row.note ? String(row.note) : null,
    booked_at: new Date(String(row.booked_at)).toISOString(),
  };
}

/** Drill-down: trošak → izvorni zapis (§4 `/ured/projekti/[id]/troskovi`). */
function sourceHref(sourceType: string, sourceId: string): string | null {
  const base = sourceId.split(":")[0] ?? sourceId;
  switch (sourceType) {
    case "WORKDAY":
      return `/ured/radni-dani?workdayId=${encodeURIComponent(base)}`;
    case "MACHINE_WORK_LOG":
      return `/ured/sati-masine?logId=${encodeURIComponent(base)}`;
    case "FUEL_ENTRY":
      return `/ured/gorivo?entryId=${encodeURIComponent(base)}`;
    case "HAUL":
      return `/ured/ture?haulId=${encodeURIComponent(base)}`;
    case "SERVICE_ORDER":
      /* F8: trošak servisa vodi na NALOG (rad), a ne na kvar (događaj) — nalog je mjesto gdje
         se vidi sat, dijelovi i ko je radio. */
      return `/ured/servis/${encodeURIComponent(base)}`;
    default:
      return null;
  }
}

export async function listCostEntries(
  pool: Pool,
  actor: CostActor,
  filters: CostEntryFilters,
): Promise<CostListResult> {
  if (!can(actor.roles, "projects.costs.view")) {
    return { entries: [], posted: "0.00", currency: "BAM", pendingCount: 0, pendingByUnit: [] };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["e.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("$?", `$${params.length}`));
    };
    if (filters.projectId) add("e.project_id = $?", filters.projectId);
    if (filters.from) conditions.push(`e.occurred_on >= $${params.push(filters.from)}::date`);
    if (filters.to) conditions.push(`e.occurred_on <= $${params.push(filters.to)}::date`);
    if (filters.categoryId) add("e.category_id = $?", filters.categoryId);
    if (filters.phaseId) add("e.phase_id = $?", filters.phaseId);
    if (filters.status) add("e.status = $?", filters.status);

    const result = await client.query(
      `SELECT e.id, e.project_id, p.code AS project_code, p.name AS project_name,
              e.phase_id, ph.name AS phase_name,
              e.category_id, cc.code AS category_code, cc.name AS category_name,
              e.source_type, e.source_id, e.machine_id, m.code AS machine_code,
              e.occurred_on::text, e.amount_cents::text, e.currency_code, e.quantity::text, e.unit,
              e.status, e.reversed_by, e.reverses_id, e.note, e.booked_at::text
         FROM public.cost_entries e
         JOIN public.projects p ON p.company_id = e.company_id AND p.id = e.project_id
         JOIN public.cost_categories cc ON cc.company_id = e.company_id AND cc.id = e.category_id
         LEFT JOIN public.project_phases ph ON ph.company_id = e.company_id AND ph.id = e.phase_id
         LEFT JOIN public.machines m ON m.company_id = e.company_id AND m.id = e.machine_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY e.occurred_on DESC, e.booked_at DESC, e.id
        LIMIT 1000`,
      params,
    );
    const entries = result.rows.map((row) => ({
      ...mapCostRow(row),
      source_href: sourceHref(String(row.source_type), String(row.source_id)),
    }));

    const companyCurrency = await client.query<{ currency_code: string | null }>(
      `SELECT coalesce((SELECT currency_code FROM public.projects
                         WHERE company_id = $1 AND currency_code IS NOT NULL
                         ORDER BY created_at DESC LIMIT 1), 'BAM') AS currency_code`,
      [actor.companyId],
    );
    const currency = isCurrency(companyCurrency.rows[0]?.currency_code)
      ? companyCurrency.rows[0]!.currency_code as Currency
      : "BAM";
    let postedCents = 0n;
    let pendingCount = 0;
    const pendingByUnit = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status === "POSTED" && entry.amount !== null) {
        postedCents += money(entry.amount, currency).cents;
      } else if (entry.status === "PENDING") {
        pendingCount += 1;
        const unit = entry.unit ?? "—";
        pendingByUnit.set(unit, (pendingByUnit.get(unit) ?? 0) + Number(entry.quantity ?? 0));
      }
    }
    return {
      entries,
      posted: toAmountString({ cents: postedCents, currency }),
      currency,
      pendingCount,
      pendingByUnit: [...pendingByUnit.entries()].map(([unit, quantity]) => ({
        unit,
        quantity: quantity.toFixed(3),
      })),
    };
  });
}

/** Poslovni datum firme — ponovni izvoz da servisi troška ne zavise od `project-service`-a. */
export { companyToday };
