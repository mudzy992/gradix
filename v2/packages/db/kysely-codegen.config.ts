/**
 * Generisanje TypeScript tipova IZ ŽIVE BAZE (Faza 0, ADR 0015).
 *
 * Zašto iz baze, a ne iz šeme: `schema.prisma` je pokrivala 9 od 49 tabela i bila je
 * lažni izvor istine. Baza je jedini istinit opis; migracije su SQL i naprijed-samo.
 *
 * Izlaz je `src/schema.generated.ts` — commitovan u repo, jer pruža tipove i bez baze
 * (CI provjerava da je sinhron sa migracijama preko `pnpm db:types:check`).
 */
import type { GenerateOptions } from "kysely-codegen";

const config: Partial<GenerateOptions> = {
  dialect: "postgres",
  // Javna šema; RLS politike ne mijenjaju tipove.
  includePattern: "public.*",
  excludePattern: "public.schema_migrations",
  // Enum tipovi iz baze postaju union stringova (npr. 'WORK' | 'BREAK').
  enums: true,
  // Datumi ostaju stringovi: sve do sada (`pg` vraća `date` kao `YYYY-MM-DD`) i to je
  // jedini format koji poslovni kod smije koristiti (ADR 0004, `pg-date-tz-child`).
  dateParser: "string",
  numericParser: "string",
  // Bez `camelCase` — baza je `snake_case` i takva ostaje u cijelom kodu.
  camelCase: false,
};

export default config;
