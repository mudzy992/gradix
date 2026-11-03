# INF-04 — Strukturisano logovanje

| | |
|---|---|
| Sloj | `INF` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-04`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Da log iz produkcije bude **mašinski čitljiv** i da se svaki zapis može pripisati jednom zahtjevu:
JSON red po zapisu, nivo koji se filtrira (`LOG_LEVEL`), `requestId` kroz cijeli async lanac i
**nikad** PII/tajne u logu. Provjereno: šta se danas piše (Nest default tekstualni format + tri
`console.error` mjesta), može li se greška povezati sa zahtjevom, curi li tijelo/query/header u log,
i da li se nivo može podesiti bez izmjene koda.

**Ne provjerava:** metrike/tracing i alerting (INF-05), log drain/rotaciju u Coolifyju (Docker
`json-file` + Coolify UI — dokumentovano u `docs/INFRASTRUCTURE.md`), frontend/mobile logovanje
(FE/MOB segmenti), revizijski trag poslovnih akcija (`AuditLog`, BE-04 — to nije log).

## 2. Ulaz

**Zavisnosti:** BE-01 (env validacija + `configureApp` + exception filter), INF-01 (env guard koji
traži dokumentovanu i validiranu varijablu) — `done`.

**Fajlovi:** 7 novih u `backend/src/common/logging/`: `log-level.ts`, `redact.ts`,
`request-context.ts`, `json-logger.ts`, `request-log.middleware.ts` + 2 spec fajla.
Dotaknuto (segment ostaje matični): `backend/src/app.setup.ts`, `backend/src/main.ts`,
`backend/src/common/filters/app-exception.filter.ts` (+ spec), `backend/src/config/env.ts`
(+ spec), `test/health.e2e-spec.ts`, `.env.example`, `.env.coolify`,
`scripts/audit/lib.mjs` (klasifikacija), `scripts/standards/check-console.mjs` (tekst pravila).

**Pretpostavke:** Coolify čita **stdout** kontejnera (`json-file` drajver) i filtrira po `level`;
`x-request-id` može doći iz nginx-a (prosljeđuje se) ili ga backend generiše; log nikad nije izvor
istine za poslovne podatke (za to je `AuditLog`).

## 3. Kriteriji završetka (DoD)

- [x] Svi fajlovi segmenta pregledani; status u matrici ≥ `pregledano`
- [x] Svaki nalaz ima težinu, dokaz (`fajl:linija`) i odluku
- [x] Popravke imaju regression test (unit: 11 novih testova + 1 u `env.spec.ts`; e2e: `x-request-id`)
- [x] `node scripts/audit/check-coverage.mjs` → PASS
- [x] `npx jest` zelen (**206/206**)
- [x] `docs/` ažuriran u istom commitu (BACKEND §5/§5.1, INFRASTRUCTURE §1/§5, DECISIONS **D-038**)
- [x] `AUDIT/STATE.md` ažuriran; commit + push + **zelen CI** (run u §10)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (`fajl:linija`) | Ocjena |
|---|---|---|---|
| 1 | Nema korelacionog ID-a: greška iz Coolify loga ne može se povezati sa zahtjevom | `app.setup.ts` (prije), `app-exception.filter.ts:41` (prije) | ❌ F‑01 |
| 2 | Log je Nest-ov tekstualni format; nivo se ne može podesiti bez izmjene koda | `app.setup.ts` (prije), nema `LOG_LEVEL` u `env.ts` (prije) | ⚠️ F‑02 |
| 3 | Nijedno pravilo ne sprječava da tijelo/query/headeri sa PII dođu u log | nije postojalo | ⚠️ F‑03 |
| 4 | Bootstrap greška (`env` validacija, baza) ide kao dva `console.error` reda, ne JSON | `main.ts:16-22` (prije) | ⚠️ F‑04 |
| 5 | Nijedan HTTP zahtjev se ne loguje (nema statusa/trajanja), pa se 5xx vidi samo kao izuzetak | nije postojalo | ⚠️ F‑05 |
| 6 | Nest `Logger` se koristi u 10 servisa — svi moraju pisati isti format | `grep "new Logger("` (10 mjesta) | ✅ (sada automatski JSON) |
| 7 | `console.log/debug` je zabranjen guardrail-om; `console.error/warn` dozvoljen | `scripts/standards/check-console.mjs` | ✅ (nepromijenjeno) |
| 8 | Env varijabla koja nije dokumentovana/validirana pada guardrail | `scripts/standards/check-env.mjs` | ✅ (provjereno, 88 varijabli) |
| 9 | Revizijski trag poslovnih akcija ostaje `AuditLog` u bazi, ne log | `modules/audit/audit.service.ts` | ✅ (granica jasna) |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-04-01 | **Nema korelacionog ID-a**: uz `500 INTERNAL_ERROR` klijent nije dobijao nikakav identifikator, a server je logovao `console.error` bez veze sa zahtjevom — prijava korisnika „puklo mi je u 14:32“ nije se mogla spojiti sa zapisom | visoko | `app-exception.filter.ts:41` (prije) | riješeno: `requestLogMiddleware` daje `x-request-id` (validan klijentski se prihvata, inače `randomUUID`), vraća ga u odgovoru i drži u `AsyncLocalStorage`; svaki log red nosi `requestId` (uključujući `AppExceptionFilter`) |
| F-INF-04-02 | **Nestruktuiran log i nepromjenjiv nivo**: tekstualne linije bez `level`/`context` polja; Coolify ne može filtrirati, a nivo se mijenja samo izmjenom koda | srednje | `app.setup.ts` (prije) | riješeno: `JsonLogger` (Nest `LoggerService`) piše `{ts, level, context, msg, requestId?, …}`; `LOG_LEVEL` u env validaciji (`error|warn|info|debug`), default `info` u produkciji, `debug` u razvoju, `error` u testovima |
| F-INF-04-03 | **Rizik PII/tajni u logu**: nije bilo pravila ni mehanizma — dovoljan je jedan `logger.debug(dto)` i email/telefon/`password`/token odu u Coolify | srednje | nije postojalo | riješeno: `redact()` čisti ključeve (`password/secret/token/authorization/cookie/apiKey/databaseUrl/email/phone/name/lat/lng`) i ugniježđeno (do dubine 4), skraćuje stringove; HTTP linija loguje **samo** `method/path` (bez query-ja), `status`, `durationMs` — nikad tijelo, headeri ni IP. Pravilo zapisano u BACKEND §5.1 i D‑038 |
| F-INF-04-04 | **Bootstrap greška nije JSON** (`console.error` dva reda) — upravo najvažniji slučaj (env/baza) bio je neparsiran | nisko | `main.ts:16-22` (prije) | riješeno: `JsonLogger` se pravi ručno prije DI-ja i piše `error` red sa stack-om + `reason`; `console.error` ostaje dozvoljen guardrail-om za slučajeve prije loggera |
| F-INF-04-05 | **Nijedan zahtjev se ne loguje**: nema statusa ni trajanja, pa se 5xx (i tihi 4xx trendovi) ne vide bez reprodukcije | nisko | nije postojalo | riješeno: jedna `http_request` linija po zahtjevu (`finish`/`close`, deduplikovano), `level=error` za `>=500`; u testovima je nivo `error`, pa `npx jest` ostaje tih |
| F-INF-04-06 | Guardrail tekst je obećavao `pino` kao „jedini način“ | nisko | `scripts/standards/check-console.mjs:11` (prije) | ispravljeno: tekst govori „JSON logger + korelacioni ID (INF-04)“, jer odluka D‑038 je bez `pino` zavisnosti |

## 6. Popravke

1. **`common/logging/log-level.ts`** — `LogLevel` + `resolveLogLevel(NODE_ENV, LOG_LEVEL)` +
   `isLevelEnabled` (fiksni poredak nivoa).
2. **`common/logging/redact.ts`** — `redact(value)`: tajne/PII po imenu ključa (ugniježđeno do
   dubine 4), skraćivanje stringova na 2.000 znakova, bez mutacije ulaza.
3. **`common/logging/request-context.ts`** — `AsyncLocalStorage` sa `requestId` (bez zavisnosti).
4. **`common/logging/json-logger.ts`** — `JsonLogger implements LoggerService` (`log/warn/debug/
   verbose/error` + `write(level, msg, context, meta)`); serijalizacija nikad ne baca.
5. **`common/logging/request-log.middleware.ts`** — `x-request-id` (regex `[A-Za-z0-9._-]{8,64}`),
   header u odgovoru, `http_request` linija bez query-ja/tijela/headera.
6. **`app.setup.ts`** — `app.useLogger(new JsonLogger())` + `app.use(requestLogMiddleware())`.
7. **`main.ts` / `app-exception.filter.ts`** — JSON redovi (`Bootstrap`, `ExceptionFilter`) sa
   `requestId`.
8. **`config/env.ts`** — `LOG_LEVEL` validacija (neispravna vrijednost = greška pri startu);
   `.env.example` + `.env.coolify` dobili isti ključ.
9. **Testovi** — `json-logger.spec.ts` (5), `request-log.middleware.spec.ts` (4), `redact`/
   `resolveLogLevel` (2 u `json-logger.spec.ts`), `env.spec.ts` (+1), `app-exception.filter.spec.ts`
   (prebačen sa `console.error` na JSON izlaz), e2e `health` (+1: validan ID se vraća, neispravan
   se zamjenjuje UUID-jem).

**Odbačene alternative:** `pino`/`pino-http` i `nestjs-pino` — dvije do tri nove zavisnosti i
transport konfiguracija za isti izlaz koji Coolify čita sa stdout-a (P6/D‑006 traži pisano
obrazloženje; vidi D‑038). Zadržano: `console.error/warn` dozvoljen guardrail-om (bootstrap).

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Unit testovi | `npx jest` | **206/206 ✅** (34 suite-a; +12) |
| Tipovi | `tsc --noEmit -p tsconfig.json` (filtrirano) | ✅ (samo `generated/client` artefakti) |
| Lint | `npx eslint` (filtrirano na `no-unsafe-*`) | ✅ |
| Format | `npx prettier --check` | ✅ |
| Guardovi | `node scripts/standards/check-all.mjs` | ✅ (i `check:env` sa novom varijablom) |
| E2E | `health`: `x-request-id` se vraća kad je validan i zamjenjuje kad nije | vidi §10 |

## 8. Rizici i rollback

- **Rizik:** JSON linije su duže od tekstualnih (Coolify/Docker rotacija po veličini fajla) —
  prihvatljivo; rotaciju i drain podešava Coolify (dokumentovano u INFRASTRUCTURE).
- **Rizik:** `redact()` je po imenu ključa — vrijednost koja sadrži email bez ključa `email`
  (npr. `msg: 'login radnik@x'`) neće biti očišćena. Zato je pravilo: **ne logujemo slobodne
  stringove sa podacima korisnika**, a `msg` je kratka poruka događaja; revizija ide u `AuditLog`.
- **Rizik:** `x-request-id` prihvaćen od klijenta omogućava podmetanje ID-a u log (log injection je
  spriječen regexom + JSON enkodiranjem); nema uticaja na autorizaciju.
- **Rollback:** `git revert` koda (nema migracije); `LOG_LEVEL=error` smanjuje obim bez izmjene
  koda. `app.useLogger`/`app.use` se uklanjaju u jednom redu ako JSON izlaz smeta.

## 9. Dokumentacija

- [x] `docs/BACKEND.md` §5 (logovanje) + nova §5.1 (format, korelacioni ID, PII pravilo, `LOG_LEVEL`, zašto bez `pino`)
- [x] `docs/INFRASTRUCTURE.md` §1 (observability red) i §5 (env katalog: `LOG_LEVEL`); dug I1 zatvoren
- [x] `docs/DECISIONS.md` **D-038** (JSON logger bez `pino`, odbačene alternative, posljedice)
- [x] `AUDIT/segments/INF-04.md` (ovaj dokument), `AUDIT/STATE.md`, `scripts/audit/segments.json`, matrica

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-03 |
| Commit(ovi) | `b526334` (kod + testovi + docs + matrica), `fix(logging)` (tipiziran `JSON.parse` u specovima) |
| CI run | ⚠️ `41658795448` — 5/6: `Backend (lint)` pao na 11 `no-unsafe-*` (JSON.parse → `any`) · ✅ **`41659369533`** — **6/6** zelen |
| Status | `done` |
