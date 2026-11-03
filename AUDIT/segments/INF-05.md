# INF-05 — Observability: readiness ugovor (Postgres + MinIO + migracije)

| | |
|---|---|
| Sloj | `INF` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-05`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Da „spremno za saobraćaj“ bude mjerljivo: readiness mora provjeriti **sve** zavisnosti koje
zahtjev stvarno koristi (Postgres, MinIO) i **stanje šeme** (jesu li migracije primijenjene), a ne
samo `SELECT 1`. Provjereno: šta `/api/ready` uopšte treba da tvrdi, kako se ponaša kad je
`MINIO_SKIP=true` (testovi), kako se prepoznaje deploy u toku (migracije) i curi li odgovor detalje
konekcije.

**Ne provjerava:** metrike/Prometheus i tracing (van obima v1 — plan traži samo ugovor),
log drain/alerting u Coolifyju (INFRASTRUCTURE), Redis (opciona zavisnost — INF-07), frontend i
mobile health (FE/MOB segmenti).

## 2. Ulaz

**Zavisnosti:** BE-18 (liveness/readiness razdvojeni, `@SkipEnvelope`, limit 2 s, D‑037), BE-11
(MinIO kredencijali i `MinioService`), BE-08 (migracije + `_prisma_migrations`), INF-04
(`requestId` u logu).

**Fajlovi:** `modules/health/{ready.controller.ts,migration-count.ts,health.service.ts,
health.service.spec.ts,health.controller.ts,health.module.ts}` + `test/health.e2e-spec.ts`.
Dotaknuto: `modules/files/minio.service.ts` (`healthCheck()`), `test/helpers/minio-memory.ts`.

**Pretpostavke:** `prisma/migrations` postoji u produkcijskoj slici (`backend/Dockerfile` kopira
`prisma/` u `/app/prisma`, cwd je `/app`) — ako ne postoji, provjera migracija je `unknown` i **ne**
obara readiness; `_prisma_migrations` je tabela koju piše `prisma migrate deploy` iz
`docker-entrypoint.sh`; MinIO bucket se provjerava istim kredencijalima kao upload (`bucketExists`).

## 3. Kriteriji završetka (DoD)

- [x] Svi fajlovi segmenta pregledani; status u matrici ≥ `pregledano`
- [x] Svaki nalaz ima težinu, dokaz (`fajl:linija`) i odluku
- [x] Popravke imaju regression test (unit: 7 testova; e2e: `/api/ready` sa tri provjere)
- [x] `node scripts/audit/check-coverage.mjs` → PASS
- [x] `npx jest` zelen (**209/209**)
- [x] `docs/` ažuriran u istom commitu (BACKEND §4.14, INFRASTRUCTURE §1/§3, D‑037 dopunjen)
- [x] `AUDIT/STATE.md` ažuriran; commit + push + **zelen CI** (run u §10)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (`fajl:linija`) | Ocjena |
|---|---|---|---|
| 1 | Readiness je provjeravao samo bazu; MinIO i stanje šeme nisu ulazili u odgovor | `health.service.ts:1-20` (prije, BE-18) | ⚠️ F‑01 |
| 2 | Putanja je bila `/api/health/ready`, a plan (§4.3) traži `/api/ready` | `health.controller.ts` (prije) | ⚠️ F‑02 |
| 3 | MinIO `bucketExists` je postojao samo kao interni korak `ensureBucket` (retry 10× / 3 s pri startu) — nije bio dostupan kao provjera | `minio.service.ts:32-55` (prije) | ⚠️ F‑03 |
| 4 | Nije postojao način da se vidi „deploy još migrira“ — instanca je bila „spremna“ i sa nedovršenim migracijama | nije postojalo | ⚠️ F‑04 |
| 5 | Testna zamjena MinIO-a (`MemoryMinioService`) nije imala health metodu, pa provjera ne bi radila u e2e | `test/helpers/minio-memory.ts:54-61` (prije) | ⚠️ F‑05 |
| 6 | Greške provjera ne vraćaju konekcijske stringove (samo `unreachable`) — pravilo iz BE‑18 ostaje | `health.service.ts` (novo) | ✅ |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-05-01 | **Readiness je tvrdio više nego što je provjeravao**: `SELECT 1` prolazi i kad MinIO ne radi (upload puca) i kad migracije nisu primijenjene (šema stara) — orchestrator šalje saobraćaj na instancu koja ne može servirati dio API-ja | srednje | `health.service.ts:7-20` (prije) | riješeno: `checks` ima `postgres`, `storage` (MinIO `bucketExists`) i `migrations` (`_prisma_migrations` vs folderi u slici); `error`/`pending` ⇒ `503`. Svaka provjera ima `latencyMs` i limit 2 s |
| F-INF-05-02 | **Putanja nije po planu**: readiness je bio pod `/api/health/ready`, a plan §4.3 imenuje `/api/ready` | nisko | `health.controller.ts` (prije) | riješeno: nova ruta `GET /api/ready` (`ready.controller.ts`); stara podruta uklonjena (nije bila objavljena — BE‑18 je isti dan) |
| F-INF-05-03 | **MinIO se nije mogao provjeriti** bez ponavljanja internog `ensureBucket` retry-ja | nisko | `minio.service.ts:32-55` (prije) | riješeno: `MinioService.healthCheck()` = `bucketExists`, bez retry-ja (readiness sam ima timeout); `MemoryMinioService.healthCheck()` vraća `true` |
| F-INF-05-04 | **Migracije kao dio readiness-a**: deploy u toku (`migrate deploy` u entrypointu) nije bio vidljiv, pa je instanca primala saobraćaj sa polovinom šeme | srednje | nije postojalo | riješeno: `migrations` provjera poredi **završene** redove `_prisma_migrations` sa brojem foldera u `prisma/migrations`; `applied < expected` ⇒ `pending` ⇒ `503`; `expected=null` (nema foldera u slici) ⇒ `unknown` (ne obara readiness). Prisma vraća `COUNT(*)` kao `BigInt` — pretvara se u `number` prije JSON-a |
| F-INF-05-05 | **E2E bi pukao na novoj provjeri** jer in-memory MinIO nema health metodu | nisko | `test/helpers/minio-memory.ts:54-61` (prije) | riješeno: `healthCheck()` u zamjeni; e2e tvrdi `storage.status='ok'` i `migrations.applied >= expected` |
| F-INF-05-06 | `MINIO_SKIP=true` (testovi/lokalno bez MinIO-a) ne smije praviti lažni `503` | nisko | — | riješeno: `storage: { status:'ok', detail:'skipped' }` — provjera je iskreno označena kao preskočena, a ne kao uspješna |
| F-INF-05-07 | **Test zavisi od env-a iz CI-ja**: unit testovi u CI-ju se pokreću sa `MINIO_SKIP=true`, pa je test „MinIO pao“ dobijao `skipped` umjesto `unreachable` — prvi CI run je pao samo na tome (`41660146614`, `Backend (lint + unit + build)` → `Unit testovi`) | nisko | `health.service.spec.ts` (prva verzija) | riješeno: `beforeEach` postavlja `MINIO_SKIP='false'` i vraća original u `afterAll`; provjereno lokalno sa `MINIO_SKIP=true npx jest src/modules/health` |

## 6. Popravke

1. **`modules/health/ready.controller.ts`** (novo) — `GET /api/ready`, `@Public` + `@SkipEnvelope`,
   `200`/`503` preko `@Res({ passthrough: true })`.
2. **`modules/health/migration-count.ts`** (novo) — `expectedMigrationCount(baseDir?)` čita
   `prisma/migrations` (broj foldera) i vraća `null` kad folder ne postoji.
3. **`modules/health/health.service.ts`** — `getReadiness()` sa tri paralelne provjere
   (`postgres`, `storage`, `migrations`), svaka sa `withTimeout` (2 s); greške nikad ne bacaju,
   detalji se ne vraćaju (`unreachable`), migracije se porede i prijavljuju kao `pending`/`unknown`.
4. **`modules/health/health.module.ts`** — `imports: [FilesModule]` (MinioService) i novi kontroler.
5. **`modules/files/minio.service.ts`** — `healthCheck()`.
6. **`test/helpers/minio-memory.ts`** — `healthCheck()` u zamjeni.
7. **`test/health.e2e-spec.ts`** — `/api/ready` sa tri provjere; `MINIO_SKIP=true` u CI-ju daje
   `storage.status='ok'`/`detail='skipped'`.
8. **`health.service.spec.ts`** — 7 testova: liveness bez baze, sve ok, Postgres pao, MinIO pao,
   migracije `pending`, timeout, `MINIO_SKIP`.

**Odbačene alternative:** (A) poseban `/api/health/minio` i `/api/health/migrations` — tri rute za
jedan odgovor, orchestrator bi morao zvati tri puta; (B) readiness koji **provjerava** Redis —
Redis je opcion (throttle fallback je u memoriji), pa bi ispao `503` bez stvarne potrebe (INF‑07 će
odlučiti); (C) „uvijek 200 sa `degraded`“ — orchestrator ne bi imao signal da ne šalje saobraćaj.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Unit testovi | `npx jest` | **209/209 ✅** (34 suite-a; +3) |
| Tipovi | `tsc --noEmit -p tsconfig.json` (filtrirano) | ✅ (samo `generated/client` artefakti) |
| Lint | `npx eslint` (filtrirano na `no-unsafe-*`) | ✅ |
| Format | `npx prettier --check` | ✅ |
| Guardovi | `node scripts/standards/check-all.mjs` | ✅ |
| E2E | `health`: `/api/ready` → `200`, `postgres/storage/migrations` `ok`, `applied ≥ expected` | vidi §10 |

## 8. Rizici i rollback

- **Rizik (migracije):** `pending` znači `503` dok `migrate deploy` ne završi — to je namjerno, ali
  produžava deploy; `docker-entrypoint.sh` migrira **prije** starta servera, pa je prozor mali.
  Ako baza ima migracije kojih nema u slici (rollback slike), stanje je `ok` (`applied ≥ expected`).
- **Rizik (MinIO):** `bucketExists` ide na mrežu; uz limit 2 s i `every 30 s` monitoring nema
  opterećenja. Pad MinIO-a sada daje `503` na `/api/ready`, ali **ne** na `/api/health` (proces
  ostaje „healthy“, bez restart-loopa — D‑037).
- **Rizik (BigInt):** `COUNT(*)::bigint` se pretvara u `number` prije serijalizacije; bez toga bi
  `JSON.stringify` bacio grešku (bigint nije serijalizabilan) — pokriveno testom.
- **Rollback:** `git revert` koda (nema migracije ni env varijable); `HEALTHCHECK` se ne mijenja.

## 9. Dokumentacija

- [x] `docs/BACKEND.md` §4.14 (tri provjere, `pending`/`unknown`, `MINIO_SKIP`) + tabela modula
- [x] `docs/INFRASTRUCTURE.md` §1 (observability) i §3 (compose tabela: `/api/ready` kao blue/green
  gate)
- [x] `docs/DECISIONS.md` D‑037 dopunjen (putanja `/api/ready`, MinIO + migracije)
- [x] `AUDIT/segments/INF-05.md` (ovaj dokument), `AUDIT/STATE.md`, `scripts/audit/segments.json`, matrica

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-03 |
| Commit(ovi) | kod + testovi + docs + matrica (hash u `AUDIT/STATE.md`), zatim zapis runa |
| CI run | vidi `AUDIT/STATE.md` (upisuje se poslije `gh run watch`) |
| Status | `done` |
