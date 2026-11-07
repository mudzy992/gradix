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
