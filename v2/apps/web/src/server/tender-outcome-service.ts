/**
 * F7 — ishod tendera i uspješnost (spec 08 §1.5).
 *
 * Pravila koja žive OVDJE:
 *
 *  - **Ishod je zapis odluke, jedan po tenderu.** Ne prepisuje se — ako se rezultat sazna
 *    bolje, to je nova informacija, ne ispravka; `UNIQUE (company_id, tender_id)` u bazi to
 *    drži, a servis daje razumljivu poruku umjesto SQL greške.
 *  - **Razlog je obavezan za sve osim dobijenog.** „Izgubili smo“ bez razloga ne mijenja
 *    nijednu buduću odluku, a upravo to je svrha ishoda.
 *  - **Uspješnost je IZRAČUN, ne tabela.** Win rate po broju i po vrijednosti, prosječna
 *    marža dobijenih vs izgubljenih, po naručiocu, i „vrijednost u toku“ (samo otvoreni
 *    statusi). Ništa se ne kešira: broj se računa iz istih redova koje ekran prikazuje.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, toAmountString, type Currency } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { TENDER_OPEN_STATUSES } from "./tender-status";
import type { TenderActor } from "./tender-service";

export type OutcomeError = {
  outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND";
  code?: string;
  message: string;
};

export type TenderOutcomeRow = {
  tenderId: string;
  result: "WON" | "LOST" | "WITHDRAWN" | "CANCELLED";
  lostReason: "PRICE" | "TECHNICAL" | "DOCUMENTATION" | "RELATIONSHIP" | "SCOPE" | "OTHER" | null;
  winnerPartnerId: string | null;
  winnerPartnerName: string | null;
  winnerValueAmount: string | null;
  biddersCount: number | null;
  ourRank: number | null;
  note: string | null;
  recordedAt: string;
};

export type TenderOutcomeInput = {
  result: "WON" | "LOST" | "WITHDRAWN" | "CANCELLED";
  lostReason?: "PRICE" | "TECHNICAL" | "DOCUMENTATION" | "RELATIONSHIP" | "SCOPE" | "OTHER" | null;
  winnerPartnerId?: string | null;
  winnerValueAmount?: string | null;
  biddersCount?: number | null;
  ourRank?: number | null;
  note?: string | null;
};

/**
 * Upis ishoda. `result` mora odgovarati statusu u koji tender ide — inače bi statistika
 * govorila jedno, a lista drugo. Zato servis prima `result` i ne dozvoljava razilaženje sa
 * statusom (provjera je u `changeStatus`, ovdje se samo upisuje).
 */
export async function putTenderOutcome(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: TenderOutcomeInput,
): Promise<{ outcome: "OK"; id: string } | OutcomeError> {
  if (!can(actor.roles, "tenders.outcome.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo upisa ishoda." };
  }
  if (input.result !== "WON" && !input.lostReason) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "TENDER_OUTCOME_REASON_REQUIRED",
      message: "Za svaki ishod osim dobijenog upišite razlog.",
    };
  }
  let winnerValueCents: string | null = null;
  if (input.winnerValueAmount) {
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input.winnerValueAmount.trim())) {
      return { outcome: "VALIDATION_FAILED", message: "Neispravan iznos pobjedničke ponude." };
    }
    const [whole = "0", fraction = ""] = input.winnerValueAmount.trim().split(".");
    winnerValueCents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
  }

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query<{ status: string }>(
      `SELECT status FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [tenderId, actor.companyId],
    );
    if (!tender.rows[0]) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." } as OutcomeError;

    if (input.winnerPartnerId) {
      const partner = await client.query(
        `SELECT 1 FROM public.partners WHERE id = $1 AND company_id = $2`,
        [input.winnerPartnerId, actor.companyId],
      );
      if ((partner.rowCount ?? 0) === 0) {
        return { outcome: "VALIDATION_FAILED", message: "Pobjednik nije partner ove firme." } as OutcomeError;
      }
    }

    const existing = await client.query<{ result: string }>(
      `SELECT result FROM public.tender_outcomes WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, tenderId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].result === input.result) {
        // Isti ishod dvaput = mrežni ponovni zahtjev, ne greška.
        return { outcome: "OK" as const, id: tenderId };
      }
      return {
        outcome: "CONFLICT",
        code: "CONFLICT",
        message: "Ishod je već zapisan i ne mijenja se.",
      } as OutcomeError;
    }

    const id = `toc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.tender_outcomes
         (id, company_id, tender_id, result, lost_reason, winner_partner_id, winner_value_cents,
          bidders_count, our_rank, note, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        actor.companyId,
        tenderId,
        input.result,
        input.lostReason ?? null,
        input.winnerPartnerId ?? null,
        winnerValueCents,
        input.biddersCount ?? null,
        input.ourRank ?? null,
        input.note?.trim() || null,
        actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.outcome_recorded",
      entityType: "tender",
      entityId: tenderId,
      metadata: { result: input.result, lostReason: input.lostReason ?? null },
    });
    return { outcome: "OK" as const, id: tenderId };
  });
}

/**
 * Ishod tendera. `ok: true` razlikuje UČITAN ishod (koji može biti `null`) od greške — bez
 * toga bi `null` i `FORBIDDEN` imali isti oblik i ekran bi prikazao prazno umjesto poruke.
 */
export type TenderOutcomeLookup =
  | { ok: true; outcome: TenderOutcomeRow | null }
  | { ok: false; outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND"; code?: string; message: string };

export async function getTenderOutcome(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<TenderOutcomeLookup> {
  if (!can(actor.roles, "tenders.view")) {
    return { ok: false, outcome: "FORBIDDEN", message: "Nemate pravo pregleda." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
      tenderId,
      actor.companyId,
    ]);
    if ((tender.rowCount ?? 0) === 0) {
      return { ok: false as const, outcome: "NOT_FOUND" as const, message: "Tender nije pronađen." };
    }
    const row = await loadOutcome(client, actor.companyId, tenderId);
    return { ok: true as const, outcome: row };
  });
}

async function loadOutcome(
  client: PoolClient,
  companyId: string,
  tenderId: string,
): Promise<TenderOutcomeRow | null> {
  const result = await client.query(
    `SELECT o.tender_id, o.result, o.lost_reason, o.winner_partner_id, o.winner_value_cents,
            o.bidders_count, o.our_rank, o.note, o.recorded_at,
            p.name AS winner_partner_name, t.currency_code
       FROM public.tender_outcomes o
       JOIN public.tenders t ON t.company_id = o.company_id AND t.id = o.tender_id
       LEFT JOIN public.partners p ON p.company_id = o.company_id AND p.id = o.winner_partner_id
      WHERE o.company_id = $1 AND o.tender_id = $2`,
    [companyId, tenderId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const currency = String(row.currency_code) as Currency;
  return {
    tenderId: String(row.tender_id),
    result: String(row.result) as TenderOutcomeRow["result"],
    lostReason: row.lost_reason == null ? null : (String(row.lost_reason) as TenderOutcomeRow["lostReason"]),
    winnerPartnerId: row.winner_partner_id == null ? null : String(row.winner_partner_id),
    winnerPartnerName: row.winner_partner_name == null ? null : String(row.winner_partner_name),
    winnerValueAmount:
      row.winner_value_cents == null
        ? null
        : toAmountString({ cents: BigInt(String(row.winner_value_cents)), currency }),
    biddersCount: row.bidders_count == null ? null : Number(row.bidders_count),
    ourRank: row.our_rank == null ? null : Number(row.our_rank),
    note: row.note == null ? null : String(row.note),
    recordedAt: new Date(String(row.recorded_at)).toISOString(),
  };
}

/* ------------------------------------------------------------------ uspješnost */

export type TenderPerformance = {
  from: string | null;
  to: string | null;
  totalCount: number;
  wonCount: number;
  lostCount: number;
  winRateByCount: string | null;
  wonValueAmount: string;
  totalValueAmount: string;
  winRateByValue: string | null;
  avgMarginWonPct: string | null;
  avgMarginLostPct: string | null;
  currencyCode: string;
  inProgressValueAmount: string;
  inProgressCount: number;
  byPartner: Array<{
    partnerId: string;
    partnerName: string;
    totalCount: number;
    wonCount: number;
    wonValueAmount: string;
  }>;
};

/**
 * Uspješnost na fiksnom skupu (§5/11): win rate po broju i vrijednosti, prosječne marže
 * dobijenih vs izgubljenih, po naručiocu, „vrijednost u toku“ bez terminalnih statusa.
 *
 * Marža se računa iz ZADNJE revizije cijene (ona je ponuda koja je poslana), a ne iz kolone
 * `markup_pct` na tenderu: kolona je stanje za prikaz, revizija je dokaz šta je poslano.
 */
export async function tenderPerformance(
  pool: Pool,
  actor: TenderActor,
  filter: { from?: string | null; to?: string | null; partnerId?: string | null } = {},
): Promise<TenderPerformance | OutcomeError> {
  if (!can(actor.roles, "tenders.view")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo pregleda." };
  }
  const from = filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from) ? filter.from : null;
  const to = filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? filter.to : null;

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const company = await client.query<{ currency: string }>(
      `SELECT currency FROM public.companies WHERE id = $1`,
      [actor.companyId],
    );
    const currency = (company.rows[0]?.currency ?? "BAM") as Currency;
    const safeCurrency = isCurrency(currency) ? currency : "BAM";
    const includeMargin = can(actor.roles, "tenders.price.manage");

    const rows = await client.query<{
      status: string;
      submitted_value_cents: string;
      partner_id: string;
      partner_name: string;
      markup_pct: string | null;
    }>(
      `SELECT t.status, t.submitted_value_cents::text, t.partner_id, p.name AS partner_name,
              (SELECT r.markup_pct::text FROM public.tender_price_revisions r
                WHERE r.company_id = t.company_id AND r.tender_id = t.id
                ORDER BY r.revision DESC LIMIT 1) AS markup_pct
         FROM public.tenders t
         JOIN public.partners p ON p.company_id = t.company_id AND p.id = t.partner_id
        WHERE t.company_id = $1
          AND ($2::date IS NULL OR (t.created_at AT TIME ZONE 'Europe/Sarajevo')::date >= $2::date)
          AND ($3::date IS NULL OR (t.created_at AT TIME ZONE 'Europe/Sarajevo')::date <= $3::date)
          AND ($4::text IS NULL OR t.partner_id = $4)`,
      [actor.companyId, from, to, filter.partnerId ?? null],
    );

    let wonCount = 0;
    let lostCount = 0;
    let wonValue = 0n;
    let totalValue = 0n;
    let inProgressValue = 0n;
    let inProgressCount = 0;
    const marginWon: bigint[] = [];
    const marginLost: bigint[] = [];
    const byPartner = new Map<string, { partnerName: string; totalCount: number; wonCount: number; wonValue: bigint }>();

    for (const row of rows.rows) {
      const value = BigInt(row.submitted_value_cents);
      const decided = ["WON", "LOST"].includes(row.status);
      if (decided) {
        totalValue += value;
        if (row.status === "WON") {
          wonCount += 1;
          wonValue += value;
        } else {
          lostCount += 1;
        }
      }
      if ((TENDER_OPEN_STATUSES as readonly string[]).includes(row.status)) {
        inProgressCount += 1;
        inProgressValue += value;
      }
      const partnerEntry =
        byPartner.get(row.partner_id) ??
        { partnerName: row.partner_name, totalCount: 0, wonCount: 0, wonValue: 0n };
      if (decided) {
        partnerEntry.totalCount += 1;
        if (row.status === "WON") {
          partnerEntry.wonCount += 1;
          partnerEntry.wonValue += value;
        }
      }
      byPartner.set(row.partner_id, partnerEntry);

      // Marža: `markup_pct` je postotak u stotim dijelovima (`parsePercent`).
      if (includeMargin && decided && row.markup_pct != null) {
        const hundredths = parsePercentLocal(row.markup_pct);
        if (hundredths !== null) {
          if (row.status === "WON") marginWon.push(hundredths);
          else marginLost.push(hundredths);
        }
      }
    }

    const decidedRows = rows.rows.filter((row) => ["WON", "LOST"].includes(row.status));
    const ratio = (numerator: number, denominator: number): string | null =>
      denominator === 0 ? null : ((numerator / denominator) * 100).toFixed(2);

    const average = (values: bigint[]): string | null => {
      if (values.length === 0) return null;
      const total = values.reduce((acc, item) => acc + item, 0n);
      const avgHundredths = total / BigInt(values.length);
      return `${avgHundredths / 100n}.${(avgHundredths % 100n).toString().padStart(2, "0")}`;
    };

    return {
      from,
      to,
      totalCount: decidedRows.length,
      wonCount,
      lostCount,
      winRateByCount: ratio(wonCount, decidedRows.length),
      wonValueAmount: toAmountString({ cents: wonValue, currency: safeCurrency }),
      totalValueAmount: toAmountString({ cents: totalValue, currency: safeCurrency }),
      winRateByValue:
        totalValue === 0n
          ? null
          : `${((Number(wonValue) / Number(totalValue)) * 100).toFixed(2)}`,
      avgMarginWonPct: average(marginWon),
      avgMarginLostPct: average(marginLost),
      currencyCode: safeCurrency,
      inProgressValueAmount: toAmountString({ cents: inProgressValue, currency: safeCurrency }),
      inProgressCount,
      byPartner: [...byPartner.entries()].map(([partnerId, entry]) => ({
        partnerId,
        partnerName: entry.partnerName,
        totalCount: entry.totalCount,
        wonCount: entry.wonCount,
        wonValueAmount: toAmountString({ cents: entry.wonValue, currency: safeCurrency }),
      })),
    };
  });
}

/** `"12.50"` → `1250n`; `null` kad oblik nije postotak sa dvije decimale. */
function parsePercentLocal(value: string): bigint | null {
  const text = value.trim();
  if (!/^-?\d{1,4}(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -hundredths : hundredths;
}
