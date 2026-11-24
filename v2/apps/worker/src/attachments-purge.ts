/**
 * `attachments.purge` — retencija priloga (spec 02 §29).
 *
 * Dvije retencije, jer dvije vrste podataka:
 *   - **osjetljivo** (`obligation_types.sensitive`, npr. medicinski nalaz): 24 mjeseca od
 *     `workers.ended_at` — ne od uploada. Dok je radnik zaposlen, nalaz je aktuelan dokaz;
 *     kad ode, prestaje potreba i počinje rok koji zakon traži da se čuva.
 *   - **neosjetljivo** (registracija, ovlaštenje): 10 godina od nastanka.
 *
 * Pravilo brisanja: prvo red u bucketu, pa red u bazi. Obrnuto bi ostavilo objekat bez
 * pokazivača — smeće koje se ne vidi i ne briše (isti razlog zašto prilog ima `pending` status).
 *
 * Audit: `attachment.retention_purged` se piše BEZ sadržaja i BEZ imena fajla gdje nije nužno —
 * trag treba da kaže „obrisano po retenciji“, ne da reprodukuje dokument koji je trebalo nestati.
 */
import type { Pool, PoolClient } from "pg";
import type { JobLogger } from "./jobs";

export type PurgeCandidate = {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  object_key: string;
  sensitive: boolean;
  retention_basis: string;
};

export type PurgeOutcome = {
  candidates: number;
  purged: number;
  failed: number;
  /** Prilozi koji su `pending` duže od 24 h — upload koji nikad nije potvrđen. */
  staleDropped: number;
};

/** Kolekcija u bucketu; brisanje ide kroz isti klijent kao upload (§27). */
export type ObjectRemover = (objectKey: string) => Promise<void>;

/**
 * Prilozi koji su prešli retenciju.
 *
 * `sensitive` dolazi iz TIPA obaveze, ne iz priloga: osjetljivost je osobina dokumenta
 * (ljekarski nalaz), a ne fajla — isti PDF može biti i jedno i drugo, ali ga tip određuje.
 */
export async function findPurgeCandidates(
  client: PoolClient,
  companyId: string,
  today: string,
  limit = 500,
): Promise<PurgeCandidate[]> {
  const result = await client.query<PurgeCandidate>(
    `SELECT a.id, a.company_id, a.entity_type, a.entity_id, a.object_key,
            COALESCE(t.sensitive, false) AS sensitive,
            CASE
              WHEN COALESCE(t.sensitive, false) THEN 'SENSITIVE_24M'
              ELSE 'STANDARD_10Y'
            END AS retention_basis
       FROM attachments a
       LEFT JOIN obligation_types t
         ON a.entity_type = 'OBLIGATION'
        AND t.company_id = a.company_id
        AND t.id = (SELECT o.type_id FROM obligations o
                     WHERE o.company_id = a.company_id AND o.id = a.entity_id)
       LEFT JOIN obligations o
         ON a.entity_type = 'OBLIGATION' AND o.company_id = a.company_id AND o.id = a.entity_id
       -- workers.ended_at je datum prestanka radnog odnosa; za prilog vezan na masinu ili
       -- projekat w je NULL, pa osjetljiv prilog bez radnika nikad ne ispuni uslov i ostaje.
       LEFT JOIN workers w
         ON o.worker_id IS NOT NULL AND w.company_id = o.company_id AND w.id = o.worker_id
      WHERE a.company_id = $1
        AND a.status = 'ready'
        AND (
          -- Osjetljivo: 24 mjeseca od prestanka radnog odnosa.
          (COALESCE(t.sensitive, false)
            AND w.ended_at IS NOT NULL
            AND w.ended_at < ($2::date - INTERVAL '24 months'))
          OR
          -- Neosjetljivo: 10 godina od nastanka.
          (NOT COALESCE(t.sensitive, false)
            AND a.created_at < ($2::date - INTERVAL '10 years'))
        )
      ORDER BY a.created_at
      LIMIT $3`,
    [companyId, today, limit],
  );
  return result.rows;
}

/**
 * Prolaz. `removeObject` je injektovan (S3 u produkciji, lažni u testu) — posao ne zna gdje
 * su fajlovi, a test ne treba bucket.
 */
export async function purgeAttachments(
  pool: Pool,
  options: { logger: JobLogger; removeObject: ObjectRemover; today?: string; onlyCompanyId?: string },
): Promise<PurgeOutcome> {
  const outcome: PurgeOutcome = { candidates: 0, purged: 0, failed: 0, staleDropped: 0 };

  const companies = await pool.query<{ id: string; timezone: string | null }>(
    "SELECT id, timezone FROM companies WHERE ($1::text IS NULL OR id = $1)",
    [options.onlyCompanyId ?? null],
  );

  for (const company of companies.rows) {
    const today = options.today ?? formatToday(company.timezone);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.company_id', $1, true)", [company.id]);

      const candidates = await findPurgeCandidates(client, company.id, today);
      outcome.candidates += candidates.length;

      for (const candidate of candidates) {
        try {
          // Bucket prvi: ako brisanje objekta padne, red u bazi OSTAJE i posao će ga probati
          // ponovo. Obrnut redoslijed bi ostavio objekat bez pokazivača — smeće zauvijek.
          await options.removeObject(candidate.object_key);
          await client.query(
            `UPDATE attachments SET status = 'deleted', deleted_at = now()
              WHERE company_id = $1 AND id = $2`,
            [company.id, candidate.id],
          );
          await client.query(
            `INSERT INTO audit_events
               (id, company_id, actor_id, actor_email, actor_role, action, entity_type, entity_id,
                metadata, retention_class)
             VALUES (gen_random_uuid()::text, $1, NULL, NULL, NULL,
                     'attachment.retention_purged', 'attachment', $2, $3::jsonb, 'ACCESS')`,
            [
              company.id,
              candidate.id,
              JSON.stringify({
                basis: candidate.retention_basis,
                // Namjerno BEZ imena fajla i bez `entity_id`: trag ne smije reći čiji je bio
                // medicinski nalaz — to je podatak koji je trebalo prestati postojati.
                entityType: candidate.entity_type,
              }),
            ],
          );
          outcome.purged += 1;
        } catch (error) {
          outcome.failed += 1;
          options.logger.warn("attachments.purge: prilog nije obrisan", {
            attachmentId: candidate.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      /*
       * `pending` prilozi stariji od 24 h: upload je počeo i nikad nije potvrđen (prekinut
       * zahtjev, zatvoren tab). Objekat postoji u bucketu, ali red nikad nije postao `ready`.
       * Briše se red; objekat se briše istim putem kao i ostali.
       */
      const stale = await client.query<{ id: string; object_key: string }>(
        `SELECT id, object_key FROM attachments
          WHERE company_id = $1 AND status = 'pending'
            AND created_at < now() - INTERVAL '24 hours'`,
        [company.id],
      );
      for (const row of stale.rows) {
        try {
          await options.removeObject(row.object_key);
        } catch {
          // Objekat možda nikad nije ni stigao — red se svejedno briše, jer `pending` bez
          // objekta nije ništa.
        }
        await client.query("DELETE FROM attachments WHERE company_id = $1 AND id = $2", [
          company.id,
          row.id,
        ]);
        outcome.staleDropped += 1;
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      options.logger.error("attachments.purge: firma preskočena", {
        companyId: company.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.release();
    }
  }

  options.logger.info("attachments.purge gotov", { ...outcome });
  return outcome;
}

function formatToday(timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
