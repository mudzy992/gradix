/**
 * `reminders.scan` — dnevni prolaz kroz rokove (spec 02 §24).
 *
 * Pravilo: **jedno obavještenje po obavezi i pragu**, nikad po prolazu posla. Posao ide svakih
 * 15 minuta, pa bi bez deduplikacije isti ljekarski poslao 4 podsjetnika na sat — i korisnik bi
 * isključio obavještenja, a to je gore od nepostojećih.
 *
 * Dedupe ključ je `{obligationId}:{daysLeft}`, a eskalacija dodaje `:esc`. Zato:
 *   - 60 dana → `obl_x:60` (jednom),
 *   - sutra isto stanje → ključ je ISTI, ne šalje se ponovo,
 *   - treći dan → `obl_x:58`, novi ključ, novo obavještenje.
 *
 * Eskalacija (§24): kad `daysLeft <= 3` i obaveza nije riješena, obavještenje ide na OWNER s
 * `:esc` sufiksom — odvojen ključ jer je to DRUGA poruka istog dana, namijenjena drugoj osobi.
 *
 * Vremenska zona: "dnevni prolaz u 06:00 u zoni firme" ne znači da posao gleda sat. Posao ide
 * svakih 15 minuta i pusti firmu SAMO ako je u njenoj zoni između 06:00 i 06:59 — jeftino, bez
 * rasporeda po firmi u pg-boss-u.
 */
import type { Pool, PoolClient } from "pg";
import {
  effectiveThresholds,
  obligationState,
  parseThresholds,
  type ObligationState,
} from "@gradix/domain";
import type { JobLogger } from "./jobs";

export type ReminderOutcome = {
  companiesScanned: number;
  companiesSkipped: number;
  notificationsCreated: number;
  escalations: number;
  /** Obaveze koje su preskočene jer već imaju obavještenje za taj prag. */
  deduped: number;
};

type CompanyRow = { id: string; timezone: string | null; name: string };

type ObligationRow = {
  id: string;
  type_id: string;
  type_label: string;
  type_code: string;
  entity_kind: string;
  worker_id: string | null;
  machine_id: string | null;
  project_id: string | null;
  worker_first: string | null;
  worker_last: string | null;
  worker_user_id: string | null;
  machine_code: string | null;
  machine_name: string | null;
  project_code: string | null;
  project_name: string | null;
  expires_at: string | null;
  review_at: string | null;
  review_state: string;
  reminder_days: string;
  default_reminder_days: string;
  responsible_user_id: string | null;
};

/**
 * Poslovni sat u zoni firmy. `Intl.DateTimeFormat` sa `hourCycle: 'h23'` daje „00“–„23“;
 * `hour12: false` u nekim ICU verzijama vraća „24“ za ponoć, pa se ne koristi.
 */
export function localHour(timezone: string, now: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const value = Number(formatter.format(now));
  return Number.isFinite(value) ? value : 0;
}

export function localDate(timezone: string, now: Date): string {
  // `en-CA` daje `YYYY-MM-DD` bez ručnog sklapanja dijelova.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Timezone iz baze može biti neispravna; `UTC` je siguran izbor, ali se prijavljuje. */
function safeTimezoneOrNull(timezone: string | null): string | null {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

async function pendingReminders(
  client: PoolClient,
  companyId: string,
): Promise<ObligationRow[]> {
  const result = await client.query<ObligationRow>(
    `SELECT o.id, o.type_id, t.label AS type_label, t.code AS type_code, t.entity_kind,
            o.worker_id, o.machine_id, o.project_id,
            w.first_name AS worker_first, w.last_name AS worker_last, w.user_id AS worker_user_id,
            m.code AS machine_code, m.name AS machine_name,
            p.code AS project_code, p.name AS project_name,
            to_char(o.expires_at, 'YYYY-MM-DD') AS expires_at,
            to_char(o.review_at, 'YYYY-MM-DD') AS review_at,
            o.review_state, o.responsible_user_id,
            COALESCE(o.reminder_days, t.default_reminder_days)::text AS reminder_days,
            t.default_reminder_days::text AS default_reminder_days
       FROM obligations o
       JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
       LEFT JOIN workers w ON w.company_id = o.company_id AND w.id = o.worker_id
       LEFT JOIN machines m ON m.company_id = o.company_id AND m.id = o.machine_id
       LEFT JOIN projects p ON p.company_id = o.company_id AND p.id = o.project_id
      WHERE o.company_id = $1
        AND o.superseded_by IS NULL
        AND t.is_active
        -- Zamijenjene i već odbijene obaveze ne dobijaju „podsjetnik na istek“: za odbijenu
        -- dokument se šalje ponovo, a ne podsjeća na datum.
        AND o.review_state <> 'rejected'
        AND (o.expires_at IS NOT NULL OR o.review_at IS NOT NULL)`,
    [companyId],
  );
  return result.rows;
}

/** Kome ide obavještenje za ovaj tip. Prazno = zadane role iz §24. */
async function notifyTargets(
  client: PoolClient,
  companyId: string,
  typeId: string,
): Promise<{ userIds: string[]; roles: string[] }> {
  const configured = await client.query<{ role: string }>(
    "SELECT role FROM obligation_notify_roles WHERE company_id = $1 AND type_id = $2",
    [companyId, typeId],
  );
  if (configured.rowCount && configured.rowCount > 0) {
    return { userIds: [], roles: configured.rows.map((row) => String(row.role)) };
  }
  // Zadano iz speca: odgovorni + ured. Radnik koji je nosilac dobija obavještenje kroz
  // `user_id` (vidi `insertNotification`), pa nije u roli.
  return { userIds: [], roles: ["ADMIN", "PROJECT_MANAGER"] };
}

function entityLabel(row: ObligationRow): string {
  if (row.worker_first || row.worker_last) {
    return `${row.worker_first ?? ""} ${row.worker_last ?? ""}`.trim();
  }
  if (row.machine_code) return `${row.machine_code} — ${row.machine_name ?? ""}`.trim();
  if (row.project_code) return `${row.project_code} — ${row.project_name ?? ""}`.trim();
  return "firma";
}

/**
 * Upisuje obavještenje. `ON CONFLICT DO NOTHING` na `(company_id, dedupe_key)` je deduplikacija:
 * posao je idempotentan i može se ponavljati koliko hoće.
 */
async function insertNotification(
  client: PoolClient,
  params: {
    companyId: string;
    userId: string | null;
    roleTarget: string | null;
    kind: string;
    title: string;
    body: string;
    href: string;
    severity: "INFO" | "WARN" | "CRITICAL";
    sourceType: string;
    sourceId: string;
    dedupeKey: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO notifications
       (id, company_id, user_id, role_target, kind, title, body, href, severity,
        source_type, source_id, dedupe_key)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (company_id, dedupe_key) DO NOTHING`,
    [
      params.companyId,
      params.userId,
      params.roleTarget,
      params.kind,
      params.title,
      params.body,
      params.href,
      params.severity,
      params.sourceType,
      params.sourceId,
      params.dedupeKey,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Jedan prolaz za sve firme. Firma se preskače ako u njenoj zoni nije 06 h — osim kad je
 * `forceToday` postavljen (ručno pokretanje i testovi).
 */
export async function scanReminders(
  pool: Pool,
  options: { logger: JobLogger; now?: Date; force?: boolean; onlyCompanyId?: string },
): Promise<ReminderOutcome> {
  const now = options.now ?? new Date();
  const outcome: ReminderOutcome = {
    companiesScanned: 0,
    companiesSkipped: 0,
    notificationsCreated: 0,
    escalations: 0,
    deduped: 0,
  };

  const companies = await pool.query<CompanyRow>(
    `SELECT id, timezone, name FROM companies
      WHERE ($1::text IS NULL OR id = $1)`,
    [options.onlyCompanyId ?? null],
  );

  for (const company of companies.rows) {
    const timezone = safeTimezoneOrNull(company.timezone);
    if (timezone === null) {
      // Loša zona nije razlog da firma ne dobije podsjetnike — ide UTC, ali se vidi u logu.
      options.logger.warn("reminders.scan: neispravna vremenska zona, koristi se UTC", {
        companyId: company.id,
        timezone: company.timezone,
      });
    }
    const zone = timezone ?? "UTC";

    if (!options.force && localHour(zone, now) !== 6) {
      outcome.companiesSkipped += 1;
      continue;
    }

    const today = localDate(zone, now);
    outcome.companiesScanned += 1;

    // `withCompany` postavlja `app.company_id`; RLS je uključen i nad ovim tabelama.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.company_id', $1, true)", [company.id]);

      const rows = await pendingReminders(client, company.id);
      for (const row of rows) {
        const thresholds = effectiveThresholds(
          parseThresholds(row.reminder_days),
          parseThresholds(row.default_reminder_days),
        );
        const state: ObligationState = obligationState({
          expiresAt: row.expires_at,
          reviewAt: row.review_at,
          reviewState: row.review_state as "none" | "pending_review" | "rejected",
          thresholds,
          today,
        });

        // Samo `expiring` i `review_due` šalju „podsjetnik na rok“. `expired` šalje DRUGU
        // poruku (vidi granu niže), a `valid`/`no_expiry` ne šalju ništa.
        if (state !== "expiring" && state !== "review_due") {
          if (state === "expired") {
            const created = await notifyExpired(client, company.id, row, today);
            outcome.notificationsCreated += created ? 1 : 0;
            outcome.deduped += created ? 0 : 1;
          }
          continue;
        }

        const reference = row.expires_at ?? row.review_at!;
        const daysLeft = Math.round(
          (Date.parse(`${reference}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
        );
        const targets = await notifyTargets(client, company.id, row.type_id);
        const label = entityLabel(row);
        const title =
          state === "review_due"
            ? `Provjera dospjela: ${row.type_label}`
            : `${row.type_label} istječe za ${daysLeft} ${daysWord(daysLeft)}`;
        const body = `${label} · rok ${reference}`;
        const href = `/rokovi/${row.id}`;
        const severity = daysLeft <= 3 ? "CRITICAL" : daysLeft <= 15 ? "WARN" : "INFO";

        // Nosilac obaveze (radnik s nalogom) dobija SVOJE obavještenje: §24 traži da radnik
        // zna prije nego što mu se kaže na gradilištu.
        const recipients: Array<{ userId: string | null; roleTarget: string | null; suffix: string }> = [];
        if (row.worker_user_id) {
          recipients.push({ userId: row.worker_user_id, roleTarget: null, suffix: ":self" });
        }
        if (row.responsible_user_id) {
          recipients.push({ userId: row.responsible_user_id, roleTarget: null, suffix: ":resp" });
        }
        for (const role of targets.roles) {
          recipients.push({ userId: null, roleTarget: role, suffix: `:role:${role}` });
        }

        for (const recipient of recipients) {
          const created = await insertNotification(client, {
            companyId: company.id,
            userId: recipient.userId,
            roleTarget: recipient.roleTarget,
            kind: "OBLIGATION_EXPIRING",
            title,
            body,
            href,
            severity,
            sourceType: "obligation",
            sourceId: row.id,
            // Ključ: obaveza + prag + primalac. Bez primaoca bi prvi upis po firmi pojeo
            // obavještenja za sve ostale (dedupe je po firmi, ne po korisniku).
            dedupeKey: `${row.id}:${daysLeft}${recipient.suffix}`,
          });
          if (created) outcome.notificationsCreated += 1;
          else outcome.deduped += 1;
        }

        // Eskalacija: ≤ 3 dana i nije riješeno → OWNER, odvojen ključ (`:esc`).
        if (daysLeft <= 3) {
          const escalated = await insertNotification(client, {
            companyId: company.id,
            userId: null,
            roleTarget: "OWNER",
            kind: "OBLIGATION_ESCALATION",
            title: `Eskalacija: ${row.type_label} — ${label}`,
            body: `Rok ${reference} (${daysLeft} ${daysWord(daysLeft)}). Obaveza nije obnovljena.`,
            href,
            severity: "CRITICAL",
            sourceType: "obligation",
            sourceId: row.id,
            dedupeKey: `${row.id}:${daysLeft}:esc`,
          });
          if (escalated) {
            outcome.notificationsCreated += 1;
            outcome.escalations += 1;
          }
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Greška u jednoj firmi ne smije zaustaviti ostale: firma bez baze je jedan problem,
      // a prekid cijelog prolaza je sto firmi bez podsjetnika.
      options.logger.error("reminders.scan: firma preskočena zbog greške", {
        companyId: company.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.release();
    }
  }

  options.logger.info("reminders.scan gotov", { ...outcome });
  return outcome;
}

/** Istekla obaveza: jedna poruka po obavezi, ne po danu — inače bi 30 dana slala 30 puta. */
async function notifyExpired(
  client: PoolClient,
  companyId: string,
  row: ObligationRow,
  today: string,
): Promise<boolean> {
  const label = entityLabel(row);
  return insertNotification(client, {
    companyId,
    userId: row.responsible_user_id,
    roleTarget: row.responsible_user_id ? null : "ADMIN",
    kind: "OBLIGATION_EXPIRED",
    title: `Isteklo: ${row.type_label}`,
    body: `${label} · rok ${row.expires_at ?? row.review_at}`,
    href: `/rokovi/${row.id}`,
    severity: "CRITICAL",
    sourceType: "obligation",
    sourceId: row.id,
    // Bez `daysLeft`: isteklo je stanje, a ne prag — jedan ključ po obavezi i danu isteka.
    dedupeKey: `${row.id}:expired:${row.expires_at ?? row.review_at ?? today}`,
  });
}

/** „1 dan“ / „2 dana“ / „5 dana“ — bosanski množinski oblici za brojeve u poruci. */
export function daysWord(days: number): string {
  const absolute = Math.abs(days);
  if (absolute % 10 === 1 && absolute % 100 !== 11) return "dan";
  return "dana";
}
