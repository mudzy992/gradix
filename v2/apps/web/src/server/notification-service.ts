/**
 * F0.4 — JEDAN ulaz za obavještenja: `notify()`.
 *
 * Pravila iz spec 12 §1.2, i zašto baš tako:
 *
 *  1. **In-app je obavezan kanal.** Radi bez SMTP-a i bez push tokena; ako njega nema, poruka
 *     nestaje. Zato `notification_preferences.in_app` ima CHECK koji ga drži na `true`.
 *  2. **`dedupe_key` je jedan po STVARI, ne po prolazu posla.** Posao `reminders.scan` ide svakih
 *     15 minuta; bez dedupe-a bi ista obaveza napravila 96 poruka dnevno i korisnik bi ugasio
 *     zvonce. Unikatan indeks je u bazi, ne u kodu — dva workera ne mogu oba upisati istu stvar.
 *  3. **`href` je obavezan** (`LIKE '/%'`): obavještenje bez linka je slijepa ulica.
 *  4. **Email bez provajdera ne gubi poruku** — `notification_deliveries` dobija
 *     `BLOCKED_NO_PROVIDER`, a red u inboxu ostaje. Kad SMTP proradi, isti posao pošalje zaostatke.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";

export const NOTIFICATION_KINDS = [
  "obligation.expiring",
  "obligation.escalation",
  "budget.threshold",
  "attachment.quarantined",
  "report.ready",
  "export.ready",
  "system",
  // F3: radnik dobija ishod razrješenja sukoba bez otvaranja aplikacije (spec 03 §1.6.31).
  "workday.conflict_resolved",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SEVERITIES = ["INFO", "WARN", "CRITICAL"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export type NotificationInput = {
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Putanja u aplikaciji, npr. `/ured/rokovi?state=expired`. */
  href: string;
  severity?: NotificationSeverity;
  /** Tačno jedna od dvije: osoba ili svi s rolom. */
  userId?: string | null;
  roleTarget?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  /** Jedinstven po stvari: `obligation:obl_1:7`. Bez njega nema obavještenja. */
  dedupeKey: string;
};

export type NotifyOutcome =
  | { outcome: "CREATED"; id: string }
  | { outcome: "DUPLICATE"; id: string | null }
  | { outcome: "VALIDATION_FAILED"; message: string };

/**
 * Upis obavještenja. Idempotentno: isti `dedupe_key` drugi put vraća `DUPLICATE`, ne grešku —
 * posao koji se ponavlja poslije pada ne smije puniti inbox.
 */
export async function notify(
  db: Pool | PoolClient,
  companyId: string,
  input: NotificationInput,
): Promise<NotifyOutcome> {
  if (!input.userId && !input.roleTarget) {
    return { outcome: "VALIDATION_FAILED", message: "Obavještenje mora imati primaoca." };
  }
  if (!input.href.startsWith("/")) {
    return { outcome: "VALIDATION_FAILED", message: "Obavještenje mora imati putanju u aplikaciji." };
  }
  // Unutar transakcije pozivalac predaje `PoolClient`; inače otvaramo svoj kontekst.
  if (typeof (db as PoolClient).release === "function") {
    return insertNotification(db as PoolClient, companyId, input);
  }
  return withCompany(db as Pool, toCompanyId(companyId), (client) =>
    insertNotification(client, companyId, input),
  );
}

async function insertNotification(
  client: PoolClient,
  companyId: string,
  input: NotificationInput,
): Promise<NotifyOutcome> {
  const id = `ntf_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO public.notifications
       (id, company_id, user_id, role_target, kind, title, body, href, severity,
        source_type, source_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (company_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [
      id, companyId, input.userId ?? null, input.roleTarget ?? null, input.kind,
      input.title, input.body ?? "", input.href, input.severity ?? "INFO",
      input.sourceType ?? null, input.sourceId ?? null, input.dedupeKey,
    ],
  );
  if (inserted.rowCount === 0) {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM public.notifications WHERE company_id = $1 AND dedupe_key = $2",
      [companyId, input.dedupeKey],
    );
    return { outcome: "DUPLICATE", id: existing.rows[0]?.id ?? null };
  }

  // In-app isporuka je uvijek SENT: red u `notifications` JE in-app kanal.
  await client.query(
    `INSERT INTO public.notification_deliveries
       (id, company_id, notification_id, channel, status, attempts, sent_at)
     VALUES ($1,$2,$3,'IN_APP','SENT',1,now())
     ON CONFLICT (notification_id, channel) DO NOTHING`,
    [`ntd_${randomUUID().replace(/-/g, "").slice(0, 16)}`, companyId, id],
  );
  return { outcome: "CREATED", id };
}

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  severity: NotificationSeverity;
  createdAt: string;
  readAt: string | null;
};

const toRow = (row: Record<string, unknown>): NotificationRow => ({
  id: String(row.id),
  kind: String(row.kind),
  title: String(row.title),
  body: String(row.body),
  href: String(row.href),
  severity: String(row.severity) as NotificationSeverity,
  createdAt: new Date(row.created_at as string).toISOString(),
  readAt: row.read_at ? new Date(row.read_at as string).toISOString() : null,
});

/**
 * Inbox jedne osobe: njena lična obavještenja + ona za njene role.
 *
 * `role_target` je namjerno podržan: bez njega bi „obavijesti sve šefove“ značilo kopiju po
 * osobi, pa bi novi šef propustio sve što je poslano prije nego što je dobio rolu.
 */
export async function listNotifications(
  pool: Pool,
  input: { companyId: string; userId: string; roles: readonly string[]; unreadOnly?: boolean; limit?: number },
): Promise<NotificationRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  return withCompany(pool, toCompanyId(input.companyId), async (client) => {
    const rows = await client.query(
      `SELECT id, kind, title, body, href, severity, created_at, read_at
         FROM public.notifications
        WHERE company_id = $1
          AND (user_id = $2 OR (user_id IS NULL AND role_target = ANY($3)))
          AND ($4::boolean IS FALSE OR read_at IS NULL)
        ORDER BY created_at DESC
        LIMIT $5`,
      [input.companyId, input.userId, input.roles, input.unreadOnly ?? false, limit],
    );
    return rows.rows.map((row) => toRow(row as Record<string, unknown>));
  });
}

/** Broj neproučenih — zvonce u shellu. Jedan `count`, ne lista. */
export async function unreadCount(
  pool: Pool,
  input: { companyId: string; userId: string; roles: readonly string[] },
): Promise<number> {
  return withCompany(pool, toCompanyId(input.companyId), async (client) => {
    const row = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.notifications
        WHERE company_id = $1 AND read_at IS NULL
          AND (user_id = $2 OR (user_id IS NULL AND role_target = ANY($3)))`,
      [input.companyId, input.userId, input.roles],
    );
    return Number(row.rows[0]?.n ?? 0);
  });
}

/**
 * Označi kao pročitano. Tuđe obavještenje se NE može označiti: `user_id` mora biti moj ILI
 * `role_target` u mojim rolama — inače bi jedan korisnik mogao „počistiti“ inbox drugome.
 */
export async function markRead(
  pool: Pool,
  input: { companyId: string; userId: string; roles: readonly string[]; notificationId?: string; all?: boolean },
): Promise<number> {
  return withCompany(pool, toCompanyId(input.companyId), async (client) => {
    const target = input.notificationId ?? null;
    const result = await client.query(
      `UPDATE public.notifications SET read_at = now()
        WHERE company_id = $1 AND read_at IS NULL
          AND (user_id = $2 OR (user_id IS NULL AND role_target = ANY($3)))
          AND ($4::text IS NULL OR id = $4)`,
      [input.companyId, input.userId, input.roles, target],
    );
    return result.rowCount ?? 0;
  });
}

/**
 * Retencija (spec 12 §12): pročitana 90 dana, nepročitana 1 godina, `CRITICAL` 2 godine.
 * Briše worker svojom konekcijom — `gradix_app` nema `DELETE` na tabeli, i to je namjerno.
 */
export const NOTIFICATION_RETENTION_SQL = `
  DELETE FROM public.notifications
   WHERE (severity <> 'CRITICAL' AND read_at IS NOT NULL AND read_at < now() - interval '90 days')
      OR (severity <> 'CRITICAL' AND read_at IS NULL AND created_at < now() - interval '1 year')
      OR (severity = 'CRITICAL' AND created_at < now() - interval '2 years')
`;
