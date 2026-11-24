/**
 * Konfiguracija workera — JEDNO mjesto gdje se čita okruženje.
 *
 * Worker radi poslove za SVE firme, pa mu trebaju dvije konekcije:
 *   - `DATABASE_ADMIN_URL` — poslovni upiti (vlasnik šeme; `FORCE RLS` se obilazi samo tako
 *     što svaki posao postavi `app.company_id` kroz `withCompany`, nikad „zaboravi WHERE“);
 *   - `DATABASE_URL` (ili ista admin) — pg-boss šema `pgboss`.
 *
 * Namjerno padamo JASNO kad URL nedostaje: worker koji tiho ne radi je gori od ugašenog,
 * jer niko ne primijeti da podsjetnici ne stižu.
 */
export type WorkerConfig = {
  databaseUrl: string;
  bossDatabaseUrl: string;
  /** Koliko često `reminders.scan` ide. Spec 12 §13: 15 minuta. */
  reminderIntervalMinutes: number;
  /** Koliko dugo posao smije visiti prije nego ga pg-boss vrati u red. */
  jobExpireMinutes: number;
  concurrency: number;
  logLevel: "debug" | "info" | "warn" | "error";
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Nedostaje ${name}. Worker ne može raditi bez baze — postavi ${name} prije pokretanja.`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    databaseUrl: required("DATABASE_ADMIN_URL"),
    // pg-boss drži svoju šemu; koristi istu bazu da nema drugog sistema za red.
    bossDatabaseUrl: env.BOSS_DATABASE_URL?.trim() || required("DATABASE_ADMIN_URL"),
    reminderIntervalMinutes: Number(env.REMINDER_INTERVAL_MINUTES ?? 15),
    jobExpireMinutes: Number(env.JOB_EXPIRE_MINUTES ?? 15),
    concurrency: Number(env.WORKER_CONCURRENCY ?? 4),
    logLevel: (env.LOG_LEVEL as WorkerConfig["logLevel"]) ?? "info",
  };
}
