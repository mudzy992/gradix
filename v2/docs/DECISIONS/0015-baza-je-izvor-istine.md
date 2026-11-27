# ADR 0015 — Baza je izvor istine; tipovi se generišu iz baze (zamjenjuje ADR 0002)

**Datum:** 2026-11-23 · **Status:** prihvaćeno

## Kontekst

ADR 0002 je 2026-11-07 uveo privremeni model: SQL-first migracije + `pg`, uz `schema.prisma`
koja „ostaje kao izvor namjere za Fazu 2“. Praksa je pokazala tri problema:

1. `schema.prisma` je pokrivala **9 od 49** tabela i bila je **lažni izvor istine** — niko je nije
   održavao, a CI je održavao korak `prisma generate` samo kao dokaz da generator radi.
2. Cijena tog koraka nije bila nula: zavisnost od `binaries.prisma.sh`, `prisma.config.ts`
   zbog `url` semantike Prisma 7, i `@prisma/client` u `packages/db` koji se **nigdje ne koristi**.
3. Nijedan tip iz šeme nije korišten u kodu; servisi imaju ručno pisane `type DbX = {...}`.

## Odluka

**Baza je izvor istine.** Prisma se uklanja iz toka izgradnje u cjelini:

- `packages/db/prisma/` se briše; migracije sele u `packages/db/migrations/` (i dalje ručno pisane,
  naprijed-samo, `infra/scripts/db-apply.sh` ih primjenjuje preko `psql`).
- Tipovi se generišu **iz žive baze** sa `kysely-codegen` u `packages/db/src/schema.generated.ts`
  (`pnpm db:types`). Fajl je commitovan, da tipovi postoje i bez baze.
- CI provjerava sinhronizaciju: `pnpm db:types:check` pada ako se generisano razlikuje od
  commitovanog — to je nemoguće bez nove migracije, pa provjera hvata „zaboravljenu“ migraciju.
- Upiti **ostaju** parametrizovani SQL kroz `withCompany` (ADR 0003). Kysely je ovdje samo
  generator tipova, ne query builder; `kysely` je zavisnost jer generisani fajl koristi
  `ColumnType` pri tipovima `Generated<>`/`Int8`.

## Alternative

1. **Vratiti Prisma klijent** — 9 modela bi trebalo ručno mapirati na 49 tabela; blokada
   `schema-engine` je i dalje stvarna u dijelu okruženja; dvostruki izvor istine se vraća.
2. **Ručno pisani tipovi** (stanje do sada) — 49 tabela × ~20 kolona; greška u tipu se otkrije
   tek u runtime-u; nema provjere da su tipovi sinhroni sa šemom.
3. **`pg-typed`** — takođe radi, ali generiše module po tabeli i uvodi svoj query builder;
   `kysely-codegen` daje jedan fajl i `DB` interfejs bez obaveze da se upiti prepišu.

## Posljedice

- Nova migracija **mora** biti propraćena `pnpm db:types` u istom commitu (CI to provjerava).
- Nestaje korak `prisma generate` iz CI-ja; zamjenjuje ga `db:types:check`.
- `@prisma/client`, `prisma`, `prisma.config.ts` i `schema.prisma` se brišu. ADR 0002 ostaje u
  historiji kao objašnjenje zašto je SQL-first izabran — njegov „privremeni“ dio više ne važi.
- Rizik: tipovi su tačni, ali ne i „domenSKI lijepi“ (npr. `status: string`). To je namjerno:
  domensku validaciju drže `packages/domain` i CHECK constrainti, ne TypeScript.
