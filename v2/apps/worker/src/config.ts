/**
 * Konfiguracija workera — JEDNO mjesto gdje se čita okruženje.
 *
 * Worker radi poslove za SVE firme, pa mu trebaju dvije konekcije:
 *   - poslovni upiti — `DATABASE_URL` (aplikacijska rola) ili `DATABASE_ADMIN_URL` (vlasnik
 *     šeme). Poslovna rola je dovoljna: svaki posao postavi `app.company_id` kroz `withCompany`,
 *     pa `FORCE RLS` propušta tačno jednu firmu;
 *   - pg-boss šema `pgboss` — `BOSS_DATABASE_URL`, inače `DATABASE_ADMIN_URL` (vlasnička rola:
 *     pg-boss PRI PRVOM STARTU pravi šemu i tabele, a aplikacijska rola to ne smije), inače
 *     `DATABASE_URL` za baze gdje je rola već vlasnik `pgboss` šeme.
 *
 * Fallback je namjeran: na Coolify deployu se često postavi samo `DATABASE_URL` (jedna
 * varijabla za web i worker), a worker bi tada padao na startu sa „nedostaje
 * DATABASE_ADMIN_URL". Redoslijed je zato: `DATABASE_URL` → `DATABASE_ADMIN_URL` za posao, i
 * `BOSS_DATABASE_URL` → `DATABASE_ADMIN_URL` → `DATABASE_URL` za red. `BOSS_DATABASE_URL`
 * postoji za slučaj odvojene baze reda, ne kao uslov za rad.
 *
 * Namjerno padamo JASNO kad nijedan URL ne postoji: worker koji tiho ne radi je gori od
 * ugašenog, jer niko ne primijeti da podsjetnici ne stižu.
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

function prviPostavljen(env: NodeJS.ProcessEnv, ...imena: string[]): string | null {
  for (const ime of imena) {
    const vrijednost = env[ime]?.trim();
    if (vrijednost) return vrijednost;
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = prviPostavljen(env, "DATABASE_URL", "DATABASE_ADMIN_URL");
  if (!databaseUrl) {
    throw new Error(
      "Nedostaje DATABASE_URL (ili DATABASE_ADMIN_URL). Worker ne može raditi bez baze — " +
        "postavi DATABASE_URL prije pokretanja.",
    );
  }
  return {
    databaseUrl,
    // pg-boss drži svoju šemu i pravi je sam pri prvom startu → vlasnička rola ima prednost.
    bossDatabaseUrl: prviPostavljen(
      env,
      "BOSS_DATABASE_URL",
      "DATABASE_ADMIN_URL",
      "DATABASE_URL",
    )!,
    reminderIntervalMinutes: Number(env.REMINDER_INTERVAL_MINUTES ?? 15),
    jobExpireMinutes: Number(env.JOB_EXPIRE_MINUTES ?? 15),
    concurrency: Number(env.WORKER_CONCURRENCY ?? 4),
    logLevel: (env.LOG_LEVEL as WorkerConfig["logLevel"]) ?? "info",
  };
}
