/**
 * F0.3 — punjenje `canUseEntity` iz baze. Odluka je u domeni, upiti su ovdje.
 *
 * Jedan batch upit po entitetu (bez N+1 u listama): za listu radnika ili mašina servis vrati
 * sve signale odjednom, pa ekran ne pravi 40 upita za 40 redova.
 *
 * Izvori (spec 02 §15, spec 05 §29, spec 09):
 *   - `obligations` — najnovija aktivna obaveza po tipu (`superseded_by IS NULL`);
 *   - `machine_faults` — aktivan kvar (upozorenje, ne blokada);
 *   - `maintenance_plans` / `service_orders` — dolaze u Modulu 9; servis ih čita kad tabele
 *     postoje, pa do tada vraća prazno (bez `if`-a u pozivaocima).
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany, type CompanyId } from "@gradix/db";
import {
  canUseEntity,
  usageBlockMessage,
  usageWarningMessage,
  type UsageAction,
  type UsageDecision,
  type UsageEntityKind,
  type UsageOverride,
  type UsageSignal,
} from "@gradix/domain";
import { companyToday } from "./project-service";

type EntityRef = { entityKind: UsageEntityKind; entityId: string };

function signalKey(entityKind: UsageEntityKind, entityId: string): string {
  return `${entityKind}:${entityId}`;
}

/**
 * Signali za više entiteta jednim upitom po izvoru.
 *
 * `today` je poslovni datum firme i ide u SQL (`obligation_state`), pa baza i domena daju isti
 * odgovor na „je li isteklo“ — rok koji istječe danas još nije istekao.
 */
async function loadSignals(
  client: PoolClient,
  companyId: string | CompanyId,
  refs: readonly EntityRef[],
  today: string,
): Promise<Map<string, UsageSignal[]>> {
  const byEntity = new Map<string, UsageSignal[]>();
  for (const ref of refs) byEntity.set(signalKey(ref.entityKind, ref.entityId), []);

  const workerIds = refs.filter((ref) => ref.entityKind === "WORKER").map((ref) => ref.entityId);
  const machineIds = refs.filter((ref) => ref.entityKind === "MACHINE").map((ref) => ref.entityId);
  const tenderIds = refs.filter((ref) => ref.entityKind === "TENDER").map((ref) => ref.entityId);

  const obligations = await client.query<{
    id: string;
    worker_id: string | null;
    machine_id: string | null;
    tender_id: string | null;
    label: string;
    state: string;
    blocks_assignment: boolean;
    blocks_actions: string[] | null;
    expires_on: string | null;
  }>(
    // F2: pragovi i stanje se računaju iz STVARNIH pragova obaveze (vlastiti `reminder_days`
    // nadjačava tipove), a `review_at`/`review_state` ulaze u formulu — inače bi dokument koji
    // čeka provjeru ili je odbijen izgledao „važeći“ i ne bi blokirao.
    `SELECT o.id, o.worker_id, o.machine_id, o.tender_id, t.label,
            obligation_state(
              o.expires_at,
              COALESCE(o.reminder_days, t.default_reminder_days),
              $4,
              o.superseded_by IS NOT NULL,
              o.review_at,
              o.review_state
            ) AS state,
            t.blocks_assignment, t.blocks_actions, to_char(o.expires_at, 'YYYY-MM-DD') AS expires_on
       FROM obligations o
       JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
      WHERE o.company_id = $1
        AND o.superseded_by IS NULL
        AND (o.worker_id = ANY($2) OR o.machine_id = ANY($3) OR o.tender_id = ANY($5))`,
    [companyId, workerIds, machineIds, today, tenderIds],
  );

  for (const row of obligations.rows) {
    const signal: UsageSignal = {
      source: "OBLIGATION",
      // Datum ide iz `to_char`, ne iz `Date`: `DATE` kroz `pg` postaje lokalna ponoć i mogao
      // bi prikazati dan ranije u vremenskoj zoni koja nije Sarajevo.
      label: `${row.label}${row.expires_on ? ` (${row.expires_on})` : ""}`,
      state: String(row.state),
      blocking: Boolean(row.blocks_assignment),
      // `blocks_actions` je tačan spisak radnji koje tip blokira; `blocking` ostaje za starije
      // redove tipova gdje je kolona tek dodata sa podrazumijevanom vrijednošću.
      blockingActions: Array.isArray(row.blocks_actions)
        ? (row.blocks_actions as UsageAction[])
        : undefined,
      referenceId: String(row.id),
    };
    if (row.worker_id) byEntity.get(signalKey("WORKER", String(row.worker_id)))?.push(signal);
    if (row.machine_id) byEntity.get(signalKey("MACHINE", String(row.machine_id)))?.push(signal);
    if (row.tender_id) byEntity.get(signalKey("TENDER", String(row.tender_id)))?.push(signal);
  }

  if (machineIds.length > 0) {
    const faults = await client.query<{ id: string; machine_id: string; title: string; status: string }>(
      `SELECT id, machine_id, title, status FROM machine_faults
        WHERE company_id = $1 AND machine_id = ANY($2)
          AND status IN ('OPEN', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS')`,
      [companyId, machineIds],
    );
    for (const row of faults.rows) {
      byEntity.get(signalKey("MACHINE", String(row.machine_id)))?.push({
        source: "FAULT",
        label: `Kvar: ${String(row.title)}`,
        state: String(row.status),
        blocking: true,
        referenceId: String(row.id),
      });
    }
  }

  return byEntity;
}

/** Iznimke za jedan subjekt i jednu radnju, još važeće na `today`. */
async function loadOverrides(
  client: PoolClient,
  companyId: string | CompanyId,
  ref: EntityRef,
  action: UsageAction,
  today: string,
): Promise<UsageOverride[]> {
  const found = await client.query<{
    reference_id: string | null;
    reason: string;
    valid_to: string | null;
  }>(
    `SELECT reference_id, reason, to_char(valid_to, 'YYYY-MM-DD') AS valid_to FROM usage_overrides
      WHERE company_id = $1 AND subject_kind = $2 AND subject_id = $3 AND action = $4
        AND valid_from <= $5::date
        AND (valid_to IS NULL OR valid_to >= $5::date)`,
    [companyId, ref.entityKind, ref.entityId, action, today],
  );
  return found.rows
    .filter((row) => row.reference_id !== null)
    .map((row) => ({
      referenceId: String(row.reference_id),
      action,
      reason: String(row.reason),
      validUntil: row.valid_to ?? "9999-12-31",
    }));
}

/**
 * Razlika `Pool` / `PoolClient` bez `any`: klijent NEMA `connect`.
 * Mijenjanje tipa bi značilo da svaki pozivalac unutar transakcije mora otvoriti novu
 * konekciju — a onda blokada ne vidi upravo upisani red.
 */
function isPoolClient(value: Pool | PoolClient): value is PoolClient {
  return typeof (value as PoolClient).release === "function";
}

/** Odluka + gotove poruke za API/klijenta (jedan tekst za web, mobilni i worker). */
export function withMessages(decision: UsageDecision) {
  return {
    ...decision,
    blockMessage: usageBlockMessage(decision),
    warnMessage: usageWarningMessage(decision),
  };
}

/** Odluka za JEDAN entitet. Može se zvati unutar postojeće transakcije (`PoolClient`). */
export async function checkUse(
  pool: Pool | PoolClient,
  companyId: string | CompanyId,
  input: EntityRef & { action: UsageAction; today: string },
): Promise<UsageDecision> {
  const cid = typeof companyId === "string" ? toCompanyId(companyId) : companyId;
  if (isPoolClient(pool)) {
    const client = pool;
    const signals = await loadSignals(client, cid, [input], input.today);
    const overrides = await loadOverrides(client, cid, input, input.action, input.today);
    return canUseEntity({
      entityKind: input.entityKind,
      entityId: input.entityId,
      action: input.action,
      onDate: input.today,
      signals: signals.get(signalKey(input.entityKind, input.entityId)) ?? [],
      overrides,
    });
  }
  return withCompany(pool, cid, async (client) => {
    const signals = await loadSignals(client, cid, [input], input.today);
    const overrides = await loadOverrides(client, cid, input, input.action, input.today);
    return canUseEntity({
      entityKind: input.entityKind,
      entityId: input.entityId,
      action: input.action,
      onDate: input.today,
      signals: signals.get(signalKey(input.entityKind, input.entityId)) ?? [],
      overrides,
    });
  });
}

/** Batch: odluke za listu entiteta ISTOG tipa i iste radnje (npr. sve mašine na ekranu). */
export async function checkUseBatch(
  pool: Pool | PoolClient,
  companyId: string | CompanyId,
  input: { entityKind: UsageEntityKind; entityIds: readonly string[]; action: UsageAction; today: string },
): Promise<Map<string, UsageDecision>> {
  const cid = typeof companyId === "string" ? toCompanyId(companyId) : companyId;
  const decisions = new Map<string, UsageDecision>();
  if (input.entityIds.length === 0) return decisions;

  const run = async (client: PoolClient) => {
    const refs = input.entityIds.map((entityId) => ({ entityKind: input.entityKind, entityId }));
    const signals = await loadSignals(client, cid, refs, input.today);

    const overrides = await client.query<{
      subject_id: string;
      reference_id: string | null;
      reason: string;
      valid_to: string | null;
    }>(
      `SELECT subject_id, reference_id, reason, to_char(valid_to, 'YYYY-MM-DD') AS valid_to
         FROM usage_overrides
        WHERE company_id = $1 AND subject_kind = $2 AND subject_id = ANY($3) AND action = $4
          AND valid_from <= $5::date
          AND (valid_to IS NULL OR valid_to >= $5::date)`,
      [companyId, input.entityKind, [...input.entityIds], input.action, input.today],
    );

    for (const entityId of input.entityIds) {
      const own = overrides.rows
        .filter((row) => String(row.subject_id) === entityId && row.reference_id !== null)
        .map((row) => ({
          referenceId: String(row.reference_id),
          action: input.action,
          reason: String(row.reason),
          validUntil: row.valid_to ?? "9999-12-31",
        }));
      decisions.set(
        entityId,
        canUseEntity({
          entityKind: input.entityKind,
          entityId,
          action: input.action,
          onDate: input.today,
          signals: signals.get(signalKey(input.entityKind, entityId)) ?? [],
          overrides: own,
        }),
      );
    }
    return decisions;
  };

  return isPoolClient(pool) ? run(pool) : withCompany(pool, cid, run);
}

/**
 * `GET /api/me/blockers` — jedna odluka za sve radnje koje radnik/rukovalac stvarno koristi.
 *
 * Zašto batch: telefon u nedostatku mreže ne smije praviti 40 zahtjeva. Web i mobilni dobijaju
 * ISTI odgovor, pa traka na terenu i traka u uredu ne mogu reći dvije različite stvari.
 */
export async function meBlockers(
  pool: Pool,
  input: { companyId: string; userId: string; permissions: readonly string[] },
): Promise<{
  today: string;
  workerId: string | null;
  worker: Record<"assign" | "workday", ReturnType<typeof canUseEntity>> | null;
  machines: {
    id: string;
    code: string;
    name: string;
    haul: ReturnType<typeof canUseEntity>;
    machineHours: ReturnType<typeof canUseEntity>;
    fuel: ReturnType<typeof canUseEntity>;
  }[];
}> {
  return withCompany(pool, toCompanyId(input.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(input.companyId));
    const worker = await client.query<{ id: string }>(
      "SELECT id FROM public.workers WHERE company_id = $1 AND user_id = $2 AND is_active",
      [input.companyId, input.userId],
    );
    const workerId = worker.rows[0]?.id ?? null;

    const workerDecisions = workerId
      ? {
          assign: await checkUse(client, input.companyId, {
            entityKind: "WORKER",
            entityId: workerId,
            action: "assign",
            today,
          }),
          workday: await checkUse(client, input.companyId, {
            entityKind: "WORKER",
            entityId: workerId,
            action: "workday",
            today,
          }),
        }
      : null;

    /*
     * Rukovalac vidi SVOJE mašine; ured vidi sve. Dozvola se provjerava prije upita — ako
     * korisnik ne smije ni pogledati mašine, lista je prazna (ne 403: to nije radnja, to je
     * sadržaj ekrana).
     */
    const canSeeMachines = input.permissions.some((permission) =>
      ["machines.view", "machines.haul.view", "machines.fuel.view", "machines.check.view"].includes(permission),
    );
    if (!canSeeMachines) {
      return { today, workerId, worker: workerDecisions, machines: [] };
    }

    const machines = await client.query<{ id: string; code: string; name: string }>(
      `SELECT DISTINCT m.id, m.code, m.name
         FROM public.machines m
        WHERE m.company_id = $1
          AND (m.is_active)
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.project_assignments a
               WHERE a.company_id = m.company_id AND a.machine_id = m.id AND a.voided_at IS NULL
            )
            OR EXISTS (
              SELECT 1 FROM public.project_assignments a
               WHERE a.company_id = m.company_id AND a.machine_id = m.id AND a.voided_at IS NULL
                 AND a.from_date <= $2::date AND (a.to_date IS NULL OR a.to_date >= $2::date)
            )
          )
        ORDER BY m.code`,
      [input.companyId, today],
    );

    const ids = machines.rows.map((row) => String(row.id));
    const [haul, hours, fuel] = await Promise.all([
      checkUseBatch(client, input.companyId, { entityKind: "MACHINE", entityIds: ids, action: "haul", today }),
      checkUseBatch(client, input.companyId, { entityKind: "MACHINE", entityIds: ids, action: "machine_hours", today }),
      checkUseBatch(client, input.companyId, { entityKind: "MACHINE", entityIds: ids, action: "fuel", today }),
    ]);

    const empty = canUseEntity({ entityKind: "MACHINE", entityId: "", action: "fuel", onDate: today, signals: [] });

    return {
      today,
      workerId,
      worker: workerDecisions,
      machines: machines.rows.map((row) => {
        const id = String(row.id);
        return {
          id,
          code: String(row.code),
          name: String(row.name),
          haul: haul.get(id) ?? empty,
          machineHours: hours.get(id) ?? empty,
          fuel: fuel.get(id) ?? empty,
        };
      }),
    };
  });
}
