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

async function main(): Promise<void> {
  boss.on("error", (error) => logger.error("pg-boss greška", { message: error.message }));

  await boss.start();
  // `createQueue` je idempotentan; šema reda mora postojati prije `work`.
  await boss.createQueue(JOB_NAMES.pingHealth);
  await boss.createQueue(JOB_NAMES.notificationsDeliver);

  await boss.work(JOB_NAMES.pingHealth, async () => runPing());
  // pg-boss 10 predaje NIZ poslova (batch), ne jedan — i kad je jedan, stiže kao niz.
  await boss.work(JOB_NAMES.notificationsDeliver, async (jobs) => {
    for (const job of jobs as unknown as { data: { companyId?: string } }[]) {
      await runDeliver(job);
    }
  });

  // Canarinac: ako se ovaj posao ne izvrši, red je pokvaren i niko to ne bi primijetio.
  await boss.schedule(JOB_NAMES.pingHealth, `*/${Math.max(config.reminderIntervalMinutes, 1)} * * * *`);

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
