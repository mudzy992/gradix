/**
 * `notifications.deliver` — kanali POSLIJE in-app reda.
 *
 * In-app je već upisan u trenutku `notify()` (to je red u `notifications`). Ovaj posao radi
 * ono što traži vanjski svijet:
 *
 *   - **EMAIL**: bez SMTP-a → `BLOCKED_NO_PROVIDER`. Poruka OSTAJE u inboxu; kad SMTP proradi,
 *     isti posao šalje zaostatke. Nikad ne brišemo poruku zato što je kanal nedostupan.
 *   - **PUSH**: bez Expo tokena → `BLOCKED_NO_PROVIDER`; sa tokenom, `PENDING` i dalje čeka
 *     adapter (Faza 1, Modul 12 §27).
 *
 * Posao je idempotentan: `(notification_id, channel)` je unikatan, pa ponovni prolaz ne
 * pravi dupli red isporuke.
 */
import type { Pool } from "pg";
import type { JobLogger } from "./jobs";

export type DeliveryOutcome = {
  processed: number;
  sent: number;
  blocked: number;
  skipped: number;
};

/**
 * Da li SMTP postoji. Faza 0 ga NEMA (spec 01: `BLOCKED_NO_PROVIDER`), pa je ovo jedini
 * razlog zašto email isporuke danas završe kao `BLOCKED_NO_PROVIDER`, a ne `FAILED` —
 * razlika je bitna: `FAILED` znači „pokušali smo i nije uspjelo“, a to nije istina.
 */
export function smtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SMTP_HOST?.trim() && env.SMTP_FROM?.trim());
}

export function pushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.EXPO_ACCESS_TOKEN?.trim());
}

/**
 * Upisuje red isporuke za svako obavještenje koje još nema svoj red na tom kanalu.
 * `cap` ograničava jedan prolaz da posao ne drži konekciju minutama.
 */
export async function deliverNotifications(
  pool: Pool,
  options: { companyId: string; logger: JobLogger; cap?: number; env?: NodeJS.ProcessEnv },
): Promise<DeliveryOutcome> {
  const cap = options.cap ?? 200;
  const env = options.env ?? process.env;
  const emailOk = smtpConfigured(env);
  const pushOk = pushConfigured(env);
  const outcome: DeliveryOutcome = { processed: 0, sent: 0, blocked: 0, skipped: 0 };

  // Postavljamo tenant ručno: `withCompany` otvara transakciju po firmi, a ovdje je jedna
  // firma po poslu (worker nikad ne miješa firme u jednom pozivu).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [options.companyId]);

    const pending = await client.query<{ id: string; user_id: string | null; kind: string; dedupe_key: string | null }>(
      `SELECT n.id, n.user_id, n.kind, n.dedupe_key
         FROM public.notifications n
        WHERE n.company_id = $1
        ORDER BY n.created_at
        LIMIT $2`,
      [options.companyId, cap],
    );

    for (const row of pending.rows) {
      outcome.processed += 1;
      for (const channel of ["EMAIL", "PUSH"] as const) {
        // Scheduled report owns its EMAIL delivery and attachment; the generic adapter must
        // not create or retry it, particularly when the SMTP outcome is ambiguous.
        if (channel === "EMAIL" && row.kind === "report.ready" && row.dedupe_key?.startsWith("monthly-report:")) continue;
        const configured = channel === "EMAIL" ? emailOk : pushOk;
        if (!configured) {
          const inserted = await client.query(
            `INSERT INTO public.notification_deliveries
               (id, company_id, notification_id, channel, status, attempts, last_error)
             VALUES ('ntd_' || substr(md5(random()::text || $1), 1, 16), $2, $1, $3,
                     'BLOCKED_NO_PROVIDER', 0, $4)
             ON CONFLICT (notification_id, channel) DO NOTHING`,
            [
              row.id,
              options.companyId,
              channel,
              channel === "EMAIL" ? "SMTP nije podešen." : "Push nije podešen.",
            ],
          );
          outcome.blocked += inserted.rowCount ?? 0;
        } else {
          // Adapter za SMTP/Expo dolazi u Modulu 12; do tada je status PENDING, ne lažni SENT.
          const inserted = await client.query(
            `INSERT INTO public.notification_deliveries
               (id, company_id, notification_id, channel, status, attempts)
             VALUES ('ntd_' || substr(md5(random()::text || $1), 1, 16), $2, $1, $3, 'PENDING', 0)
             ON CONFLICT (notification_id, channel) DO NOTHING`,
            [row.id, options.companyId, channel],
          );
          outcome.skipped += inserted.rowCount ?? 0;
        }
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  options.logger.info("notifications.deliver", { ...outcome });
  return outcome;
}
