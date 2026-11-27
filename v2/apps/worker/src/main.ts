/**
 * `apps/worker` — poslovi u pozadini na pg-boss-u (bez Redisa, odluka iz Modula 1).
 *
 * Šta ovaj proces radi u Fazi 0:
 *   - registruje poslove `ping.health` i `notifications.deliver`;
 *   - drži jedan `pg.Pool` za poslovne upite (tenant se postavlja PO POSLU);
 *   - gasi se uredno: prestane da prima nove poslove, dovrši tekući, pa zatvori konekcije.
 *
 * Šta NAMJERNO ne radi: ne dira `pgboss` šemu iz aplikacije, ne piše u tabele modula bez
 * `app.company_id`, i ne ponavlja posao „dok ne uspije“ — pg-boss to radi sam, sa retry
 * politikom koja je zapisana uz registraciju.
 */
import PgBoss from "pg-boss";
import pg from "pg";
import { loadConfig } from "./config";
import { JOB_NAMES, pingHealth, type JobLogger } from "./jobs";
import { deliverNotifications } from "./notifications-deliver";
import { scanReminders } from "./reminders-scan";
import { purgeAttachments } from "./attachments-purge";
import { purgeSyncPayloads } from "./sync-purge";
import { scanBudgetThresholds } from "./budget-thresholds";
import { refreshDailyRollups } from "./rollup-nightly";
import { runScheduledReports } from "./reports-scheduled";
import { createObjectRemover } from "./object-storage";
import { grantQueueHealthRead } from "./queue-health-grants";
import { dispatchReportJobs } from "./report-job-dispatch";
import { executeReportJob } from "../../web/src/server/report-job-execution";
import { createReportAttachmentStore } from "../../web/src/server/report-job-attachment-service";
import { storageConfig } from "../../web/src/server/storage";

const config = loadConfig();

/**
 * Log je JSON po liniji — worker ne piše u fajl i ne rotira ništa: to radi orchestrator.
 * `console.log` je zabranjen eslint-om (samo `error`/`warn`), pa `info` ide kroz `process.stdout`
 * — ista stvar, ali svjesno izabrana: `info` NIJE greška i ne smije završiti u stderr kanalu.
 */
const write = (stream: NodeJS.WriteStream, level: string) => (message: string, details?: Record<string, unknown>) =>
  stream.write(`${JSON.stringify({ level, msg: message, ...details })}\n`);

const logger: JobLogger = {
  info: write(process.stdout, "info"),
  warn: write(process.stderr, "warn"),
  error: write(process.stderr, "error"),
};

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.concurrency + 2 });
const boss = new PgBoss({
  connectionString: config.bossDatabaseUrl,
  schema: "pgboss",
  max: config.concurrency,
  // Posao koji visi duže od ovoga vraća se u red — bolje dupli (idempotentan) nego izgubljen.
  expireInMinutes: config.jobExpireMinutes,
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
});

let shuttingDown = false;

async function runPing(): Promise<void> {
  await pingHealth(logger)();
}

/**
 * `notifications.deliver` ide po firmama: posao nosi `companyId`, pa jedan posao nikad ne
 * miješa dvije firme (i RLS ostaje smislen).
 */
async function runDeliver(job: { data: { companyId?: string } }): Promise<void> {
  const companyId = job.data?.companyId;
  if (!companyId) {
    logger.error("notifications.deliver bez companyId — posao se preskače", {});
    return;
  }
  await deliverNotifications(pool, { companyId, logger });
}

/**
 * `reminders.scan` — jedan posao za SVE firme; unutar sebe preskače firme koje nisu u 06 h
 * svoje zone. Zato nije zakazano po firmi: raspored u pg-boss-u bi morao da se prepisuje kad
 * se doda firma, a to je posao koji se zaboravi.
 */
async function runReminders(): Promise<void> {
  await scanReminders(pool, { logger });
}

/**
 * `attachments.purge` — briše objekat iz bucketa i red u bazi.
 *
 * Kad `MINIO_*` varijable nisu postavljene, posao ne briše ništa i to PRIJAVI: tiho preskakanje
 * bi značilo da retencija „radi“ dok medicinski nalazi stoje.
 */
async function runAttachmentsPurge(): Promise<void> {
  const storage = createObjectRemover();
  if (!storage.configured) {
    logger.warn("attachments.purge: bucket nije konfigurisan — retencija se ne primjenjuje", {
      reason: storage.reason,
    });
    return;
  }
  await purgeAttachments(pool, { logger, removeObject: storage.removeObject });
}

/**
 * `sync.purge` — tijela razriješenih sukoba po retenciji (90 dana od razrješenja).
 *
 * Posao ne traži bucket ni bilo koju vanjsku uslugu: briše se kolona, pa nema „preskočeno jer
 * nije konfigurisano“. Ako padne, sljedeći dnevni prolaz ga ponavlja — idempotentan je.
 */
async function runSyncPurge(): Promise<void> {
  await purgeSyncPayloads(pool, { logger });
}

/**
 * `budget.thresholds` — pragovi budžeta za sve firme u jednom prolazu.
 *
 * Posao ide često (svakih 15 minuta): prag treba da bude primijećen dok se još može reagovati, a ne
 * sutra. Skup je posla mali jer se gledaju samo aktivni projekti sa budžetom, a deduplikacija je u
 * bazi (`budget_alert_events`), pa čest prolaz ne pravi šum u obavještenjima.
 */
async function runBudgetThresholds(): Promise<void> {
  await scanBudgetThresholds(pool, { logger });
}

async function main(): Promise<void> {
  boss.on("error", (error) => logger.error("pg-boss greška", { message: error.message }));

  // A privileged pg-boss connection is separate; business queries must never bypass RLS.
  const role = await pool.query<{safe:boolean}>(`SELECT NOT (rolsuper OR rolbypassrls) AS safe
    FROM pg_roles WHERE rolname=current_user`);
  if (role.rows[0]?.safe !== true) throw new Error("WORKER_DATABASE_ROLE_BYPASSES_RLS");
  await boss.start();
  try { await grantQueueHealthRead(boss.getDb()); }
  catch (error) { logger.warn("queue health: operativni pregled nije dostupan", { message: error instanceof Error ? error.message : String(error) }); }
  // `createQueue` je idempotentan; šema reda mora postojati prije `work`.
  await boss.createQueue(JOB_NAMES.pingHealth);
  await boss.createQueue(JOB_NAMES.notificationsDeliver);
  await boss.createQueue(JOB_NAMES.remindersScan);
  await boss.createQueue(JOB_NAMES.attachmentsPurge);
  await boss.createQueue(JOB_NAMES.syncPurge);
  await boss.createQueue(JOB_NAMES.budgetThresholds);
  await boss.createQueue(JOB_NAMES.rollupNightly);
  await boss.createQueue(JOB_NAMES.reportsScheduled);
  await boss.createQueue(JOB_NAMES.reportJobs,{name:JOB_NAMES.reportJobs,policy:"stately"});

  await boss.work(JOB_NAMES.pingHealth, async () => runPing());
  // pg-boss 10 predaje NIZ poslova (batch), ne jedan — i kad je jedan, stiže kao niz.
  await boss.work(JOB_NAMES.notificationsDeliver, async (jobs) => {
    for (const job of jobs as unknown as { data: { companyId?: string } }[]) {
      await runDeliver(job);
    }
  });

  await boss.work(JOB_NAMES.remindersScan, async () => runReminders());
  await boss.work(JOB_NAMES.attachmentsPurge, async () => runAttachmentsPurge());
  await boss.work(JOB_NAMES.syncPurge, async () => runSyncPurge());
  await boss.work(JOB_NAMES.budgetThresholds, async () => runBudgetThresholds());
  await boss.work(JOB_NAMES.rollupNightly, async () => { await refreshDailyRollups(pool, { logger }); });
  await boss.work(JOB_NAMES.reportsScheduled, async () => { await runScheduledReports(pool, { logger }); });
  await boss.work(JOB_NAMES.reportJobs, async jobs => {
    for (const job of jobs) {
      const data=job.data as {companyId?:unknown;jobId?:unknown} | null;
      if (!data || (data.companyId === undefined && data.jobId === undefined)) {
        await dispatchReportJobs(pool,(name,payload,options)=>boss.send(name,payload,options));
        continue;
      }
      if (typeof data.companyId !== "string" || typeof data.jobId !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(data.companyId) || !/^[A-Za-z0-9_-]{1,128}$/.test(data.jobId)) {
        logger.warn("report_jobs: neispravan payload",{}); continue;
      }
      const storage=storageConfig();
      const store=storage.configured ? createReportAttachmentStore(pool,storage) : async () => {throw new Error("REPORT_STORAGE_UNAVAILABLE");};
      await executeReportJob(pool,data.companyId,data.jobId,store);
    }
  });

  // Canarinac: ako se ovaj posao ne izvrši, red je pokvaren i niko to ne bi primijetio.
  await boss.schedule(JOB_NAMES.pingHealth, `*/${Math.max(config.reminderIntervalMinutes, 1)} * * * *`);
  // Podsjetnici: svakih 15 minuta; posao sam pusti firmu samo u 06 h njene zone.
  await boss.schedule(JOB_NAMES.remindersScan, "*/15 * * * *");
  // Retencija: jedan prolaz dnevno u 03:00 UTC — van radnog vremena, a prije jutarnjeg
  // pregleda rokova, pa obrisano ne izgleda kao „nestalo preko noći“.
  await boss.schedule(JOB_NAMES.attachmentsPurge, "0 3 * * *");
  // Retencija sukoba: 03:30 UTC — pola sata poslije priloga, da se dva brisanja ne preklope
  // i da se u logu vidi koje je šta obrisalo.
  await boss.schedule(JOB_NAMES.syncPurge, "30 3 * * *");

  // Pragovi budžeta: svakih 15 minuta. Za razliku od `reminders.scan`, ovdje NEMA filtera po zoni —
  // prag ne zavisi od doba dana, a odgađanje do jutra bi značilo da se prekoračenje vidi tek sutra.
  await boss.schedule(JOB_NAMES.budgetThresholds, "*/15 * * * *");
  await boss.schedule(JOB_NAMES.rollupNightly, "0 2 * * *");
  // Svaki sat, prethodni mjesec određuje se u vremenskoj zoni svake firme.
  await boss.schedule(JOB_NAMES.reportsScheduled, "0 * * * *");
  // Durable DB outbox is periodically relayed; API never needs boss credentials.
  await boss.schedule(JOB_NAMES.reportJobs, "* * * * *");

  logger.info("worker pokrenut", {
    poslovi: Object.values(JOB_NAMES),
    intervalMinuta: config.reminderIntervalMinutes,
    konkurentnost: config.concurrency,
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("gašenje", { signal });
    try {
      // Prestani primati nove poslove; tekući dobiju šansu da se dovrše.
      await boss.stop({ graceful: true, timeout: 30_000 });
      await pool.end();
      logger.info("ugašen uredno", {});
      process.exit(0);
    } catch (error) {
      logger.error("greška pri gašenju", { message: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.error("worker nije pokrenut", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
