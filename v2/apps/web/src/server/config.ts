/**
 * Konfiguracija se validira pri startu i aplikacija NE starta sa nepotpunom konfiguracijom (A3.3.7).
 * Sve greške idu odjednom, sa imenom varijable — ne prva koja nađe.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL nedostaje"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET mora imati najmanje 32 znaka"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  // Jedinica je u imenu: MILISEKUNDE. Raspon je namjerno uzak — vrijednost poput 5 (ms)
  // daje prozor od 0 sekundi i time efektivno gasi ograničenje pokušaja prijave.
  AUTH_LOGIN_LIMIT: z.coerce.number().int().min(1, "AUTH_LOGIN_LIMIT mora biti najmanje 1").max(50, "AUTH_LOGIN_LIMIT ne smije biti veći od 50").default(5),
  AUTH_LOGIN_WINDOW_MS: z.coerce.number().int().min(10_000, "AUTH_LOGIN_WINDOW_MS mora biti najmanje 10000 ms (10 s)").max(3_600_000, "AUTH_LOGIN_WINDOW_MS ne smije biti veći od 3600000 ms (1 h)").default(60_000),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Neispravna konfiguracija: ${details}`);
  }
  cached = result.data;
  return cached;
}

/** Samo za testove: resetuje keš između slučajeva. */
export function resetConfigForTests(): void {
  cached = null;
}
