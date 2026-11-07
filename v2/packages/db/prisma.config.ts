// Prisma 7: konekcija se NE navodi u `schema.prisma` (tamo `url` više nije podržan),
// nego ovdje. Šema ostaje opis modela; ovo je opis odakle se čita i gdje su migracije.
//
// Zašto je ovo potrebno iako aplikacija ne koristi Prisma klijent u Fazi 1:
// CI pokreće `prisma generate` kao dokaz da generator radi (ADR 0002). Bez ovog fajla
// Prisma 7 odbija šemu zbog `url` u `datasource` — i to je bio stvarni uzrok pada CI-ja,
// a ne nedostupnost binaries.prisma.sh.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // `env()` se NE koristi namjerno: `prisma generate` mora raditi i bez baze,
  // a migracije ionako izvršava `infra/scripts/db-apply.sh` preko psql-a (SQL-first).
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://build:build@localhost:5432/build",
  },
});
