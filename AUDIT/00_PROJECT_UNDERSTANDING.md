# 00 — Razumijevanje projekta (FAZA 0)

| | |
|---|---|
| **Datum** | 2026-11-02 |
| **Grana** | `arena/0bc0e56e-gradix` |
| **HEAD pri izradi** | `5679a4b` (CI run 41495269647 — ✅ zelen) |
| **Metod** | čitanje repozitorija i dokumentacije, bez izmjena koda |
| **Status dokumenta** | nacrt za KAPIJU 1 (čeka odobrenje/odgovore) |

> Oznake u tekstu: **[K]** = potvrđeno čitanjem koda, **[D]** = tvrdnja iz dokumentacije
> (nije provjerena u kodu), **[?]** = nejasno / traži odluku vlasnika.

---

## 1. Šta sistem radi

Gradix je **višefirmni (multi-tenant) operativni sistem za niskogradnju**. Pokriva tri
površine [K]:

1. **Ured (web panel, Vite/React)** — firme, korisnici i role, projekti sa fazama i
   predmjerom, zadaci i dispečing, timer (radni sati), flota (mašine, ture, gorivo, GPS),
   dnevnik građenja, HSE incidenti, tenderi, servis mašina, dokumenti sa istekom, fiksni
   izvještaji, obračun sati (payroll export `.xlsx`), ERP-lite (partneri, troškovi, lager).
2. **Teren (Expo mobilna aplikacija)** — login, tabovi (zadaci, ture, dnevnik, profil),
   timer start/pauza/stop, ture i gorivo, HSE prijava, **offline-first** rad (SQLite +
   sync engine sa push/pull i katalogom TTL 24 h).
3. **Javni one-page firme** (`/p/:slug`) — brendirani javni profil firme sa whitelistanim
   podacima (bez `taxId`, budžeta i GPS-a).

**Aktori/role** [K u `common/rbac/roles.ts`]: `PLATFORM_ADMIN` (operator instalacije, bez
firme), `SUPER_ADMIN`, `ADMIN`, `PROJECT_MANAGER`, `SITE_SUPERVISOR`, `WORKER`, `DRIVER`,
`MACHINE_OPERATOR`, `MECHANIC`, `ACCOUNTANT`. Role su N:M (`UserRoleAssignment`), a
efektivne permisije su **unija** [K: `common/rbac/role-permissions.ts`].

**Tenant model** [K]: svaki poslovni zapis nosi `companyId`; jedan korisnik = jedna firma;
`PLATFORM_ADMIN` radi nad tuđom firmom samo uz header `X-Company-Id`.

---

## 2. Mapiranje repozitorija

| Putanja | Sloj | Stack | Obim [K] | Uloga |
|---|---|---|---|---|
| `backend/` | API | NestJS 11, TypeScript (strict), Prisma 7 + `@prisma/adapter-pg` | 232 `.ts` u `src/`, ~16.0k LOC; 40 kontrolera / 166 HTTP ruta | REST API, WebSocket, cron, fajlovi (MinIO), Swagger |
| `frontend/` | Web | React 19, Vite 8, Tailwind 4, shadcn/Radix, TanStack Query, Zustand, react-router 7 | 115 fajlova u `src/`, ~8.6k LOC; 24 stranice | Panel + javni sajt |
| `mobile/` | Teren | Expo SDK 57, RN 0.86, expo-router, expo-sqlite, Zustand, i18next | 63 fajla, ~1.7k LOC | Offline-first aplikacija |
| `backup/migrations/` | Istorija | stari **MySQL** migracije (9 fajlova) | — | Arhiva prije prelaska na PostgreSQL [K] |
| `.cursor/` | Plan | planovi faza 1–11, matrice (32 feature), DECISIONS, DOMAIN, rules | ~50 `.md` | Stara „izvor istine“ dokumentacija [D] |
| `docker-compose.yml`, `Dockerfile`, `Dockerfile.frontend`, `backend/Dockerfile`, `frontend/Dockerfile` | Infra | Docker multi-stage | — | Produkcijski deploy (Coolify) |
| `.github/workflows/ci.yml` | CI | GitHub Actions | 1 workflow, 5 jobova | Lint/test/build/docker gate |
| `DEPLOYMENT_COOLIFY.md`, `ENV_LIST.md`, `ANALIZA_I_PLAN_PRODUKCIJA.md`, `redis-cli-command.md` | Docs | — | ~85 kB | Postojeća dokumentacija (djelimično zastarjela) |
| `AUDIT/` | Novi audit | — | ovaj dokument | Novi izvor istine (u izradi) |

**Nema** `scripts/`, `docs/`, ADR foldera, `CONVENTIONS.md`, `TESTING.md`, `CI.md` [K].
Nema `eas.json` ni bilo kakvog mobile test setupa [K].

---

## 3. Tehnološki stack po sloju

### Backend [K: `backend/package.json`]
- Node 22 (Alpine u Dockeru), NestJS 11, `@nestjs/schedule` (cron), `@nestjs/websockets` +
  Socket.IO, `@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/jwt`, Passport JWT.
- Prisma **7.9** sa **driver adapterom `@prisma/adapter-pg`**; klijent se generiše u
  `backend/generated` (van `node_modules`), `moduleFormat: cjs`.
- Validacija: `class-validator` + `class-transformer` (globalni `ValidationPipe` sa
  `whitelist` + `forbidNonWhitelisted`).
- Lozinke: **Argon2id**; MinIO SDK; ExcelJS (payroll export); PDF-lib (dnevnik PDF).

### Frontend [K: `frontend/package.json`]
- React 19.2, Vite 8, TypeScript 6, Tailwind 4 (`@theme inline` tokeni u `src/index.css`),
  Radix (`radix-ui`), `class-variance-authority`, `sonner`, `lucide-react`.
- State: Zustand (`auth-store`, `company-store`) + TanStack Query za server state.
- Forme: `react-hook-form` + `zod`. i18n: i18next (bs/en, više namespace-ova).
- Lint: **oxlint** (ne ESLint). Testovi: samo Playwright (`e2e/login.spec.ts` — 1 spec).

### Mobile [K: `mobile/package.json`]
- Expo ~57, React Native 0.86, React 19.2, expo-router, expo-sqlite (offline), expo-secure-store,
  expo-location, expo-image-picker/manipulator, i18next, Zustand.
- **Nema** testova, nema EAS konfiguracije, nema CI joba za mobile [K].

### CI [K: `.github/workflows/ci.yml`]
- Okidači: `push` na `main` + `arena/**`, **`pull_request`** (⚠️ u suprotnosti sa novim
  pravilima), `workflow_dispatch`.
- Jobovi: `backend` (lint/test/build), `backend-e2e` (Postgres servis + migracije + seed +
  16 e2e spec-ova), `frontend` (oxlint/tsc/build), `web-e2e` (živi backend + `vite preview`
  + Playwright), `docker` (compose validacija + build oba image-a + MinIO healthcheck +
  seed iz produkcijske slike + SSL preflight + smoke testovi).
- Nema coverage praga, nema secret/dependency skena, nema mobile joba, nema audit gate-a.

---

## 4. Arhitektura backenda

**Kompozicioni korijen** [K: `src/app.module.ts`]: 16 modula (`prisma, audit, realtime,
health, auth, users, companies, settings, notifications, files, ops, mail, polish, public,
payroll, erp`) + 5 **globalnih guardova** u lancu:

`OptionalThrottlerGuard` → `JwtAuthGuard` → `PasswordChangeGuard` → `TenantGuard` →
`PermissionsGuard`.

**Cross-cutting** [K: `src/app.setup.ts`]:
- globalni prefiks `api`; Helmet; CORS iz `CORS_ORIGIN` (prazno ⇒ `origin: true`);
- `ValidationPipe` → greške se prevode u `AppError(VALIDATION_FAILED)`;
- `AppExceptionFilter` + `EnvelopeInterceptor`: odgovor je uvijek
  `{ success, data, meta }` / `{ success: false, error: { code, message } }`;
- Swagger na `/api/docs` (Bearer auth).

**Prisma** [K: `src/modules/prisma/prisma.service.ts`]: `PrismaClient` sa `PrismaPg`
adapterom, `DATABASE_URL` se čita direktno iz `process.env` (baca ako nedostaje).

**Konfiguracija** [K]: `ConfigModule.forRoot({ isGlobal: true })` **bez** `validationSchema`.
Tajne se čitaju `getOrThrow` na mjestu upotrebe (`JWT_ACCESS_SECRET` u auth/realtime,
`MINIO_*` u `MinioService`). Jedini direktni `process.env` pozivi: `DATABASE_URL`,
`CORS_ORIGIN`, `PORT`, `NODE_ENV`, `MINIO_SKIP`, `JEST_WORKER_ID`.

**Model grešaka** [K]: `AppError` + zatvoren katalog `ERROR_CODES` (`common/errors/`).
Nema centralnog mapiranja Prisma grešaka (`P2002` i sl.) u domenske kodove — vidi FAZA C.

**Cron** [K] — 4 posla, svi se sami isključuju pod Jestom:
`timer-cron` (auto-close 12 h), `docs-cron` (istek dokumenata 30/15/5), `service-cron`
(servis po satima), `gps-cleanup`.

**Realtime** [K]: `AppGateway` (Socket.IO na istom HTTP serveru), JWT u handshake-u,
sobe `project:{id}` se dodjeljuju **server-side**.

**Fajlovi** [K]: MinIO klijent, `ensureBucket()` sa 10 pokušaja × 3 s na startu modula
(`MINIO_SKIP=true` ga preskače u testovima), putanje moraju počinjati `{companyId}/`.

**Health** [K]: `GET /api/health` = `SELECT 1` na Postgresu → `{ process: 'ok', postgres: 'ok' }`.
Nema zasebnog readiness/liveness para, nema provjere MinIO-a.

**Testovi** [K]: `backend/test/*.e2e-spec.ts` — **16** spec fajlova (auth, erp, files, fleet,
health, iot, ops-core, ops-web, payroll, polish, projects, public, sync, tenant, users,
users-rbac) + helperi (`create-app`, `auth`, `minio-memory`). **Unit testova ima 1**
(`src/modules/ops/timer-math.spec.ts`). Nema coverage praga.

---

## 5. Model podataka

- Šema podijeljena u 6 fajlova [K]: `foundation`, `ops`, `fleet`, `polish`, `erp`,
  `public` — ukupno **1.115** linija Prisma šeme.
- **Jedna** aktivna migracija: `20261102130000_init_postgres` (1.333 linije SQL-a) [K].
  Sve starije (MySQL) migracije su **premještene** u `backup/migrations/` [K].
- Tenant: `Company` + `companyId`; `Setting` per firma (registry sa defaultima);
  `AuditEvent` (zatvoren skup akcija); `Notification` (zatvoren enum; in-app + socket).
- Domenski ključni entiteti: `Project`/`ProjectPhase`/`Task`/`ProjectAssignment`/
  `TimerSession`/`QuantityItem`/`Amendment`, `Machine`/`Trip`/`FuelEntry`/`GpsRecord`/
  `UserLocation`/`GpsDevice`, `DiaryEntry`/`Incident`, `Tender`/`ServiceRecord`/dokumenti,
  `Partner`/`CostEntry`/`Warehouse`/`StockMovement`, `PublicAsset`.
- Konvencije iz dokumenata [D, `PLAN_FREEZE.md`]: datumi UTC + prikaz u `app.timezone`
  (`Europe/Sarajevo`), novac `Decimal` (BAM), paginacija `page/limit` (20/100), lozinka min 10.

---

## 6. Frontend (web)

- Ulaz: `App.tsx` → `appRoutes` (`src/routes/app-router.tsx`); guard komponente
  `RequireAuth`, `RequirePermission`, `RequireAnyPermission`, `RequirePayroll`,
  `PublicOnly`, `CatchAllRedirect` [K].
- **24 stranice** [K: `src/pages/`]: login/forgot/reset/change-password, dashboard, projects,
  project-detail, tasks, task-detail, fleet, fleet-map, logistics, diary, documents, hse,
  tenders, services, reports, payroll, erp, settings, users, companies, public-site.
- Layout: `AppShell` (sidebar + bell + user menu + company switcher), Sheet za `< md` [D].
- Tokeni: CSS varijable → Tailwind `@theme inline` (`--color-primary`, `--color-accent`, …);
  paleta iz `.cursor/rules` (primary `#1B365D`, background `#F4F1EA`) [?] da li je obavezujuća.
- Proxy: `/api` i `/socket.io` (dev i `preview`) [K: `vite.config.ts`]; u produkciji nginx
  (`frontend/nginx/default.conf.template`, `BACKEND_URL`).
- i18n: `bs` (default) + `en`, više namespace fajlova (osnovni + `ops`, `polish`, `payroll`, `erp`).
- Testovi: **1** Playwright spec (`e2e/login.spec.ts`); nema unit/component testova, nema a11y
  ni vizualne regresije [K].

---

## 7. Mobile

- Struktura [K]: `app/(tabs)/` (`index`, `tasks`, `trips`, `diary`, `profile`), `app/login`,
  `change-password`, `trip/new`, `fuel`, `hse`; `components/`, `lib/` (api, auth-store,
  secure, timer-actions, permissions, errors, compress-image, api-types), `sync/` (engine,
  net, queue), `db/client.ts` (SQLite), `hooks/`, `i18n/`.
- Offline: SQLite red čekanja + `sync/engine.ts` push/pull, katalog TTL 24 h [D+delimično K].
- Sigurnost tokena: `expo-secure-store` [K: `lib/secure.ts` postoji].
- Nema testova, nema `eas.json`, nema build profila, nema CI koraka [K].

---

## 8. Integracije i okruženja

| Integracija | Kako se koristi | Status |
|---|---|---|
| **PostgreSQL** (eksterni, mreža `db_net`) | `DATABASE_URL`; migracije pri startu kontejnera (`prisma migrate deploy`) | [K] radi u CI-ju; produkcija potvrđena kroz Coolify deploy |
| **MinIO** (S3, u compose-u) | `MINIO_*` env; bucket se kreira automatski; podaci na hostu `/mnt/shared-app-files/gradix/minio` | [K] healthcheck u CI-ju |
| **Redis** (eksterni, mreža `redis_net`) | Samo env varijable (`REDIS_*`), **kod ga ne koristi** | [K] mrtva konfiguracija za v1 |
| **Email** | `modules/mail/email.service.ts` — stub | [?] treba provjeriti u FAZI 1 |
| **FCM** | flagovano u dokumentaciji, bez implementacije | [D] |
| **Socket.IO** | notifikacije + sobe projekata | [K] |
| **Coolify** | Docker Compose resurs; 3 servisa (`minio`, `backend`, `frontend`), eksterne mreže, bez host portova, domeni po servisu | [K] |
| **GitHub Actions** | 5 jobova na push | [K] |

**Okruženja**: lokalno (bez Dockera: `npm run start:dev`; sa Dockerom: compose +
`docker-compose.local-ports.yml`) i **produkcija (Coolify)**. **Nema staging okruženja** [?].

---

## 9. Deployment model (kako danas radi)

1. Coolify povuče granu, izgradi `backend` i `frontend` image (multi-stage; `npm ci
   --include=dev` u deps fazi jer Coolify ubacuje `NODE_ENV=production`) [K].
2. `backend` start: `docker-entrypoint.sh` → **SSL preflight** (CA iz `DATABASE_URL`) →
   `prisma migrate deploy` → `node dist/src/main.js` [K].
3. `frontend` = nginx sa `default.conf.template` (proxy `/api`, `/socket.io` na `BACKEND_URL`) [K].
4. Seed **nije** automatski; dio je image-a (`dist/prisma/seed.js`) i pokreće se ručno jednom [K].
5. Blue/green: servisi ne objavljuju host portove (samo `expose`), Coolify proxy routa domene.
6. Host mapiranja: CA za bazu i Redis (`create_host_path: false`), MinIO podaci na hostu [K].

---

## 10. Postojeća dokumentacija — šta je šta

| Dokument | Sadržaj | Pouzdanost danas |
|---|---|---|
| `.cursor/docs/DECISIONS.md` | zaključane produktne odluke (auth, tenant, timer, ture, payroll…) | **[D]** najbogatiji izvor pravila; dio zastario (MySQL) |
| `.cursor/docs/DOMAIN.md` | glosar + entiteti po sloju + srećan put | [D] koristan, ali „MySQL 8“ i „Faza“ jezik |
| `.cursor/plans/gradix-core/*` | planovi faza 1–11 (LOCKED) + freeze + checklist + handoff | [D] istorijski; tvrdi „100 % implementirano“ |
| `.cursor/docs/matrices/**` | 32 matrice po feature-u + CHANGELOG | [D] detaljna pravila ponašanja |
| `.cursor/rules/00_project.mdc` | AI pravila (banned: PostgreSQL!, Next, Turborepo…) | **u konfliktu sa kodom** (kod je PostgreSQL) |
| `ANALIZA_I_PLAN_PRODUKCIJA.md` | analiza stanja (2026-10-18) + plan produkcijske spremnosti | djelimično zastarjelo (MySQL, „nema Dockerfile“, „samo MinIO“) |
| `DEPLOYMENT_COOLIFY.md` | aktuelni deploy (Coolify, mreže, TLS, seed, troubleshooting) | **najtačnije za infra** (ažurirano 2026-11-02) |
| `ENV_LIST.md` | katalog env varijabli | ažuriran 2026-11-02, ali i dalje sadrži MySQL/TLS ostatke |
| `redis-cli-command.md` | Redis CLI komande | [?] vjerovatno potpuno nebitno za v1 (Redis se ne koristi) |
| `backend/README.md` | **default NestJS starter README** | beskoristan za projekat (šum) |

---

## 11. Glavni tokovi (mapa za dalji audit)

| Tok | Ulaz | Ključna pravila | Gdje gledati |
|---|---|---|---|
| Login / refresh / temp lozinka | `POST /api/auth/*` | JWT samo `sub`; role iz DB; refresh rotacija + reuse detekcija; `mustChangePassword` gate | `modules/auth/*`, `common/guards/*` |
| Tenant i firme | `/api/companies`, `X-Company-Id` | header samo za PLATFORM_ADMIN; slug immutable; neaktivna firma ⇒ 401 | `modules/companies/*`, `tenant.guard.ts` |
| Projekti / zadaci / dispečing | `/api/projects`, `/api/tasks` | PM/SS vide samo dodijeljeno; WORKER nema listu projekata; terminalni statusi blokiraju write | `modules/ops/{projects,tasks,assignments}*` |
| Timer | `/api/timer/*` | jedan otvoren session po useru i po mašini; pauza ne teče; auto-close 12 h; sati mašine na close | `ops/timer*.ts`, `machine-hours.ts` |
| Ture / gorivo / GPS | `/api/trips`, `/api/fuel`, `/api/gps` | immutable poslije sync; ispravke kroz `Amendment`; geofence info-only | `ops/{trips,fuel,gps}*` |
| Dnevnik / HSE | `/api/diary`, `/api/incidents` | unique (firma, projekat, dan u TZ); max 20/5 foto; HSE online-only | `ops/diary*`, `ops/incidents*` |
| Payroll | `/api/payroll/*` | mjesec u TZ firme; SS/PM ne odobravaju sebe; export `.xlsx` | `modules/payroll/*` |
| Public sajt | `GET /api/public/:slug` | DTO whitelist; isti 404 za tuđi/nepostojeći slug | `modules/public/*` |
| IoT ingest | `POST /api/iot/gps` + `X-Device-Key` | 1 uređaj po mašini; ključ Argon2id + SHA-256 lookup; throttle | `ops/iot*`, `gps-devices*` |
| Offline sync (mobile) | `/api/sync/*` | unique (companyId, userId, deviceId, localId); TTL katalog 24 h | `ops/sync*`, `mobile/sync/*` |

---

## 12. Metrike (stanje na `5679a4b`)

| Metrika | Vrijednost |
|---|---|
| Backend `src` | 232 fajla, ~16.032 LOC, 40 kontrolera, 166 ruta |
| Backend testovi | 16 e2e spec-a (~2.632 LOC) + **1** unit spec |
| Frontend `src` | 115 fajlova, ~8.573 LOC, 24 stranice, 1 Playwright spec |
| Mobile | 63 fajla, ~1.744 LOC, 0 testova |
| Prisma | 1.115 LOC šeme / 1 aktivna migracija (1.333 LOC SQL) |
| CI | 1 workflow, 5 jobova, ~2,5 min po runu |
| Dokumentacija | ~50 `.md` fajlova; od toga 32 matrice + 14 planskih |

---

## 13. Šta je nejasno (ulaz za FAZU 1)

1. **MySQL vs PostgreSQL** — dokumentacija i `.cursor/rules` („banned: PostgreSQL“) tvrde
   MySQL; kod, migracija i compose su PostgreSQL. Migracija je izgleda namjerna (vidi
   `backup/migrations/`), ali nije zapisana kao odluka.
2. **`mustChangePassword` i seed** — `PLAN_FREEZE` kaže seed useri bez prisile promjene;
   `ANALIZA` ističe da je demo seed u produkciji rizik. Trenutno: seed je ručni, ali se
   njegovi korisnici mogu naći u produkciji.
3. **Email** — postoji `email.service.ts`; nije jasno je li stub ili radi (nema SMTP env-a).
4. **FCM/push** — dokumentacija flagovana; nema koda. Da li je u v1?
5. **Redis** — `REDIS_*` env postoji u compose-u, kod ga ne koristi. Namjerno? (freeze kaže
   „Redis/BullMQ van v1“.)
6. **Staging okruženje** — ne postoji; nije jasno da li je potrebno.
7. **Mobile u CI-ju** — nema testova ni build profila; nije jasno koji je cilj (Android prvo?).
8. **Paleta/dizajn** — `.cursor/rules` propisuje 6 boja; nije jasno je li to obavezujuće za
   redizajn admin dashboarda.
9. **Paginacija/sort standard** — dokumentacija traži `page/limit/sort/order`; treba
   provjeriti koliko ruta to stvarno poštuje (FAZA 1/C).
10. **`backup/migrations`** — da li se čuva trajno kao istorija ili se arhivira.

---

## 14. Pitanja vlasniku (blokiraju FAZU 2 — master plan)

> Pitanja su rangirana po uticaju. Uz svako je **preporuka**; čekam eksplicitnu odluku
> (pravilo 1) prije nego što bilo šta od toga uđe u plan.

| # | Pitanje | Opcije | Preporuka |
|---|---|---|---|
| P1 | **Baza: PostgreSQL je stvarnost, dokumentacija kaže MySQL.** Šta je važeće? | (a) PostgreSQL je konačan izbor i stara docs idu u `_retired`; (b) vraćanje na MySQL | **(a)** — kod, migracija i deploy su već PostgreSQL |
| P2 | **`.cursor/` dokumentacija** (plans, matrices, DECISIONS, rules) — penzionisati u cjelini ili zadržati matrice kao poslovna pravila? | (a) sve u `docs/_retired/.cursor/…` i pravila prepisati u novu dokumentaciju; (b) matrice ostaju „žive“ uz novi `DECISIONS.md` | **(a)** sa izuzetkom: **poslovna pravila iz matrica prenosim u novu dokumentaciju** (jedan izvor istine) |
| P3 | **Mobile scope u ovom ciklusu**: samo kod+testovi bez objave, ili i EAS build/profili? | (a) EAS build profili + E2E u CI-ju; (b) samo kod kvalitet + E2E, bez objave | **(b)** prvo, EAS kad se stabilizuje API |
| P4 | **Mobile E2E alat** | (a) Maestro (YAML, brz, radi na emulatoru); (b) Detox (dublja integracija, veći setup); (c) Appium | **(a) Maestro** za flow testove + Jest/RNTL za komponente |
| P5 | **Test strategija** — trenutno 1 unit test i 16 e2e. Cilj? | (a) piramida: unit za logiku + e2e za tokove; (b) ostati na e2e | **(a)**, sa coverage pragom koji raste postepeno (npr. 40 % → 70 %) |
| P6 | **Nove zavisnosti** (npr. `pino` za strukturisane logove, `zod`/`joi` za env validaciju, `supertest` već postoji) — dozvoljeno uz obrazloženje? | (a) da, uz unos u DECISIONS; (b) samo ručne implementacije | **(a)** uz obavezan zapis u `docs/DECISIONS.md` |
| P7 | **Staging**: potreban li je zaseban Coolify okružen (npr. `staging` grana/instanca)? | (a) da; (b) ne, CI je dovoljan | **(b) za sada** (CI već diže bazu + MinIO + build image-a) |
| P8 | **Admin dashboard redizajn** — smije li mijenjati paleta/tipografija iz `.cursor/rules`? | (a) zadržati paletu (samo dorada); (b) nova paleta po WCAG 2.2 AA | **(a)** zadržati brend, doraditi kontrast i tokove; dizajn predlog prije koda |
| P9 | **Seed u produkciji** — demo podaci smiju li ostati? | (a) seed samo za dev/demo, produkcija bez demo korisnika; (b) ostaviti | **(a)**: produkcijski seed svodi se na 1 platform admina |
| P10 | **`backup/` i stari MySQL artefakti** — čuvati ili arhivirati van repoa? | (a) ostati u `_retired`; (b) izbaciti iz repoa | **(a)** — pravilo „ništa se ne briše bez traga“ |

---

## 15. Šta slijedi

**FAZA 1** (dokumentacija vs. stvarnost): tabela tvrdnja → stvarno stanje → status →
`fajl:linija`, zaokružena provjera 5 oblasti (endpointi, moduli, ekrani, env, šema, auth),
premještanje stare dokumentacije u `docs/_retired/` sa banerima, `docs/_retired/INDEX.md`
i postavljanje skeleta nove dokumentacije (`ARCHITECTURE`, `INFRASTRUCTURE`, `BACKEND`,
`FRONTEND`, `MOBILE`, `TESTING`, `CI`, `CONVENTIONS`, `DECISIONS`).

**KAPIJA 1** — nakon FAZE 1 stajem i čekam odobrenje + odgovore na P1–P10.
