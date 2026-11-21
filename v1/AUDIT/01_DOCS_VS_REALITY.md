# 01 — Dokumentacija vs. stvarnost (FAZA 1)

| | |
|---|---|
| **Datum** | 2026-11-02 |
| **Grana** | `arena/0bc0e56e-gradix` |
| **HEAD pri izradi** | `e531ca2` (CI run 41498842533 — ✅) |
| **Metod** | brzi audit (ne dubinski): svaka tvrdnja provjerena `grep`-om u kodu; gdje nije bilo moguće
potvrditi ponašanje bez izvršavanja, označeno je „nepotvrđeno“ |

**Skraćenice statusa:** `✅ potvrđeno` · `⚠️ zastarjelo` (bilo tačno, više nije) ·
`❌ kontradikcija` (dokument tvrdi suprotno od koda) · `❓ nepotvrđeno` (treba izvršiti/dublji audit)

**Rezime:** 32 provjerene tvrdnje → **15 ✅**, **8 ⚠️**, **3 ❌**, **6 ❓**.
Najteže: cijela stara dokumentacija tvrdi **MySQL**, a sistem radi na **PostgreSQL**; i
`.cursor/rules` eksplicitno **zabranjuje** PostgreSQL.

---

## A) Infrastruktura

| # | Tvrdnja (izvor) | Stvarno stanje | Status | Dokaz |
|---|---|---|---|---|
| A1 | „Baza je **MySQL 8**, baza `gradix`“ — `.cursor/rules/00_project.mdc:14,68`; `PLAN_FREEZE.md`; `ANALIZA…md §3.5` | **PostgreSQL**: Prisma datasource `postgresql`, runtime `PrismaPg` adapter, migracija `init_postgres` | ❌ | `backend/prisma/schema/foundation.prisma:8` · `backend/src/modules/prisma/prisma.service.ts:2,16` |
| A2 | „`docker-compose.yml` sadrži **samo MinIO**“ — `ANALIZA…md §3.1`; `03_gap_analysis.md` | Compose ima `minio`, `backend`, `frontend`, 3 mreže (`gradix-net`, `db_net`, `redis_net`) | ⚠️ | `docker-compose.yml:29-…` |
| A3 | „**Nema Dockerfile** za backend/frontend“ — `ANALIZA…md §5.1` | Postoje 4 fajla (app + root kopije, CI provjerava identičnost) | ⚠️ | `backend/Dockerfile` · `frontend/Dockerfile` · `Dockerfile` · `Dockerfile.frontend` |
| A4 | „Seed **nije** u produkcijskoj slici“ — stari `DEPLOYMENT_COOLIFY.md §5` | Seed **jeste** u slici: `dist/prisma/seed.js`, build guard, CI ga pokreće iz image-a | ⚠️ | `backend/tsconfig.build.json:2-5` · `backend/Dockerfile:38-46` · `.github/workflows/ci.yml` („Seed iz produkcijske slike“) |
| A5 | „Nema `docker-compose.prod.yml` ni deploy joba“ — `ANALIZA…md §5.6` | Deploy **nije** u CI-ju (namjerna odluka: *CI bez deploy*), a produkcijski compose **postoji** i koristi se na Coolifyju | ⚠️ (pola zastarjelo) | `docker-compose.yml` · `ci.yml` (nema `deploy` joba) · `PLAN_FREEZE.md` („CI: test + build; nema auto-deploy“) |
| A6 | „Redis je van v1“ — `PLAN_FREEZE.md`, `DECISIONS.md` | Tačno za kod: `REdis` se ne koristi; ali compose **nosi** `REDIS_*` env i `redis_net` mrežu (mrtva konfiguracija) | ✅ + napomena | `grep -rn "redis" backend/src` → 0 · `docker-compose.yml` (`REDIS_*`, `redis_net`) |
| A7 | „Tajne se ne commituju“ — `.cursor/rules`, `HANDOFF.md` | `.env` je u `.gitignore`; u repou su samo predlošci (`change-me…`, `GradixSeed1`) | ✅ | `.gitignore:1` · `.env.example:13-16` |
| A8 | Stari deploy: fiksni host portovi 5173/3000/9001 | Servisi objavljuju **samo `expose`**; Coolify blue/green ne dozvoljava fiksne portove | ⚠️ | `docker-compose.yml` (`expose`) · `ci.yml` (guard „Objavljenih host portova: 0“) |
| A9 | „Nema CA mount-a, TLS se rješava ručno“ — stari `DEPLOYMENT…§4` | Compose mapira CA za bazu i Redis (`create_host_path: false`) + entrypoint **SSL preflight** | ⚠️ | `docker-compose.yml` (volumes) · `backend/docker-entrypoint.sh:11-24` |

## B) Backend

| # | Tvrdnja (izvor) | Stvarno stanje | Status | Dokaz |
|---|---|---|---|---|
| B1 | „Swagger na `/api/docs`“ — `CHECKLIST.md` (1.8) | Postoji, sa globalnim prefiksom `api` | ✅ | `backend/src/app.setup.ts:55-57` |
| B2 | „Envelope `{success,data,meta}` / `{success:false,error:{code,message}}`“ — `PLAN_FREEZE.md` | Centralni interceptor + exception filter | ✅ | `common/interceptors/envelope.interceptor.ts` · `common/filters/app-exception.filter.ts` |
| B3 | „Throttle `/login` 5/min“ — `DECISIONS.md` | `/login` 5/min, `/refresh` 20/min (`@Throttle`) | ✅ | `modules/auth/auth.controller.ts:26,34` |
| B4 | „Health provjerava samo aplikaciju“ — `ANALIZA…§5.3` | Health radi `SELECT 1` na Postgresu → `{process, postgres}` (nema MinIO provjere, nema readiness para) | ⚠️ | `modules/health/health.service.ts:7-12` |
| B5 | „Paginacija: page 1, limit 20, max 100“ — `PLAN_FREEZE.md` | Tačno; prekoračenje ⇒ `PAGINATION_LIMIT` 400 | ✅ | `common/constants.ts:5-7` · `common/utils/pagination.ts:25-31` |
| B6 | „JWT nosi samo `sub`“ — `DECISIONS.md` | Tačno (`jwt.sign({ sub: userId })`) | ✅ | `modules/auth/auth-tokens.service.ts:23` · `auth/jwt.strategy.ts:12` |
| B7 | „`mustChangePassword` blokira sve osim `/me`, change-password, logout“ — `PLAN_FREEZE.md` | Globalni `PasswordChangeGuard` | ✅ | `common/guards/password-change.guard.ts` · `app.module.ts:56` |
| B8 | „Email postoji kao kanal“ — `DECISIONS.md` („Email + FCM flagovani“), `email.service.ts` | **Stub**: `trySend()` samo inkrementira brojač, nema SMTP/API poziva; gate je `Setting features.email` | ❌ (docs impliciraju funkcionalnost) | `modules/mail/email.service.ts:13-31` |
| B9 | „9 migracija; nedostaju `phase_03` i `phase_09`“ — `ANALIZA…§3.5` | **1** migracija: `20261102130000_init_postgres`; stari MySQL set premješten u `backup/migrations/` | ⚠️ | `backend/prisma/migrations/` |
| B10 | „Nema unit testova, 16 e2e“ — `ANALIZA…§3.2` | 16 e2e ✅ + **1 unit** (`timer-math.spec.ts`); nema coverage praga | ⚠️ (dopuna) | `backend/test/*.e2e-spec.ts` · `src/modules/ops/timer-math.spec.ts` |
| B11 | „PM/SS vide samo dodijeljene projekte“ — `DECISIONS.md` | Postoji centralizovan scope helper (`common/scope/*`); **ponašanje nije provjereno** izvršavanjem | ❓ | `common/scope/scope-by-project.ts`, `scope/…` |
| B12 | „Config se validira pri startu“ (standard koji tek uvodimo) | `ConfigModule.forRoot({ isGlobal: true })` **bez** `validationSchema`; tajne pucaju tek na mjestu upotrebe (`getOrThrow`) | ❓ propust | `app.module.ts:30` · `modules/auth/auth.module.ts:18` |
| B13 | „Svaki endpoint ima auth pravilo“ — `DECISIONS.md`/`rules` | 166 ruta, 40 kontrolera; globalni guardovi postoje, ali **javne rute se označavaju ručno** (`@Public()`) — nije automatizovano provjereno | ❓ | `common/decorators/public.decorator.ts` |

## C) Frontend

| # | Tvrdnja (izvor) | Stvarno stanje | Status | Dokaz |
|---|---|---|---|---|
| C1 | „23 stranice“ — `ANALIZA…§3.3` | **24** stranice (+`change-password-page`) | ⚠️ | `frontend/src/pages/` (24 fajla) |
| C2 | „Playwright pokriva login“ — `CHECKLIST.md` (7.4) | Tačno: **1** spec (`login.spec.ts`), nema tokova za timer/ture/payroll | ✅ | `frontend/e2e/login.spec.ts` · `frontend/playwright.config.ts` |
| C3 | „Lint = ESLint“ (implicitno u docs) | Lint je **oxlint** (brz, Rust); pravila u `.oxlintrc.json` | ⚠️ | `frontend/package.json:8` · `frontend/.oxlintrc.json` |
| C4 | „Web je **light-only**“ — `PLAN_FREEZE.md` (Faza 3) | Tačno u praksi (nema `.dark` klase u kodu), ali CSS **definiše** dark varijantu (`@custom-variant dark`) — mrtva grana | ✅ (uz napomenu) | `frontend/src/index.css:4` · `grep "\.dark" frontend/src` → 0 |
| C5 | „shadcn/Radix komponente“ — `DOMAIN.md`/plans | Radix + `components.json` + CVA | ✅ | `frontend/components.json` · `frontend/package.json` |
| C6 | „WCAG 2.2 AA“ (novi zahtjev, P8) | Nema axe testova, nema a11y skripte, nema fokusa na kontrast u tokenima | ❓ propust | `grep -rn "axe" frontend` → 0 |

## D) Mobile

| # | Tvrdnja (izvor) | Stvarno stanje | Status | Dokaz |
|---|---|---|---|---|
| D1 | „Expo SDK 57“ — `mobile/AGENTS.md`, plans | Tačno (`expo ~57.0.13`, RN 0.86); `app.json` verzija `0.6.0` | ✅ | `mobile/package.json` · `mobile/app.json:2-4` |
| D2 | „Nema mobile testova ni build profila“ — `ANALIZA…§5.5` | Potvrđeno: nema `eas.json`, nema test foldera, nema CI koraka | ✅ | `mobile/` (63 fajla, bez testova) |
| D3 | „HSE je online-only“ — `PLAN_FREEZE.md` | Ekran koristi `useOnline()` i šalje odmah (bez reda za sync) — **nije** provjereno izvršavanjem | ✅ (kod) / ❓ (test) | `mobile/app/hse.tsx:16` |
| D4 | „Offline sync radi (push/pull, TTL 24h)“ — `CHECKLIST.md` (6.2) | Kod postoji (`sync/engine.ts`, `queue.ts`, SQLite), **bez testova** | ❓ | `mobile/sync/*` · `mobile/db/client.ts` |

## E) CI/CD

| # | Tvrdnja (izvor) | Stvarno stanje | Status | Dokaz |
|---|---|---|---|---|
| E1 | „CI radi lint + test + build, **bez deploya**“ — `PLAN_FREEZE.md` | Tačno; 5 jobova, deploy nema | ✅ | `.github/workflows/ci.yml` |
| E2 | „Okidači: push na `main`/`arena/**` + **pull_request**“ — `ci.yml:5-10` | U sukobu sa novim pravilima („push isključivo na aktivnu granu, bez PR-a“) — mijenja se u segmentu **CI-01** | ❌ (prema novim pravilima) | `ci.yml:5-10` |
| E3 | „CI diže bazu + MinIO + migracije + seed prije testova“ — `DEPLOYMENT_COOLIFY.md §7` | Tačno (Postgres servis, MinIO iz compose-a sa healthcheckom, seed iz image-a) | ✅ | `ci.yml` (jobovi `backend-e2e`, `web-e2e`, `docker`) |
| E4 | „Nema coverage praga, secret skena, dependency audita, mobile joba“ — `ANALIZA…§5.6` | Potvrđeno | ✅ | `ci.yml` |

---

## Posljedice i plan prenosa u novu dokumentaciju

1. **MySQL → PostgreSQL** je jedina ❌ koja mijenja arhitekturu dokumentacije. Odlukom **P1**
   PostgreSQL je konačan; svi spominjanja MySQL-a idu u `_retired` i **ne** se prenose.
2. Poslovna pravila iz `.cursor/docs/matrices/**`, `DECISIONS.md` i `PLAN_FREEZE.md`
   **ostaju važeća** i prenose se u novu dokumentaciju (odluka **P2a**):
   – backend pravila → `docs/BACKEND.md`, – dizajn/UX → `docs/FRONTEND.md`,
   – mobilni tokovi → `docs/MOBILE.md`, – sve odluke → `docs/DECISIONS.md`.
3. Zastarjele infrastrukturne tvrdnje (A2–A5, A8, A9) zamjenjuje `docs/INFRASTRUCTURE.md`
   napisan iz **stvarnog** compose-a, Dockerfile-ova i CI-ja.
4. Propusti (B12 env validacija, B13 auth pokrivenost, C6 a11y, E2 PR trigger, E4 guardrail-i)
   ulaze u **FAZU 2** kao zasebni segmenti; ništa se ne mijenja u FAZI 1.

## Šta ide u `_retired`

Sve iz `docs/_retired/INDEX.md`. Nijedan penzionisani dokument se **ne briše**; novi dokumenti
smiju na njega linkovati isključivo kao historijski kontekst.
