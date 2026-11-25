/**
 * F7 — tender servis: unos, izmjena, rokovi, izvor, odluka o učešću i promjena statusa.
 *
 * Pravila koja žive OVDJE (a ne u rutama ili UI-u), i zašto:
 *
 *  - **Prelazak je matrica, ne polje.** `assertTenderTransition` je jedina kapija; rutina
 *    koja bi pisala `status` direktno zaobišla bi cijeli tok (GO/NO-GO, checklista, ishod).
 *  - **Rok je obavezan za predaju.** `SUBMITTED` bez `deadline_at` je ponuda bez datuma —
 *    podsjetnik i kalendar tada ne postoje, a propušten rok se vidi tek kad je propušten.
 *  - **Checklista blokira predaju.** `TENDER_CHECKLIST_INCOMPLETE` nosi IMENA stavki, jer
 *    „nije kompletno“ ne kaže čovjeku šta da donese.
 *  - **Odluka je cjelina.** `participate` bez `decided_by`/`decided_at` bila bi tvrdnja bez
 *    tragа ko ju je donio; zato je `decision` jedna radnja, ne tri PATCH-a.
 *  - **Ishod je uslov za izlazak iz toka.** `LOST`/`WITHDRAWN`/`CANCELLED` traže razlog
 *    (§1.5/20) — bez njega statistika uspješnosti uči ništa.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, money, type Currency } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";
import {
  assertTenderTransition,
  isTenderStatus,
  TENDER_OUTCOME_STATUSES,
  type TenderStatus,
} from "./tender-status";
import { mapTenderRow, TENDER_SELECT, type TenderRow } from "./tender-map";
import { blockingChecklistItems } from "@gradix/domain";

export type { TenderRow } from "./tender-map";
export type TenderActor = { userId: string; companyId: string; roles: Role[] };

/** Izvor tendera (§1.2/7). */
export const TENDER_SOURCES = ["PORTAL", "INVITATION", "DIRECT", "OTHER"] as const;

export type TenderCreateInput = {
  title: string;
  partnerId: string;
  submittedValueAmount: string;
  currencyCode: string;
  note?: string | null;
  deadlineAt?: string | null;
  questionsDeadlineAt?: string | null;
  siteVisitAt?: string | null;
  openedAt?: string | null;
  source?: string | null;
  portalName?: string | null;
  externalRef?: string | null;
  estimatedValueAmount?: string | null;
};

export type TenderPatchInput = {
  title?: string;
  partnerId?: string;
  submittedValueAmount?: string;
  currencyCode?: string;
  status?: TenderStatus;
  note?: string | null;
  deadlineAt?: string | null;
  questionsDeadlineAt?: string | null;
  siteVisitAt?: string | null;
  openedAt?: string | null;
  source?: string | null;
  portalName?: string | null;
  externalRef?: string | null;
  estimatedValueAmount?: string | null;
  /** Razlog ručne izmjene cijene (kad `price_source='MANUAL'`). */
  priceReason?: string | null;
};

export type TenderOutcome =
  | { outcome: "OK"; id?: string; tender?: TenderRow }
  | {
      outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND";
      code?: string;
      message?: string;
    };

/** Koliko dana unaprijed `/pregled` prikazuje tenderske rokove (spec 08 §4). */
export const TENDER_UPCOMING_DAYS = 14;

function isoOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function parseValue(
  amount: string | null | undefined,
  currency: Currency,
): { cents: bigint; currency: Currency } | { error: string } {
  if (amount === null || amount === undefined || amount === "") return { error: "Iznos je obavezan." };
  try {
    const value = money(amount, currency);
    if (value.cents < 0n) return { error: "Iznos ne smije biti negativan." };
    return value;
  } catch {
    return { error: "Neispravan iznos (očekuje se npr. 1234.50)." };
  }
}

/** RLS-aware mapiranje sa pravom na maržu: marža se ne šalje onome ko je ne smije vidjeti. */
function mapFor(actor: TenderActor, row: Record<string, unknown>): TenderRow {
  return mapTenderRow(row, { includeMargin: can(actor.roles, "tenders.price.manage") });
}

export async function listTenders(
  pool: Pool,
  actor: TenderActor,
  filter: { status?: string; urgent?: boolean } = {},
): Promise<TenderRow[]> {
  if (!can(actor.roles, "tenders.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query(
      `${TENDER_SELECT}
        WHERE t.company_id = $1
          AND ($2::text IS NULL OR t.status = $2)
          AND ($3::boolean IS NOT TRUE OR (
            t.deadline_at IS NOT NULL
            AND (t.deadline_at AT TIME ZONE 'Europe/Sarajevo')::date
                BETWEEN (clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::date
                    AND (clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::date + $4::int
            AND t.status NOT IN ('WON', 'LOST', 'WITHDRAWN', 'CANCELLED')
          ))
        ORDER BY COALESCE(t.deadline_at, t.created_at) ASC, t.created_at DESC
        LIMIT 500`,
      [
        actor.companyId,
        filter.status && isTenderStatus(filter.status) ? filter.status : null,
        filter.urgent === true,
        TENDER_UPCOMING_DAYS,
      ],
    );
    return rows.rows.map((row) => mapFor(actor, row));
  });
}

export async function getTender(pool: Pool, actor: TenderActor, id: string): Promise<TenderRow | null> {
  if (!can(actor.roles, "tenders.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query(`${TENDER_SELECT} WHERE t.company_id = $1 AND t.id = $2`, [
      actor.companyId,
      id,
    ]);
    return result.rows[0] ? mapFor(actor, result.rows[0]) : null;
  });
}

export async function createTender(
  pool: Pool,
  actor: TenderActor,
  input: TenderCreateInput,
): Promise<TenderOutcome> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!input.title?.trim() || !input.partnerId) {
    return { outcome: "VALIDATION_FAILED", message: "Naslov i naručilac su obavezni." };
  }
  if (!isCurrency(input.currencyCode)) {
    return { outcome: "VALIDATION_FAILED", message: "Nepodržana valuta." };
  }
  const value = parseValue(input.submittedValueAmount, input.currencyCode);
  if ("error" in value) return { outcome: "VALIDATION_FAILED", message: value.error };
  const estimated =
    input.estimatedValueAmount === undefined || input.estimatedValueAmount === null
      ? null
      : parseValue(input.estimatedValueAmount, value.currency);
  if (estimated && "error" in estimated) return { outcome: "VALIDATION_FAILED", message: estimated.error };
  if (input.source && !(TENDER_SOURCES as readonly string[]).includes(input.source)) {
    return { outcome: "VALIDATION_FAILED", message: "Nepoznat izvor tendera." };
  }

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const partner = await client.query(
      `SELECT 1 FROM public.partners WHERE id = $1 AND company_id = $2 AND active`,
      [input.partnerId, actor.companyId],
    );
    if (partner.rowCount === 0) {
      return { outcome: "VALIDATION_FAILED", message: "Naručilac (partner) nije pronađen." };
    }
    /* Referentni broj naručioca je jedinstven po firmi kad postoji (§1.2/7): isti broj
       unesen dvaput je isti tender dvaput, a to se vidi kao greška, ne kao duplikat. */
    const externalRef = input.externalRef?.trim() || null;
    if (externalRef) {
      const taken = await client.query(
        `SELECT 1 FROM public.tenders WHERE company_id = $1 AND external_ref = $2`,
        [actor.companyId, externalRef],
      );
      if (taken.rowCount !== 0) {
        return {
          outcome: "CONFLICT",
          code: "TENDER_REFERENCE_TAKEN",
          message: `Referentni broj „${externalRef}“ je već na drugom tenderu.`,
        };
      }
    }
    const id = `tnd_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.tenders (
         id, company_id, title, partner_id, submitted_value_cents, currency_code,
         status, note, deadline_at, questions_deadline_at, site_visit_at, opened_at,
         source, portal_name, external_ref, estimated_value_cents,
         price_source, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'OPPORTUNITY',$7,$8,$9,$10,$11,$12,$13,$14,$15,'MANUAL',$16,$16)`,
      [
        id,
        actor.companyId,
        input.title.trim(),
        input.partnerId,
        value.cents.toString(),
        value.currency,
        input.note?.trim() || null,
        isoOrNull(input.deadlineAt),
        isoOrNull(input.questionsDeadlineAt),
        isoOrNull(input.siteVisitAt),
        isoOrNull(input.openedAt),
        input.source ?? null,
        input.portalName?.trim() || null,
        externalRef,
        estimated && "cents" in estimated ? estimated.cents.toString() : null,
        actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.created",
      entityType: "tender",
      entityId: id,
      metadata: { title: input.title.trim() },
    });
    return { outcome: "OK" as const, id };
  });
}

/**
 * Promjena statusa sa svim kapijama iz specifikacije. Izdvojeno iz `patchTender` jer je ovo
 * jedina radnja koja mijenja tok, a miješanje sa izmjenom naslova otežava čitanje pravila.
 */
async function changeStatus(
  client: PoolClient,
  actor: TenderActor,
  id: string,
  from: TenderStatus,
  to: TenderStatus,
  input: TenderPatchInput,
): Promise<TenderOutcome> {
  if (from === to) return { outcome: "OK", id };
  try {
    assertTenderTransition(from, to);
  } catch {
    return { outcome: "CONFLICT", code: "TENDER_INVALID_STATUS", message: "Nedozvoljen prelaz statusa." };
  }

  const current = await client.query<{
    deadline_at: Date | string | null;
    participate: boolean | null;
    decided_by: string | null;
  }>(
    `SELECT deadline_at, participate, decided_by FROM public.tenders
      WHERE id = $1 AND company_id = $2`,
    [id, actor.companyId],
  );
  const row = current.rows[0]!;

  // (1) Odluka o učešću prije pripreme (§1.1/3).
  if (to === "PREPARATION" && row.participate !== true) {
    return {
      outcome: "CONFLICT",
      code: "TENDER_DECISION_REQUIRED",
      message: "Prije pripreme donesite odluku o učešću (DA/NE).",
    };
  }

  // (2) Rok dostave je obavezan za predaju (§1.2/6).
  if (to === "SUBMITTED" && !row.deadline_at) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "TENDER_DEADLINE_REQUIRED",
      message: "Za predaju ponude upišite rok dostave.",
    };
  }

  // (3) Checklista mora biti kompletna (§1.4/16).
  if (to === "SUBMITTED") {
    const items = await client.query<{
      code: string;
      label: string;
      required: boolean;
      status: string;
      note: string | null;
    }>(
      `SELECT code, label, required, status, note FROM public.tender_checklist_items
        WHERE company_id = $1 AND tender_id = $2 ORDER BY sort_order`,
      [actor.companyId, id],
    );
    const blocking = blockingChecklistItems(
      items.rows.map((item) => ({
        code: item.code,
        label: item.label,
        required: item.required,
        status: item.status as "MISSING" | "ATTACHED" | "NOT_APPLICABLE",
        note: item.note,
      })),
    );
    if (blocking.length > 0) {
      return {
        outcome: "CONFLICT",
        code: "TENDER_CHECKLIST_INCOMPLETE",
        message: `Kontrolna lista nije kompletna: ${blocking.map((item) => item.label).join(", ")}.`,
      };
    }
  }

  // (4) Izlazak iz toka traži ishod sa razlogom (§1.5/20).
  if (TENDER_OUTCOME_STATUSES.includes(to)) {
    const outcome = await client.query<{ result: string; lost_reason: string | null }>(
      `SELECT result, lost_reason FROM public.tender_outcomes
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, id],
    );
    const recorded = outcome.rows[0];
    if (!recorded) {
      return {
        outcome: "CONFLICT",
        code: "TENDER_OUTCOME_REASON_REQUIRED",
        message: "Prije zatvaranja upišite ishod (rezultat i razlog).",
      };
    }
    if (recorded.result !== to) {
      return {
        outcome: "CONFLICT",
        code: "TENDER_OUTCOME_REASON_REQUIRED",
        message: `Ishod je zapisan kao „${recorded.result}“, a status je „${to}“ — uskladite ih.`,
      };
    }
  }

  const setSubmittedAt = to === "SUBMITTED";
  await client.query(
    `UPDATE public.tenders SET
       status = $3,
       submitted_at = CASE WHEN $4::boolean THEN COALESCE(submitted_at, clock_timestamp()) ELSE submitted_at END,
       updated_by = $5, updated_at = clock_timestamp()
     WHERE id = $1 AND company_id = $2`,
    [id, actor.companyId, to, setSubmittedAt, actor.userId],
  );

  /*
   * Prijelaz u `PREPARATION` pravi DVA roka (§1.2/9): rok za pitanja i rok za predaju.
   * `ON CONFLICT` po parcijalnom unique indeksu `(company_id, tender_id, type_id)` čini
   * ponovni poziv idempotentnim — tender se ne može „vratiti u pripremu“ matricom, ali
   * mrežni ponovni zahtjev ne smije napraviti duplikat.
   */
  if (to === "PREPARATION") {
    const deadline = row.deadline_at;
    await ensureTenderObligation(client, actor, id, "TENDER_DEADLINE", deadline, `${input.title ?? ""}`);
    const questions = await client.query<{ questions_deadline_at: Date | string | null }>(
      `SELECT questions_deadline_at FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [id, actor.companyId],
    );
    await ensureTenderObligation(
      client,
      actor,
      id,
      "TENDER_QUESTIONS",
      questions.rows[0]?.questions_deadline_at ?? null,
      "",
    );
  }

  await writeAudit(client, {
    companyId: actor.companyId,
    actorId: actor.userId,
    actorEmail: null,
    action: "tender.status_changed",
    entityType: "tender",
    entityId: id,
    metadata: { from, to },
  });
  return { outcome: "OK", id };
}

/**
 * Automatska obaveza za tender. Bez roka nema obaveze: red koji „visi“ bez datuma ne ulazi
 * ni u podsjetnik ni u kalendar, pa bi bio šum u `/ured/rokovi`.
 */
/**
 * `node-postgres` vraća `timestamptz` kao `Date`, a `date` kao string. Oba oblika ulaze u ovaj
 * normalizator jer jedan poziv dolazi iz `Date` (rok tendera), a drugi iz teksta (kad vrijednost
 * dođe iz API-ja) — bez toga `.slice` puca na `Date` i kapija padne umjesto da napiše obavezu.
 */
function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function ensureTenderObligation(
  client: PoolClient,
  actor: TenderActor,
  tenderId: string,
  typeCode: string,
  expiresAt: Date | string | null,
  _title: string,
): Promise<void> {
  if (!expiresAt) return;
  const type = await client.query<{ id: string }>(
    `SELECT id FROM public.obligation_types WHERE company_id = $1 AND code = $2 AND is_active`,
    [actor.companyId, typeCode],
  );
  const typeId = type.rows[0]?.id;
  if (!typeId) return;

  const id = `obl_${randomUUID()}`;
  const inserted = await client.query(
    `INSERT INTO public.obligations (id, company_id, type_id, tender_id, created_by, review_at)
     SELECT $1, $2, $3, $4, $5, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM public.obligations
         WHERE company_id = $2 AND tender_id = $4 AND type_id = $3 AND superseded_by IS NULL
      )`,
    [id, actor.companyId, typeId, tenderId, actor.userId],
  );
  if (inserted.rowCount === 0) return;

  await client.query(
    `INSERT INTO public.obligation_versions (id, company_id, obligation_id, version, number, issuer,
                                              issued_at, expires_at, note, created_by)
     VALUES ($1, $2, $3, 1, NULL, NULL, NULL, $4, 'automatski iz tendera', $5)`,
    [`obv_${randomUUID()}`, actor.companyId, id, toDateOnly(expiresAt), actor.userId],
  );
}

export async function patchTender(
  pool: Pool,
  actor: TenderActor,
  id: string,
  input: TenderPatchInput,
): Promise<TenderOutcome> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const current = await client.query<{ status: string }>(
      `SELECT status FROM public.tenders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, actor.companyId],
    );
    const before = current.rows[0];
    if (!before || !isTenderStatus(before.status)) {
      return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    }

    let cents: string | null = null;
    let currency: string | null = null;
    let estimatedCents: string | null = null;
    if (
      input.submittedValueAmount !== undefined ||
      input.currencyCode !== undefined ||
      input.estimatedValueAmount !== undefined
    ) {
      const currentRow = await client.query<{ currency_code: string }>(
        `SELECT currency_code FROM public.tenders WHERE id = $1 AND company_id = $2`,
        [id, actor.companyId],
      );
      const cur = (input.currencyCode ?? currentRow.rows[0]?.currency_code ?? "BAM") as Currency;
      if (!isCurrency(cur)) return { outcome: "VALIDATION_FAILED", message: "Nepodržana valuta." };
      if (input.submittedValueAmount !== undefined) {
        const value = parseValue(input.submittedValueAmount, cur);
        if ("error" in value) return { outcome: "VALIDATION_FAILED", message: value.error };
        cents = value.cents.toString();
        currency = value.currency;
      }
      if (input.estimatedValueAmount !== undefined) {
        if (input.estimatedValueAmount === null) {
          estimatedCents = null;
        } else {
          const value = parseValue(input.estimatedValueAmount, cur);
          if ("error" in value) return { outcome: "VALIDATION_FAILED", message: value.error };
          estimatedCents = value.cents.toString();
        }
      }
    }

    /* Ručna izmjena ponuđene vrijednosti mijenja izvor cijene na `MANUAL` i traži razlog
       (§1.3/12). Bez toga bi izvedena i prepisana cijena izgledale isto, a marža bi bila
       izračunata iz broja koji nije iz kalkulacije. */
    if (cents !== null) {
      if (!input.priceReason || input.priceReason.trim().length < 3) {
        return {
          outcome: "VALIDATION_FAILED",
          code: "TENDER_PRICE_APPROVAL_REQUIRED",
          message: "Ručna izmjena ponuđene vrijednosti traži razlog (najmanje 3 znaka).",
        };
      }
    }

    if (input.externalRef?.trim()) {
      const taken = await client.query(
        `SELECT 1 FROM public.tenders
          WHERE company_id = $1 AND external_ref = $2 AND id <> $3`,
        [actor.companyId, input.externalRef.trim(), id],
      );
      if (taken.rowCount !== 0) {
        return {
          outcome: "CONFLICT",
          code: "TENDER_REFERENCE_TAKEN",
          message: `Referentni broj „${input.externalRef.trim()}“ je već na drugom tenderu.`,
        };
      }
    }

    await client.query(
      `UPDATE public.tenders SET
         title = COALESCE($3, title), partner_id = COALESCE($4, partner_id),
         submitted_value_cents = COALESCE($5::bigint, submitted_value_cents),
         currency_code = COALESCE($6, currency_code),
         price_source = CASE WHEN $5::bigint IS NULL THEN price_source ELSE 'MANUAL' END,
         note = CASE WHEN $7::boolean THEN $8 ELSE note END,
         deadline_at = CASE WHEN $9::boolean THEN $10::timestamptz ELSE deadline_at END,
         questions_deadline_at = CASE WHEN $11::boolean THEN $12::timestamptz ELSE questions_deadline_at END,
         site_visit_at = CASE WHEN $13::boolean THEN $14::timestamptz ELSE site_visit_at END,
         opened_at = CASE WHEN $15::boolean THEN $16::timestamptz ELSE opened_at END,
         source = CASE WHEN $17::boolean THEN $18 ELSE source END,
         portal_name = CASE WHEN $19::boolean THEN $20 ELSE portal_name END,
         external_ref = CASE WHEN $21::boolean THEN $22 ELSE external_ref END,
         estimated_value_cents = CASE WHEN $23::boolean THEN $24::bigint ELSE estimated_value_cents END,
         updated_by = $25, updated_at = clock_timestamp()
       WHERE id = $1 AND company_id = $2`,
      [
        id,
        actor.companyId,
        input.title?.trim() ?? null,
        input.partnerId ?? null,
        cents,
        currency,
        input.note !== undefined,
        input.note === undefined ? null : input.note,
        input.deadlineAt !== undefined,
        isoOrNull(input.deadlineAt),
        input.questionsDeadlineAt !== undefined,
        isoOrNull(input.questionsDeadlineAt),
        input.siteVisitAt !== undefined,
        isoOrNull(input.siteVisitAt),
        input.openedAt !== undefined,
        isoOrNull(input.openedAt),
        input.source !== undefined,
        input.source ?? null,
        input.portalName !== undefined,
        input.portalName?.trim() || null,
        input.externalRef !== undefined,
        input.externalRef?.trim() || null,
        input.estimatedValueAmount !== undefined,
        estimatedCents,
        actor.userId,
      ],
    );

    if (input.status !== undefined) {
      const changed = await changeStatus(client, actor, id, before.status, input.status, input);
      if (changed.outcome !== "OK") return changed;
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.updated",
      entityType: "tender",
      entityId: id,
      metadata: {
        status: input.status ?? before.status,
        manualPrice: cents !== null,
        priceReason: cents !== null ? input.priceReason?.trim() : null,
      },
    });
    return { outcome: "OK", id };
  });
}

/**
 * Odluka o učešću (§1.1/3): DA ili NE + razlog. NE vodi u `CANCELLED` odmah — odluka je
 * jedan dijalog, a ne dvije radnje; inače ostane tender u `GO_NO_GO` sa upisanim „NE“.
 */
export async function decideTenderParticipation(
  pool: Pool,
  actor: TenderActor,
  id: string,
  input: { participate: boolean; reason: string },
): Promise<TenderOutcome> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const reason = input.reason.trim();
  if (reason.length < 3) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "TENDER_DECISION_REQUIRED",
      message: "Razlog odluke je obavezan (najmanje 3 znaka).",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const current = await client.query<{ status: string }>(
      `SELECT status FROM public.tenders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, actor.companyId],
    );
    const before = current.rows[0];
    if (!before || !isTenderStatus(before.status)) {
      return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    }
    if (before.status !== "GO_NO_GO") {
      return {
        outcome: "CONFLICT",
        code: "TENDER_INVALID_STATUS",
        message: "Odluka o učešću se donosi u statusu „Odluka o učešću“.",
      };
    }

    await client.query(
      `UPDATE public.tenders SET participate = $3, decision_reason = $4,
         decided_by = $5, decided_at = clock_timestamp(), updated_by = $5, updated_at = clock_timestamp()
       WHERE id = $1 AND company_id = $2`,
      [id, actor.companyId, input.participate, reason, actor.userId],
    );

    /* NE: odluka je odustajanje, pa tender ide u `CANCELLED` sa ishodom. Ishod se piše
       OVDJE (ne u odvojenom pozivu) da statistika ne bi imala tender bez razloga. */
    if (!input.participate) {
      await recordOutcomeRow(client, actor, id, {
        result: "CANCELLED",
        lostReason: "OTHER",
        note: reason,
      });
      await client.query(
        `UPDATE public.tenders SET status = 'CANCELLED', updated_by = $3, updated_at = clock_timestamp()
          WHERE id = $1 AND company_id = $2`,
        [id, actor.companyId, actor.userId],
      );
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.decision_recorded",
      entityType: "tender",
      entityId: id,
      metadata: { participate: input.participate },
    });
    return { outcome: "OK", id };
  });
}

/** Upis ishoda (jedan po tenderu). Zajednički za odluku i za `PUT /outcome`. */
async function recordOutcomeRow(
  client: PoolClient,
  actor: TenderActor,
  tenderId: string,
  input: {
    result: "WON" | "LOST" | "WITHDRAWN" | "CANCELLED";
    lostReason?: string | null;
    winnerPartnerId?: string | null;
    winnerValueAmount?: string | null;
    biddersCount?: number | null;
    ourRank?: number | null;
    note?: string | null;
  },
): Promise<void> {
  const existing = await client.query(`SELECT 1 FROM public.tender_outcomes WHERE company_id = $1 AND tender_id = $2`, [
    actor.companyId,
    tenderId,
  ]);
  if ((existing.rowCount ?? 0) > 0) {
    // Ishod je zapis odluke: ne prepisuje se (§1.5/19 — UNIQUE po tenderu).
    return;
  }
  await client.query(
    `INSERT INTO public.tender_outcomes (
       id, company_id, tender_id, result, lost_reason, winner_partner_id,
       winner_value_cents, bidders_count, our_rank, note, recorded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      `toc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      actor.companyId,
      tenderId,
      input.result,
      input.lostReason ?? null,
      input.winnerPartnerId ?? null,
      input.winnerValueAmount ?? null,
      input.biddersCount ?? null,
      input.ourRank ?? null,
      input.note ?? null,
      actor.userId,
    ],
  );
}

export { recordOutcomeRow };
