# ADR 0002 — Prisma generator blokiran u razvojnom okruženju; prelazak na SQL-first

**Datum:** 2026-11-07 · **Status:** privremeno (na snazi do provjere u CI-ju/Coolifyju)

## Kontekst

Stack je odlučen (B8): PostgreSQL + Prisma. Prva namjera je bila da `packages/db` koristi Prisma šemu, `prisma migrate` i generisani klijent. U ovom okruženju to **ne radi**: Prisma 7.10.1 pri svakom `generate`, `migrate` i `migrate diff` pokušava da skine `schema-engine` sa `binaries.prisma.sh`, a taj host nije dostupan (`Client network socket disconnected before secure TLS connection was established`). `npm` registry je dostupan, engines host nije. Isto pada i uz `--no-engine`.

## Odluka

Faza 1 ide **SQL-first**:

- migracije su ručno pisane, naprijed-samo, pregledne (`packages/db/prisma/migrations/*/migration.sql`);
- pristup bazi ide kroz `pg` pool i jedan tenant scope (`withCompany`), sa parametrizovanim upitima;
- Prisma šema ostaje u repou kao **izvor namjere** za Fazu 2, ali se iz nje ništa ne generiše dok blokada ne padne.

Ovo nije promjena odlučenog stacka — to je privremeni način rada dok generator nije dostupan.

## Alternative

1. **Čekati pristup `binaries.prisma.sh`** — blokira cijelu Fazu 1 zbog problema okruženja, ne proizvoda. Odbačeno.
2. **Drizzle/Kysely umjesto Prisma** — mijenja odluku vlasnika (B8) bez tehničkog razloga; SQL-first sloj se kasnije lako zamijeni Prismom jer je tenant scope već izolovan u jednom modulu. Odbačeno.
3. **Ručni SQL + `pg` (odabrano)** — najmanje koda, nula novih zavisnosti, isti mehanizam (`SET LOCAL app.company_id`) koji bi Prisma koristila. Cijena: nema tipova iz šeme, pa tipovi za spike entitete ostaju ručni.

## Posljedice

- **Rizik:** dupli posao ako se Prisma vrati u Fazu 2 (mapiranje šeme na postojeće tabele). Ublaženje: imena tabela i kolona su već `snake_case` i odgovaraju Prisma `@@map` konvenciji.
- **Provjera prije G1:** u CI-ju (GitHub runner ima pristup internetu) pokrenuti `prisma generate`; ako prođe, ADR se mijenja na „Prisma radi u CI-ju, lokalno SQL-first“ ili se vraća Prisma svuda.
- Nema `prisma migrate` historije; stanje šeme se prati po folderima migracija i provjerava testom na praznoj bazi.
- Novi zavisnik: `pg@8.16.3` + `@types/pg` (P6 — obrazloženje u ovom ADR-u).
