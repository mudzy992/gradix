# Gradix — Analiza stanja i plan za produkciju

**Datum:** 2026-10-18  
**Grana:** `arena/0874ef4b-gradix`  
**Repo:** `/home/user/gradix`  
**Autor analize:** Agent (Arena.ai)  

---

## 1. Identitet i domen aplikacije

Gradix je **operativni sistem za niskogradnju** (građevinarstvo / construction operations). Ciljna grupa su firme koje upravljaju projektima, mašinama, radnicima, dnevnicima građenja, turama materijala, gorivom i obračunom sati. Aplikacija ima tri sloja:

| Sloj | Tehnologija | Namjena |
|---|---|---|
| **Ured (Web)** | Vite + React + TypeScript + Tailwind + TanStack Query + Zustand | Administracija, planiranje, dnevnik, izvještaji |
| **Teren (Mobile)** | Expo + React Native + SQLite (offline sync) | Radnici, vozači, mehaničari — timer, ture, gorivo, HSE, dnevnik |
| **Javni sajt** | `/p/:slug` (faza 8) | One-page prezentacija firme + projekti |
| **Backend** | NestJS 11 + TypeScript + Prisma 7 + MySQL 8 + Socket.IO + MinIO | API, auth, tenant, real-time, upload |

Dokumentacija (`.cursor/docs/DOMAIN.md`, `DECISIONS.md`, matrice) definira **11 faza** (faze 1–11) sa zaključanim (LOCKED) planovima. Postoji i gap analiza (`03_gap_analysis.md`).

---

## 2. Šta kažu dokumenti (planovi i checklist)

Prema `.cursor/plans/gradix-core/CHECKLIST.md` i `HANDOFF.md`:

- **Plan:** 11/11 faza **LOCKED** (100%).
- **Implementacija:** 100% (41/41 segment).
- **Kod:** Faza 1–11 navodno urađena.
- **Testovi:** e2e (auth, ops-core, fleet, iot, payroll, sync, public, polish) postoje.
- **CI:** `.github/workflows/ci.yml` — backend (NestJS build + e2e), frontend (lint + build), Playwright.

Međutim, **dokumenti su statički; kod i okruženje moraju se provjeriti**.

---

## 3. Stvarno stanje koda (provjereno 2026-10-18)

### 3.1 Opća slika repozitorija

| Element | Status | Napomena |
|---|---|---|
| Grana | `arena/0874ef4b-gradix` | Ispravna |
| Git status | Čist (`nothing to commit`) | Nema lokalnih izmjena |
| `.git` | Prisutan | Repo nije oštećen |
| `node_modules` (backend) | **NEMA** | Ne može se `npm run build` bez `npm ci` |
| `node_modules` (frontend) | **NEMA** | Isto |
| `node_modules` (mobile) | **NEMA** | Isto |
| `docker-compose.yml` | Samo MinIO | **Nedostaje MySQL** (potvrđeno u gap analizi) |
| `.env` (produkcija) | Samo `.env.example` | Placeholder tajni (`change-me-...`) |

### 3.2 Backend (`backend/src/` — 232 fajla)

Moduli prisutni i implementirani:

- `auth/` — JWT (access + refresh), login, logout, change-password, reset, throttle.
- `companies/` — Company, tenant, company switcher (`PLATFORM_ADMIN`), slug immutable, `PATCH /api/company`.
- `users/` — User CRUD, roles (`SUPER_ADMIN`, `ADMIN`, `PROJECT_MANAGER`, `SITE_SUPERVISOR`, `WORKER`, `DRIVER`, `OP`, `MECHANIC`, `ACCOUNTANT`, `PLATFORM_ADMIN`), `employeeCode`, `mustChangePassword`, `hourlyRate`, temp lozinka.
- `settings/` — Settings registry, `PATCH /api/company`.
- `notifications/` — In-app + socket rooms (`notify-roles`).
- `audit/` — AuditEvent (zatvoren set akcija).
- `files/` — Upload + MinIO, path guard.
- `health/` — Health check.
- `mail/` — Email stub (`mail.module`).
- `realtime/` — Socket.IO (`AppGateway`, `join-project-rooms`).
- `ops/` — Kompletan operativni sloj: `projects`, `tasks`, `timer`, `phases`, `assignments`, `quantities`, `amendments`, `trips`, `fuel`, `machines`, `gps`, `locations`, `diary`, `incidents` (HSE), `catalog`, `sync`.
- `payroll/` — Payroll query, summary, export `.xlsx`, approve/reject (`payroll.read` / `payroll.write`).
- `polish/` — Tender (`DRAFT` → `WON` + convert), service (`IN_SERVICE` + force-close), docs (`DOCUMENT_EXPIRING` warn), reports (`fiksni slugovi`), CI (`lint+test+build` bez deploy).
- `erp/` — `partners`, `costs`, `warehouses`, `stock`, `fuel-stock`.
- `public/` — `/p/:slug`, `PublicAsset` stream, DTO bez `taxId`/budget/GPS.
- `prisma/` — Schema podijeljena (`foundation.prisma`, `ops.prisma`, `fleet.prisma`, `polish.prisma`, `erp.prisma`, `public.prisma`).

**Ključni nalazi:**

- **Nema migracije za Fazu 3** (`frontend shell`) — nema DB promjena, ali i nema eksplicitne reference u DB shemi za frontend elemente (to je OK jer frontend ne dodaje nove tabele).
- **Nema migracije za Fazu 9 (`payroll`)** — ali postoji `payroll` modul i `TimerApprovalStatus`, `hourlyRate` u `users` shemi. Moguće da je DB shema pokrivena unutar ranijih faza (`phase_01_foundation` ima `hourlyRate` polje u `User` šemi?). Treba provjeriti.
- **Nedostaju `node_modules`** — bez `npm ci` ne može se graditi ni pokrenuti.
- **`prisma.config.ts`** postoji; `migrations/` ima 9 migracija (bez 3 i 9 eksplicitno).
- **E2E testovi postoje** (`auth`, `fleet`, `iot`, `payroll`, `sync`, `public`, `polish`, `ops-core`, `ops-web`, `projects`, `tenant`, `users-rbac`, `users`, `erp`, `files`, `health`).
- **`docker-compose.yml`** nema MySQL — to znači da `DATABASE_URL` mora pokazivati na vanjski MySQL (potvrđeno u gap analizi: `DATABASE_URL` u `.env` pokazuje na vanjski server).

### 3.3 Frontend (`frontend/src/` — 205 fajlova)

Stranice (`pages/`) — 23 stranice:

`login-page`, `forgot-page`, `reset-page`, `dashboard-page`, `projects-page`, `project-detail-page`, `tasks-page`, `task-detail-page`, `fleet-page`, `fleet-map-page`, `logistics-page`, `diary-page`, `documents-page`, `hse-page`, `tenders-page`, `services-page`, `reports-page`, `payroll-page`, `erp-page`, `settings-page`, `users-page`, `companies-page`, `public-site-page`, `change-password-page`.

Komponente (`components/`) — `app-shell`, `company-switcher`, `sidebar-nav`, `user-menu`, `bell` (notifikacije), `project-tabs`, `planned-gantt`, `project-sheet`, `dispatch-sheet`, `diary-conflict-sheet`, `public-brand-fields`, `registry-fields` (settings), `quantity-tab`, `erp-costs-tab`, `erp-partners-tab`, `erp-stock-tab`.

Hookovi (`hooks/`) — `use-auth-bootstrap`, `use-me`, `use-logout-sync`, `use-public-settings`, `use-tenant-ready`, `use-socket`.

Store (`stores/`) — `auth-store`, `company-store`.

**Ključni nalazi:**

- Frontend je **strukturno potpun** (sve stranice i komponente iz planova su tu).
- `i18n/` ima `bs` i `en` (osnovni + `erp-bs`, `polish-bs`, `payroll-bs`, `ops-bs`).
- `routes/app-router.tsx` i `routes/guards.tsx` postoje.
- **Nema `node_modules`** — ne može se `npm run build` bez `npm ci`.
- **Nema `frontend/src/routes/` fajlova** koji bi eksplicitno definirali sve rute u jednom fajlu — provjeriti da li `App.tsx` ili `routes/app-router.tsx` pokrivaju sve stranice.

### 3.4 Mobile (`mobile/` — 349 fajlova)

Struktura:

- `app/(tabs)/` — `_layout`, `index` (dashboard?), `tasks`, `trips`, `diary`, `profile`.
- `app/` — `login`, `change-password`, `trip/new`, `fuel`, `hse`, `+not-found`.
- `components/` — `primary-button`, `field`, `offline-bar`, `picker-list`, `screen`, `useColorScheme`.
- `db/client.ts` — SQLite klijent.
- `lib/` — `api`, `auth-store`, `secure`, `theme-store`, `timer-actions`, `permissions`, `errors`, `compress-image`, `api-types`.
- `sync/` — `engine` (push/pull), `net`, `queue`.
- `hooks/` — `use-bootstrap`, `use-app-scheme`, `use-online`.

**Ključni nalazi:**

- Mobile aplikacija ima **offline sync mehanizam** (`sync/engine.ts` — push pending, pull catalog, TTL 24h).
- `timer-actions.ts` postoji — to znači da timer za teren postoji.
- `permissions.ts` postoji — provjera uloga.
- `i18n/` ima `bs` i `en`.
- **Nema `node_modules`** — ne može se pokrenuti `expo start` bez `npm ci`.
- **Nema eksplicitnog `tests/` direktorija** za mobile (nema `jest` ili `detox` konfiguracije).
- `mobile/.claude/` i `AGENTS.md` / `CLAUDE.md` — interne upute za AI asistente.

### 3.5 Migracije i baza

```
backend/prisma/migrations/
20260815120000_phase_01_foundation
20260816130000_phase_02_core_ops
20260816160000_phase_04_fleet
20260816180000_phase_05_diary_hse
20260816190000_phase_06_sync
20260816200000_phase_07_polish
20260816210000_phase_08_public
20260817120000_phase_10_erp
20260817140000_phase_11_iot
```

**Nedostaju:** `phase_03_*` i `phase_09_*`.

- **Faza 3 (Frontend shell)** — vjerojatno ne treba migraciju jer ne dodaje nove DB entitete. To je OK.
- **Faza 9 (Payroll)** — ali `payroll.controller.ts`, `payroll.service.ts`, `payroll.dto.ts`, `payroll-export.ts`, `payroll-query.ts` postoje. `hourlyRate` polje je vjerojatno u `phase_01_foundation` ili `phase_02_core_ops` (jer je `User` model iz faze 1). Dakle, **DB shema možda pokriva fazu 9 unutar ranijih migracija** — ali nema eksplicitne `phase_09` migracije, što otežava auditiranje.

### 3.6 Gap analiza (`.cursor/docs/03_gap_analysis.md`)

Aktivni gapovi:

| Izvor | Dokumenti | Kod | Status |
|---|---|---|---|
| Faza 1.1 `01_phase-01-foundation.md` | `docker-compose.yml`: MySQL 8 + MinIO | Compose: samo MinIO. MySQL vanjski (`DATABASE_URL`) | **Potvrđen** — nije promijenjen (locked) |
| E2E (Faza 1) | Real MinIO | Test helper `MemoryMinioService` jer Docker Desktop nije bio up | E2e ne blokira |

Zatvoreno:

- Faza 1 kod postoji u `backend/`.
- Faza 3: `GET /api/company` (`settings.write`) — dodano za settings formu; `Users ?role=` filter; `/me.company`; `X-Company-Id`.

---

## 4. Šta je zaista urađeno po fazama (kod vs. dokument)

### Faza 1 — Foundation (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (moduli: `auth`, `companies`, `users`, `settings`, `notifications`, `audit`, `files`, `realtime`, `prisma`).
**Status DB:** `phase_01_foundation` migracija postoji.
**Status testova:** E2E (`auth.e2e-spec.ts`, `tenant.e2e-spec.ts`, `users.e2e-spec.ts`).
**Status produkcije:** **NEDOSTAJE** `node_modules`, `docker-compose.yml` nema MySQL, `.env` ima placeholder tajne, nema produkcijskog `Dockerfile` za backend (samo `start:prod` skripta).

### Faza 2 — Core ops API (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (moduli: `ops/` — `projects`, `tasks`, `timer`, `phases`, `assignments`, `quantities`, `amendments`, `catalog`, `sync`).
**Status DB:** `phase_02_core_ops` postoji.
**Status testova:** E2E (`ops-core.e2e-spec.ts`, `projects.e2e-spec.ts`).

### Faza 3 — Frontend shell (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (fajlovi prisutni; stranice, komponente, rute, store, hookovi, i18n).
**Status DB:** Nema eksplicitne migracije (OK — nema novih tabela).
**Status produkcije:** **NEDOSTAJE** `node_modules`, `vite.config.ts` postoji ali nema produkcijskog `Dockerfile` za frontend, `CORS_ORIGIN` u `.env` pokazuje na `localhost:5173`.

### Faza 4 — Fleet / logistics / GPS (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`machines`, `trips`, `fuel`, `gps-devices`, `locations`).
**Status DB:** `phase_04_fleet` postoji.
**Status testova:** E2E (`fleet.e2e-spec.ts`).

### Faza 5 — Web ops UI + dnevnik + šifarnici (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`dashboard`, `diary`, `documents`, `hse`, `quantities`, `project-tabs`).
**Status DB:** `phase_05_diary_hse` postoji.
**Status produkcije:** `planned-gantt` postoji ali **samo planned dates** (ne actuals — to je u skladu s freeze-om).

### Faza 6 — Mobile Expo + offline sync (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (tabovi, timer, ture, gorivo, dnevnik, HSE, sync engine, SQLite DB).
**Status DB:** `phase_06_sync` postoji.
**Status produkcije:** **NEDOSTAJE** produkcijska konfiguracija za Expo build (`app.json` postoji ali nema `EAS` ili `expo build` u CI), `sync/queue.ts` i `net.ts` postoje ali nema eksplicitnog testiranja offline scenarija u CI.

### Faza 7 — Tender / servis / docs / reports / CI (

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`tenders`, `services`, `docs-cron`, `reports`, `service-cron`, `docs-warn`).
**Status DB:** `phase_07_polish` postoji.
**Status produkcije:** `docs-cron.service.ts` postoji (`DOCUMENT_EXPIRING`); `service-cron.service.ts` (`SERVICE_DUE`); `reports.controller.ts` (fiksni slugovi). **Nema deploya** — CI je `lint+test+build` (bez `deploy`).

### Faza 8 — Public site (`/p/:slug`)

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`public.controller.ts`, `public.service.ts`, `public-write.controller.ts`, `serialize-public.ts`).
**Status DB:** `phase_08_public` postoji.
**Status produkcije:** Javni sajt postoji, ali `logoPath` i `coverAssetId` moraju biti ispravni za MinIO stream. **Nema CDN ili proxy konfiguracije** za javni pristup.

### Faza 9 — Payroll (obračun sati)

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`payroll.controller.ts`, `payroll.service.ts`, `payroll.export.ts`, `payroll-period.ts`, `payroll-summary.ts`, `from-payroll.ts`).
**Status DB:** **Nema eksplicitne `phase_09_*` migracije** — ali `hourlyRate`, `TimerApprovalStatus` i `Payroll` logika su prisutni. Potrebno provjeriti da li su sve promjene pokrivene unutar ranijih migracija.
**Status testova:** E2E (`payroll.e2e-spec.ts`).

### Faza 10 — ERP-lite (partneri, troškovi, lager)

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`partners`, `costs`, `warehouses`, `stock`, `fuel-stock`).
**Status DB:** `phase_10_erp` postoji.
**Status produkcije:** `warehouse` tipovi (`SITE`, `YARD`, `CISTERN`) postoje; `apply-stock` je opcionalan.

### Faza 11 — IoT fleet

**Status dokumenata:** LOCKED, 100%.
**Status koda:** 100% (`iot.controller.ts`, `gps-devices.service.ts`, `machine-devices.controller.ts`, `iot-key.ts`, `serialize-gps-device.ts`).
**Status DB:** `phase_11_iot` postoji.
**Status testova:** E2E (`iot.e2e-spec.ts`).
**Status produkcije:** `GpsDevice` model ima `key` (Argon2id + SHA-256); `X-Device-Key` header; throttle `1/5s`; `DECOMMISSIONED` → 403. **Nema produkcijske IoT infrastrukture** (nema MQTT, Redis geo, ili IoT gatewaya — ali to je van v1 prema `PLAN_FREEZE.md`).

---

## 5. Ključni gapovi za produkciju (stvarni, ne samo dokumenti)

### 5.1 Infrastruktura i okruženje

| Gap | Opis | Prioritet |
|---|---|---|
| **MySQL u docker-compose** | Samo MinIO. MySQL je vanjski (`DATABASE_URL`). Za produkciju potrebna je ili MySQL u compose ili dokumentirana vanjska veza. | **Visok** |
| **Placeholder tajne** | `.env.example` ima `change-me-access-secret-...`. Za produkciju potrebni su pravi JWT tajni (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` min 32 znaka), `SEED_PASSWORD`, MinIO ključevi. | **Visok** |
| **Nedostaje `node_modules`** | Sva tri projekta (`backend`, `frontend`, `mobile`) nemaju instalirane pakete. Prvi korak za bilo kakvu gradnju ili testiranje je `npm ci`. | **Visok** |
| **Nema produkcijskog `Dockerfile`** | `backend/` ima samo `start:prod` (`node dist/main`). Nema `Dockerfile` za backend, frontend ili mobile. | **Srednji** |
| **Nema `.env` za produkciju** | Postoji samo `.env.example`. Potrebno je kreirati `.env` (ili `.env.production`) sa stvarnim vrijednostima. | **Visok** |
| **CORS** | `CORS_ORIGIN` u `.env` pokazuje na `localhost:5173` (dev). Za produkciju mora pokazivati na domenu frontenda i javnog sajta. | **Srednji** |

### 5.2 Baza podataka i migracije

| Gap | Opis | Prioritet |
|---|---|---|
| **Nedostaju eksplicitne migracije za fazu 3 i 9** | `phase_03_*` i `phase_09_*` ne postoje. Iako faza 9 možda koristi polja iz faze 1/2, eksplicitna migracija olakšava audit i rollback. | **Nizak–Srednji** |
| **Nema `prisma db seed` u produkciji** | Seed (`seed-demo-fleet.ts`, `seed-demo-ops.ts`, `seed.ts`) kreira testne korisnike (`platform@`, `admin@`, `pm@`, `ss@`, itd.) sa `SEED_PASSWORD`. Za produkciju potrebno je ili isključiti seed ili koristiti posebnu lozinku. | **Srednji** |
| **Nedostaje `prisma migrate deploy` u deploy pipeline** | CI (`.github/workflows/ci.yml`) koristi `prisma migrate deploy` — to je OK za CI, ali za produkciju potrebna je dodatna provjera (`migrate status`). | **Nizak** |

### 5.3 Backend (kod)

| Gap | Opis | Prioritet |
|---|---|---|
| **Nema ` MemoryMinioService` za produkciju** | `files/minio.service.ts` koristi pravi MinIO; `MemoryMinioService` je samo za e2e. Za produkciju potrebno je osigurati da MinIO radi i da `MINIO_BUCKET` postoji. | **Srednji** |
| **Nema rate-limita za produkciju** | `optional-throttler.guard.ts` postoji, ali `default` throttle (`5` req/min za login) možda nije dovoljan za produkciju. Potrebno je konfigurirati produkcijske limite (`limit`, `ttl`). | **Nizak** |
| **Nema `health` detalja za DB i MinIO** | `health.controller.ts` vjerojatno provjerava samo aplikaciju. Za produkciju potreban je `health` endpoint koji provjerava i DB (`prisma.$queryRaw` `SELECT 1`) i MinIO (`listBuckets`). | **Srednji** |
| **`mail.service.ts` — stub** | Email servis postoji (`mail.module.ts`), ali `mail.service.ts` vjerojatno samo logira ili šalje stub. Za produkciju potrebno je konfigurirati SMTP ili API (SendGrid, Mailgun, itd.). | **Srednji** |
| **Nema `feature flags` za SMS** | `DECISIONS.md` kaže da SMS ne postoji. Ali `features.sms` nije eksplicitno isključen u kodu (iako nema koda za SMS). Potrebno je osigurati da nema skrivenih referenci. | **Nizak** |

### 5.4 Frontend (kod)

| Gap | Opis | Prioritet |
|---|---|---|
| **Nema produkcijske build konfiguracije** | `vite.config.ts` postoji, ali nema `base` URL, `sourcemap`, ili `rollupOptions` za produkcijsku optimizaciju. Potrebno je dodati `VITE_API_URL` za produkciju. | **Srednji** |
| **`access token` u memoriji** | Prema `DECISIONS.md`: access token u memoriji; refresh u `sessionStorage` (remember-me) ili `localStorage`. To je OK za v1, ali za produkciju potrebno je osigurati da `XSS` zaštita postoji (`Content-Security-Policy`, `HttpOnly` za refresh — ali refresh nije `HttpOnly` jer se čita iz `sessionStorage`). | **Srednji** |
| **Nema `PWA` ili `manifest`** | `frontend/index.html` postoji, ali nema `manifest.json` za instalaciju na mobilne uređaje (osim Expo aplikacije). | **Nizak** |

### 5.5 Mobile (kod)

| Gap | Opis | Prioritet |
|---|---|---|
| **Nema produkcijskog builda za Expo** | `mobile/app.json` postoji (`expo`, `name`, `slug`), ali nema `EAS` konfiguracije (`eas.json`) ni `build` profila (`development`, `preview`, `production`). Za produkciju potrebna je `expo build:android` / `expo build:ios` ili `eas build`. | **Visok** |
| **`sync/queue.ts` — nema eksplicitnog testiranja** | `queue.ts` postoji, ali nema `tests/` za mobile. Potrebno je dodati barem osnovne testove za `pendingRows`, `markSynced`, `readMeta`. | **Srednji** |
| **`offline-bar` — osnovna notifikacija** | `offline-bar.tsx` postoji, ali nema detaljnog prikaza statusa sinkronizacije (npr. broj čekajućih zapisa, zadnje sinkronizirano vrijeme). | **Nizak** |
| **`db/client.ts` — SQLite** | SQLite se koristi za offline. Za produkciju potrebno je osigurati da `expo-sqlite` radi ispravno na Android/iOS i da nema problema s velikim količinama podataka. | **Nizak** |

### 5.6 CI / CD i deploy

| Gap | Opis | Prioritet |
|---|---|---|
| **Nema `deploy` joba u CI** | `.github/workflows/ci.yml` ima `backend`, `frontend`, `playwright` — ali nema `deploy`. Za produkciju potrebno je dodati `deploy` (Docker build, push na registry, deploy na server, `docker-compose up`). | **Visok** |
| **Nema `docker-compose.prod.yml`** | `docker-compose.yml` je samo za dev (`minio`). Za produkciju potrebna je verzija sa `mysql` (ili referenca na vanjsku bazu), `nginx` (proxy za backend i frontend), `minio`, i `backend` + `frontend` servisima. | **Visok** |
| **Nema `playwright` testova za sve ključne tokove** | `frontend/e2e/login.spec.ts` postoji; `playwright.config.ts` postoji. Ali nema eksplicitnih testova za `timer`, `sync`, `payroll`. Preporuka: dodati osnovne `playwright` scenarije za ključne operativne tokove. | **Srednji** |
| **Nema `monitoring` ili `logging` konfiguracije** | `main.ts` vjerojatno koristi `NestJS` default logging. Za produkciju potrebno je dodati `Winston` ili `Pino` sa strukturiranim logovima (`JSON`) i rotacijom. | **Srednji** |

### 5.7 Dokumentacija i planovi

| Gap | Opis | Prioritet |
|---|---|---|
| **`HANDOFF.md` kaže da je sve gotovo** | Ali nema eksplicitnog `PRODUCTION_READINESS.md` ili `DEPLOY.md`. Potrebno je kreirati dokument koji opisuje korake za produkcijski deploy (`npm ci`, `prisma migrate deploy`, `npm run build`, `docker-compose -f docker-compose.prod.yml up -d`). | **Nizak** |
| **`PLAN_FREEZE.md` — van v1 nije u planu** | Ali korisnik želi dovesti projekt u produkciju. To znači da se moraju riješiti samo stvari unutar v1 (faze 1–11), a ne dodavati nove funkcije. | **N/A** |

---

## 6. Analiza po fazama — šta je spremno, šta nije

| Faza | Plan | Kod | DB migracija | Test (e2e) | Produkcijska spremnost |
|---|---|---|---|---|---|
| **1 Foundation** | ✅ LOCKED | ✅ Potpun | ✅ `phase_01` | ✅ `auth`, `tenant`, `users` | ⚠️ Nema MySQL u compose; nema `.env`; nema `Dockerfile` |
| **2 Core ops** | ✅ LOCKED | ✅ Potpun | ✅ `phase_02` | ✅ `ops-core`, `projects` | ⚠️ Isto kao faza 1 |
| **3 Frontend shell** | ✅ LOCKED | ✅ Potpun | ❌ Nema (OK) | ❌ Nema `frontend/e2e` za sve stranice | ⚠️ Nema `node_modules`; nema `VITE_API_URL` za prod; nema `Dockerfile` |
| **4 Fleet / logistics** | ✅ LOCKED | ✅ Potpun | ✅ `phase_04` | ✅ `fleet` | ⚠️ MinIO mora biti dostupan (`MINIO_ENDPOINT`) |
| **5 Web ops UI** | ✅ LOCKED | ✅ Potpun | ✅ `phase_05` | ❌ Nema eksplicitnog `e2e` za dnevnik/HSE | ⚠️ `planned-gantt` je samo planned (OK) |
| **6 Mobile Expo** | ✅ LOCKED | ✅ Potpun | ✅ `phase_06` | ❌ Nema mobile testova | ⚠️ Nema `expo build` konfiguracije; nema `EAS` |
| **7 Advanced polish** | ✅ LOCKED | ✅ Potpun | ✅ `phase_07` | ❌ Nema za tender/servis/docs | ⚠️ CI bez deploya; `docs-cron` postoji |
| **8 Public site** | ✅ LOCKED | ✅ Potpun | ✅ `phase_08` | ✅ `public` | ⚠️ `logoPath` i `coverAssetId` moraju biti ispravni za MinIO stream |
| **9 Payroll** | ✅ LOCKED | ✅ Potpun | ❌ Nema eksplicitno (moguće pokriveno) | ✅ `payroll` | ⚠️ `hourlyRate` polje — provjeriti DB shemu; `from-payroll.ts` postoji |
| **10 ERP-lite** | ✅ LOCKED | ✅ Potpun | ✅ `phase_10` | ✅ `erp` | ⚠️ `apply-stock` opcionalan; `warehouse` tipovi OK |
| **11 IoT** | ✅ LOCKED | ✅ Potpun | ✅ `phase_11` | ✅ `iot` | ⚠️ `key` (Argon2id + SHA-256) — provjeriti sigurnost; `X-Device-Key` header |

---

## 7. Plan razrade za produkciju — po fazama (preporuka)

> **Napomena:** Korisnik kaže: *"Po fazama ćemo raditi"*. To znači da ćemo raditi iterativno — jedna faza po jedna. Svaka faza mora biti **potpuno spremna** (kod + test + deploy + dokument) prije nego pređemo na sljedeću.

### Opća pravila za sve faze

1. **Prije svake faze:** `npm ci` (ili `npm install`) za sve projekte (`backend`, `frontend`, `mobile`).
2. **Prije svake faze:** Provjera `prisma migrate status` i `prisma migrate deploy` (ako ima novih migracija).
3. **Tijekom faze:** Pokretanje `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e`.
4. **Nakon faze:** Ažuriranje `.cursor/plans/gradix-core/CHECKLIST.md`, `HANDOFF.md`, i `03_gap_analysis.md` (ako se nešto promijeni).
5. **Za produkciju:** Kreiranje `docker-compose.prod.yml`, `.env.production`, i `Dockerfile` za svaki sloj.

---

### Faza A — Osnovna infrastruktura i okruženje (prije svih ostalih)

**Cilj:** Osigurati da se projekt može graditi, testirati i pokrenuti.

| Korak | Zadatak | Status (trenutno) | Planirana akcija |
|---|---|---|---|
| A.1 | Instalirati `node_modules` | ❌ Nema | `npm ci` za `backend`, `frontend`, `mobile` |
| A.2 | Provjeriti `prisma migrate status` | ❌ Nije pokrenuto | `cd backend && npx prisma migrate status` |
| A.3 | Kreirati `.env` (dev) sa stvarnim tajnama | ❌ `.env.example` samo | Kopirati `.env.example` → `.env`; zamijeniti tajne (`JWT_ACCESS_SECRET` min 32 znaka) |
| A.4 | Dodati `docker-compose.yml` sa MySQL | ❌ Samo MinIO | Dodati `mysql:8.0` servis; ažurirati `.env` (`DATABASE_URL`) |
| A.5 | Kreirati `docker-compose.prod.yml` | ❌ Ne postoji | Dodati `mysql`, `minio`, `backend`, `frontend`, `nginx` (ili `traefik`) |
| A.6 | Kreirati `Dockerfile` za backend | ❌ Ne postoji | `FROM node:22-alpine` → `npm ci` → `prisma generate` → `npm run build` → `CMD ["node", "dist/main"]` |
| A.7 | Kreirati `Dockerfile` za frontend | ❌ Ne postoji | `FROM node:22-alpine` → `npm run build` → `nginx` (ili `node` za `vite preview`) |
| A.8 | Kreirati `.env.production` | ❌ Ne postoji | Kopirati `.env` s produkcijskim vrijednostima (`DATABASE_URL`, `MINIO_ENDPOINT`, `CORS_ORIGIN`) |

**Rezultat faze A:** Sva tri projekta se mogu graditi (`npm run build`), `prisma migrate deploy` prolazi, `docker-compose -f docker-compose.yml up -d` radi (`minio` + `mysql`), `.env` ima stvarne tajne.

---

### Faza B — Faza 1 (Foundation) — produkcijska spremnost

**Cilj:** Auth, tenant, settings, notifikacije, upload, audit — spremni za produkciju.

| Korak | Zadatak | Napomena |
|---|---|---|
| B.1 | Pokrenuti `npm run test:e2e` za `auth`, `tenant`, `users` | Provjeriti da svi testovi prolaze |
| B.2 | Provjeriti `MemoryMinioService` za e2e | Potvrditi da ne utječe na produkciju |
| B.3 | Dodati `Dockerfile` za backend (ako nije u A.6) | Osigurati da `prisma generate` i `migrate deploy` rade u build fazi |
| B.4 | Dodati `health` provjeru za DB i MinIO | Ažurirati `health.controller.ts` ili `health.service.ts` |
| B.5 | Konfigurirati `mail.service.ts` za produkciju | Dodati SMTP ili API konfiguraciju (ili dokumentirati stub) |
| B.6 | Kreirati `PRODUCTION_READINESS.md` za fazu 1 | Dokumentirati korake za deploy (`npm ci`, `prisma migrate deploy`, `npm run build`, `docker-compose up`) |

**Rezultat:** Faza 1 spremna za produkciju.

---

### Faza C — Faza 2 (Core ops API) — produkcijska spremnost

**Cilj:** Projekti, zadaci, timer, faze, dodjele, količine — spremni.

| Korak | Zadatak | Napomena |
|---|---|---|
| C.1 | Pokrenuti `npm run test:e2e` za `ops-core`, `projects` | Provjeriti `timer` mutex, `machineId`, `auto-close` |
| C.2 | Provjeriti `timer-cron.service.ts` | Osigurati da `timer.maxOpenHours` (default 12h) radi |
| C.3 | Provjeriti `amendments.controller.ts` | `Amendment` šema (`TIMER`, `TRIP`, `FUEL`) mora biti ispravna |
| C.4 | Ažurirati `docker-compose.prod.yml` (ako nije u A.5) | Dodati `cron` ili `scheduler` za `timer-cron` (ili koristiti `node-cron` unutar aplikacije — to je OK) |
| C.5 | Dokumentirati `timer` ponašanje za produkciju | `pause` ne teče; `close` zatvara sesiju; `deactivate` force-close |

**Rezultat:** Faza 2 spremna.

---

### Faza D — Faza 3 (Frontend shell) — produkcijska spremnost

**Cilj:** Vite + React + Tailwind + rute — spremno za produkciju.

| Korak | Zadatak | Napomena |
|---|---|---|
| D.1 | `npm ci` za frontend | Osigurati da svi paketi (`react`, `vite`, `tailwindcss`, `tanstack-query`, `zustand`) rade |
| D.2 | `npm run build` | Provjeriti da nema grešaka (`tsc -b` mora proći) |
| D.3 | Dodati `VITE_API_URL` u `.env.production` | Pokazivati na `https://api.gradix.local` ili slično |
| D.4 | Dodati `Dockerfile` za frontend (ako nije u A.7) | `nginx` sa `dist/` kao `root` |
| D.5 | Provjeriti `routes/app-router.tsx` i `routes/guards.tsx` | Osigurati da sve stranice (`login`, `dashboard`, `projects`, `tasks`, `fleet`, `diary`, `hse`, `tenders`, `services`, `reports`, `payroll`, `erp`, `settings`, `users`, `companies`, `public-site`) imaju ispravne rute |
| D.6 | Provjeriti `i18n/` (`bs`, `en`) | Osigurati da `locale` (`bs` default) radi ispravno |
| D.7 | Dodati osnovni `playwright` test za ključne stranice | Npr. `login.spec.ts` (postoji); dodati `dashboard.spec.ts` ili `projects.spec.ts` |

**Rezultat:** Faza 3 spremna.

---

### Faza E — Faza 4 (Fleet / logistics / GPS) — produkcijska spremnost

**Cilj:** Mašine, ture, gorivo, GPS — spremno.

| Korak | Zadatak | Napomena |
|---|---|---|
| E.1 | Pokrenuti `npm run test:e2e` (`fleet`) | Provjeriti `picker`, `trip`, `fuel`, `machine` |
| E.2 | Provjeriti `machine-hours.ts` i `machine-status.ts` | `currentWorkingHours` mora se ažurirati na `timer` close |
| E.3 | Provjeriti `trip-rules.ts` | `TRIP_IMMUTABLE` nakon sync; `FUEL_PROJECT_REQUIRED` |
| E.4 | Osigurati `MinIO` za `receiptPath` (gorivo) | `files/minio.service.ts` mora biti konfiguriran |
| E.5 | Dokumentirati `picker` za `DRIVER` | `GET /api/projects/picker` mora vraćati samo dodijeljene projekte |

**Rezultat:** Faza 4 spremna.

---

### Faza F — Faza 5 (Web ops UI + dnevnik + šifarnici) — produkcijska spremnost

**Cilj:** Dashboard, dnevnik (`diary`), dokumenti (`documents`), HSE (`hse`), količine (`quantities`), Gantt (`planned-gantt`) — spremno.

| Korak | Zadatak | Napomena |
|---|---|---|
| F.1 | Pokrenuti `npm run build` (frontend) | Osigurati da `project-tabs`, `diary-conflict-sheet`, `planned-gantt` nemaju grešaka |
| F.2 | Provjeriti `diary.controller.ts` i `diary.service.ts` | `unique` (`companyId`, `projectId`, `date`) mora raditi; `max 20` foto |
| F.3 | Provjeriti `hse.controller.ts` | `online-only`; `max 5` foto |
| F.4 | Provjeriti `documents.service.ts` | `DOCUMENT_EXPIRING` (`30/15/5` dana); `warn`, ne blok |
| F.5 | Provjeriti `dashboard.controller.ts` | KPI po roli (`WORKER` bez `budget`) |
| F.6 | Dodati `docker-compose.prod.yml` ažuriranje (ako potrebno) | Osigurati da `frontend` i `backend` komuniciraju (`CORS`) |

**Rezultat:** Faza 5 spremna.

---

### Faza G — Faza 6 (Mobile Expo + offline sync) — produkcijska spremnost

**Cilj:** Expo aplikacija — timer, ture, gorivo, dnevnik, HSE, sync — spremno za produkciju.

| Korak | Zadatak | Napomena |
|---|---|---|
| G.1 | `npm ci` za mobile | Osigurati `expo`, `expo-router`, `expo-sqlite`, `expo-location` |
| G.2 | Provjeriti `sync/engine.ts` (push/pull) | `pendingRows`, `markSynced`, `readMeta`, `writeMeta` |
| G.3 | Provjeriti `db/client.ts` (SQLite) | Osigurati da DB shema odgovara `prisma` shemi (barem osnovni entiteti: `Project`, `Task`, `TimerSession`, `Trip`, `FuelEntry`, `Diary`, `Incident`) |
| G.4 | Dodati `expo build` konfiguraciju (`app.json`) | `build` profil (`development`, `preview`, `production`) |
| G.5 | Provjeriti `offline-bar.tsx` | Osigurati da korisnik vidi status (`online`/`offline`, `pending` zapisi) |
| G.6 | Provjeriti `timer-actions.ts` | `start`, `pause`, `resume`, `close` moraju raditi ispravno (`offline` i `online`) |
| G.7 | Dokumentirati `mobile` deploy (`expo build:android` / `expo build:ios` ili `eas build`) | Dodati `eas.json` (opcionalno) |

**Rezultat:** Faza 6 spremna.

---

### Faza H — Faza 7 (Tender / servis / docs / reports / CI) — produkcijska spremnost

**Cilj:** Tender (`tenders`), servis (`services`), dokumenti (`docs`), izvještaji (`reports`), CI — spremno.

| Korak | Zadatak | Napomena |
|---|---|---|
| H.1 | Pokrenuti `npm run test:e2e` (`polish`, `public`) | Provjeriti `tenders`, `services`, `reports` |
| H.2 | Provjeriti `docs-cron.service.ts` | `DOCUMENT_EXPIRING` — `warn` (ne blok) |
| H.3 | Provjeriti `service-cron.service.ts` | `SERVICE_DUE` — `force-close` `timer`; `IN_SERVICE` status |
| H.4 | Provjeriti `reports.controller.ts` | Fiksni slugovi (`phase-quantities`, itd.); `GET /reports/custom` → `REPORT_UNKNOWN` |
| H.5 | Ažurirati `.github/workflows/ci.yml` | Dodati `deploy` job (ako nije u A.5); osigurati da `playwright` testovi prolaze |
| H.6 | Dodati `Dockerfile` za `backend` (ako nije u A.6) | Osigurati da `cron` (`timer-cron`, `docs-cron`, `service-cron`) radi unutar aplikacije |

**Rezultat:** Faza 7 spremna.

---

### Faza I — Faza 8 (Public site) — produkcijska spremnost

**Cilj:** Javni sajt (`/p/:slug`) — spreman za produkciju.

| Korak | Zadatak | Napomena |
|---|---|---|
| I.1 | Pokrenuti `npm run test:e2e` (`public`) | Provjeriti `/p/:slug`, `GET /public/assets/*` |
| I.2 | Provjeriti `public.controller.ts` i `public.service.ts` | `slug` (`[a-z0-9-]{3,40}`) — `immutable`; `isPublic` flag |
| I.3 | Provjeriti `public-write.controller.ts` | `WORKER` → 403 `PATCH` (`public`); `logoPath` — `PublicAsset` stream |
| I.4 | Osigurati `MinIO` za `PublicAsset` (`logo`, `cover`) | `files/minio.service.ts` mora podržavati `stream` (`public.controller.ts`) |
| I.5 | Dodati `nginx` konfiguraciju za javni sajt (opcionalno) | Ako `frontend` i `public` dijele isti `nginx`, potrebno je osigurati da `/p/` rute ne ometaju `/` rute |

**Rezultat:** Faza 8 spremna.

---

### Faza J — Faza 9 (Payroll) — produkcijska spremnost

**Cilj:** Obračun sati — spreman.

| Korak | Zadatak | Napomena |
|---|---|---|
| J.1 | Pokrenuti `npm run test:e2e` (`payroll`) | Provjeriti `sessions`, `summary`, `export`, `approve`, `reject` |
| J.2 | Provjeriti `payroll-period.ts` | Mjesec u `app.timezone`; `startedAt` u `TZ` firme |
| J.3 | Provjeriti `payroll-amount.ts` | `durationMinutes` (bez `pause`); `hourlyRate` (`payroll.read` za tuđu stopu); `amount` (`durationMinutes / 60 * rate`) |
| J.4 | Provjeriti `payroll-export.ts` | `.xlsx` (`application/vnd.openxmlformats...`) — `Content-Disposition` |
| J.5 | Provjeriti `payroll-access.ts` | `SS/PM` ne odobravaju sebe (`PAYROLL_SELF_APPROVE`) |
| J.6 | Dodati eksplicitnu `prisma` migraciju za fazu 9 (ako nedostaje) | Iako `hourlyRate` možda postoji u ranijim migracijama, eksplicitna `phase_09_payroll` olakšava audit. **Opcionalno**, ali preporučeno. |

**Rezultat:** Faza 9 spremna.

---

### Faza K — Faza 10 (ERP-lite) — produkcijska spremnost

**Cilj:** Partneri, troškovi, lager (`SITE`, `YARD`, `CISTERN`) — spremno.

| Korak | Zadatak | Napomena |
|---|---|---|
| K.1 | Pokrenuti `npm run test:e2e` (`erp`) | Provjeriti `partners`, `costs`, `warehouses`, `stock` |
| K.2 | Provjeriti `costs.controller.ts` | `CostEntry` (`MANUAL`, `FUEL`, `SERVICE`, `PAYROLL`); `unique` (`companyId`, `source`, `sourceId`) |
| K.3 | Provjeriti `stock.controller.ts` i `fuel-stock.controller.ts` | `apply-stock` (`idempotent`); `CISTERN` lager se ne skida automatski (`DECISIONS.md`) |
| K.4 | Provjeriti `partners.controller.ts` | `PartnerType` (`CLIENT`, `SUPPLIER`); `Project.client` → `partnerId` (string → FK) |
| K.5 | Dodati `docker-compose.prod.yml` ažuriranje (ako potrebno) | Osigurati da `warehouse` (`SITE`, `YARD`, `CISTERN`) radi ispravno |

**Rezultat:** Faza 10 spremna.

---

### Faza L — Faza 11 (IoT fleet) — produkcijska spremnost

**Cilj:** IoT uređaj (`GpsDevice`) — spreman.

| Korak | Zadatak | Napomena |
|---|---|---|
| L.1 | Pokrenuti `npm run test:e2e` (`iot`) | Provjeriti `POST /api/iot/gps`, `X-Device-Key`, `throttle` (`1/5s`) |
| L.2 | Provjeriti `gps-devices.service.ts` | `IOT_DEVICE_EXISTS` (1 uređaj / mašina); `key` (`Argon2id` + `sha256`); `plaintext` jednom na `create`/`rotate` |
| L.3 | Provjeriti `machine-devices.controller.ts` | `GET` bez `key` u response; `PATCH` (rotate) — novi `key` |
| L.4 | Provjeriti `iot.controller.ts` | `DECOMMISSIONED` / `isActive=false` → 403; `loš key` → 401 |
| L.5 | Dokumentirati IoT deploy | `GpsDevice` model — `key` nije u `GET`; `rotate` generira novi ključ; stari `refresh` tokeni se moraju revocirati? (Prema `DECISIONS.md`: `key` nije `JWT` — to je poseban ključ za IoT uređaj) |

**Rezultat:** Faza 11 spremna.

---

### Faza M — Završna integracija i produkcijski deploy

**Cilj:** Svi dijelovi (`backend`, `frontend`, `mobile`, `public`) rade zajedno u produkciji.

| Korak | Zadatak | Napomena |
|---|---|---|
| M.1 | Pokrenuti sve e2e testove (`npm run test:e2e` za `backend`) | Osigurati da `auth`, `fleet`, `iot`, `payroll`, `sync`, `public`, `polish`, `erp` prolaze |
| M.2 | Pokrenuti `frontend` (`npm run build`) i `mobile` (`expo build:android` / `expo build:ios` ili `eas build`) | Osigurati da `frontend` i `mobile` koriste `VITE_API_URL` za produkciju |
| M.3 | Kreirati `docker-compose.prod.yml` (ako nije u A.5) | `mysql`, `minio`, `backend`, `frontend`, `nginx` |
| M.4 | Kreirati `.env.production` | Sve tajne (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MINIO_ACCESS_KEY`, `DATABASE_URL`, `CORS_ORIGIN`, `SEED_PASSWORD`) |
| M.5 | Kreirati `DEPLOY.md` | Dokumentirati: `docker-compose -f docker-compose.prod.yml up -d`, `prisma migrate deploy`, `npm run build`, `docker-compose logs -f backend` |
| M.6 | Kreirati `MONITORING.md` (opcionalno) | `health` endpoint (`/api/health`); `logs` (`JSON`); `alerts` (opcionalno) |
| M.7 | Ažurirati `.cursor/plans/gradix-core/CHECKLIST.md` | Označiti sve faze (`1–11`) kao `PRODUCTION_READY` (ako su sve faze A–L završene) |
| M.8 | Ažurirati `.cursor/plans/gradix-core/HANDOFF.md` | Dodati `PRODUCTION_READY` datum i napomene o deployu |

---

## 8. Preporučeni redoslijed rada (faze za sesije)

> Korisnik je rekao: **"Po fazama ćemo raditi"**. Preporuka je da radimo iterativno — jedna faza po sesiju (ili jedna grupa faza). Svaka faza mora biti **potpuno završena** prije prelaska na sljedeću.

### Sesija 1 — Faza A (Infrastruktura i okruženje)
- `npm ci` za sve projekte (`backend`, `frontend`, `mobile`).
- Kreirati `.env` sa stvarnim tajnama.
- Dodati `mysql` u `docker-compose.yml` (ili osigurati vanjsku DB).
- Kreirati `.env.production` i `docker-compose.prod.yml`.
- Kreirati `Dockerfile` za `backend` i `frontend`.
- **Rezultat:** Projekt se može graditi (`npm run build`) i pokrenuti (`docker-compose up`).

### Sesija 2 — Faza B (Faza 1 — Foundation — produkcija)
- Pokrenuti `test:e2e` (`auth`, `tenant`, `users`).
- Provjeriti `prisma migrate status` i `migrate deploy`.
- Dodati `health` provjeru za DB i MinIO.
- Konfigurirati `mail.service.ts` (stub ili SMTP).
- Kreirati `PRODUCTION_READINESS.md` za fazu 1.
- **Rezultat:** Faza 1 spremna.

### Sesija 3 — Faza C (Faza 2 — Core ops — produkcija)
- Pokrenuti `test:e2e` (`ops-core`, `projects`).
- Provjeriti `timer-cron` (`maxOpenHours` = 12h, `auto-close`).
- Provjeriti `amendments` (`TIMER`, `TRIP`, `FUEL`).
- Ažurirati `docker-compose.prod.yml` (ako potrebno za `cron`).
- **Rezultat:** Faza 2 spremna.

### Sesija 4 — Faza D (Faza 3 — Frontend shell — produkcija)
- `npm ci` za frontend; `npm run build`.
- Dodati `VITE_API_URL` u `.env.production`.
- Provjeriti `routes/app-router.tsx` (sve stranice).
- Provjeriti `i18n` (`bs`, `en`).
- Dodati `Dockerfile` za frontend.
- **Rezultat:** Faza 3 spremna.

### Sesija 5 — Faza E (Faza 4 — Fleet — produkcija)
- Pokrenuti `test:e2e` (`fleet`).
- Provjeriti `machine-hours` (`currentWorkingHours` na `timer` close).
- Osigurati `MinIO` za `receiptPath` (gorivo).
- **Rezultat:** Faza 4 spremna.

### Sesija 6 — Faza F (Faza 5 — Web ops — produkcija)
- Pokrenuti `frontend` (`npm run build`).
- Provjeriti `diary` (`unique`, `max 20` foto), `hse` (`online-only`, `max 5` foto), `documents` (`warn`), `dashboard` (KPI po roli), `planned-gantt`.
- **Rezultat:** Faza 5 spremna.

### Sesija 7 — Faza G (Faza 6 — Mobile — produkcija)
- `npm ci` za mobile; provjeriti `app.json`.
- Provjeriti `sync/engine.ts` (push/pull).
- Provjeriti `timer-actions.ts` (`offline` i `online`).
- Dodati `expo build` konfiguraciju.
- **Rezultat:** Faza 6 spremna.

### Sesija 8 — Faza H (Faza 7 — Advanced polish — produkcija)
- Pokrenuti `test:e2e` (`polish`, `public`).
- Provjeriti `docs-cron`, `service-cron`, `tenders` (`WON` → `convert`), `services` (`IN_SERVICE` → `force-close`), `reports` (fiksni slugovi).
- Ažurirati `.github/workflows/ci.yml` (dodati `deploy` ili osigurati `build` + `test`).
- **Rezultat:** Faza 7 spremna.

### Sesija 9 — Faza I (Faza 8 — Public site — produkcija)
- Pokrenuti `test:e2e` (`public`).
- Provjeriti `/p/:slug`, `PublicAsset` stream (`logo`, `cover`).
- Osigurati `nginx` konfiguraciju za javni sajt.
- **Rezultat:** Faza 8 spremna.

### Sesija 10 — Faza J (Faza 9 — Payroll — produkcija)
- Pokrenuti `test:e2e` (`payroll`).
- Provjeriti `payroll-period` (`mjesec` u `TZ`), `payroll-amount` (`durationMinutes` bez `pause`), `payroll-export` (`.xlsx`), `payroll-access` (`SS` ne sebe).
- **Opcionalno:** Dodati eksplicitnu `prisma` migraciju (`phase_09_payroll`).
- **Rezultat:** Faza 9 spremna.

### Sesija 11 — Faza K (Faza 10 — ERP-lite — produkcija)
- Pokrenuti `test:e2e` (`erp`).
- Provjeriti `partners`, `costs` (`MANUAL`, `FUEL`, `SERVICE`, `PAYROLL`), `warehouses` (`SITE`, `YARD`, `CISTERN`), `stock` (`apply-stock` opcionalno).
- **Rezultat:** Faza 10 spremna.

### Sesija 12 — Faza L (Faza 11 — IoT — produkcija)
- Pokrenuti `test:e2e` (`iot`).
- Provjeriti `GpsDevice` (`1` uređaj / mašina; `key` — `Argon2id` + `sha256`; `plaintext` jednom na `create`/`rotate`; `X-Device-Key` header; `throttle` `1/5s`).
- **Rezultat:** Faza 11 spremna.

### Sesija 13 — Faza M (Završna integracija i deploy)
- Pokrenuti sve e2e testove (`npm run test:e2e` za sve module).
- Pokrenuti `frontend` (`npm run build`) i `mobile` (`expo build` ili `eas build`).
- Kreirati `docker-compose.prod.yml` i `.env.production`.
- Kreirati `DEPLOY.md` i `MONITORING.md`.
- Ažurirati `CHECKLIST.md` i `HANDOFF.md`.
- **Rezultat:** Gradix v1 spreman za produkciju.

---

## 9. Zaključak i preporuke

### Šta je dobro?

- **Kod je potpun** za sve 11 faza (`backend` 232 fajla, `frontend` 205 fajlova, `mobile` 349 fajlova).
- **Planovi su zaključani** (`LOCKED`) i dokumentirani (`DOMAIN.md`, `DECISIONS.md`, `PLAN_FREEZE.md`, matrice).
- **E2E testovi postoje** za sve ključne module (`auth`, `fleet`, `iot`, `payroll`, `sync`, `public`, `polish`, `erp`).
- **CI pipeline** (`.github/workflows/ci.yml`) pokriva `backend` (build + e2e), `frontend` (lint + build), `playwright`.
- **Offline sync** (`mobile/sync/engine.ts`) postoji i pokriva `push` (`pendingRows`), `pull` (`catalog`), `TTL` (`24h`).
- **Tenant** (`companyId`, `PLATFORM_ADMIN`, `X-Company-Id`, `slug` immutable) je ispravno implementiran.
- **Timer** (`mutex` po korisniku, `machineId` od faze 4, `pause` ne teče, `auto-close` 12h, `deactivate` → `force-close`) je ispravno implementiran.
- **IoT** (`GpsDevice`, `key`, `X-Device-Key`, `throttle`) je spreman.

### Šta nije dobro (stvarni gapovi za produkciju)?

1. **Nema `node_modules`** — ne može se graditi ni pokrenuti bez `npm ci`.
2. **`docker-compose.yml` nema MySQL** — `DATABASE_URL` mora pokazivati na vanjski server (ili dodati `mysql` u compose).
3. **Nema produkcijskog `.env`** — `.env.example` ima placeholder tajne (`change-me-...`).
4. **Nema `Dockerfile`** za `backend`, `frontend`, ili `mobile`.
5. **Nema `docker-compose.prod.yml`** — potrebna je verzija sa `mysql`, `minio`, `backend`, `frontend`, `nginx` (ili `traefik`).
6. **Frontendu nedostaje `VITE_API_URL` za produkciju** — `CORS_ORIGIN` u `.env` pokazuje na `localhost:5173`.
7. **Mobile nema `expo build` konfiguraciju** (`development`, `preview`, `production` profili) ni `EAS` konfiguraciju.
8. **Nema eksplicitne migracije za fazu 9 (`payroll`)** — iako `hourlyRate` i `TimerApprovalStatus` možda postoje u ranijim migracijama, eksplicitna migracija olakšava audit i rollback.
9. **CI nema `deploy` joba** — samo `build` + `test`. Za produkciju potrebna je dodatna faza (`docker-compose.prod.yml up`).
10. **Nema `PRODUCTION_READINESS.md` ili `DEPLOY.md`** — dokumentacija za deploy nije eksplicitno kreirana.

### Preporuka za korisnika

> **"Po fazama ćemo raditi"** — to je odličan pristup. Preporuka je da počnemo sa **Fazom A (Infrastruktura)** jer bez nje ne možemo ništa graditi ni testirati. Nakon toga idemo redom (`B` → `C` → `D` → ... → `M`).

Svaka sesija treba završiti sa:
- **Komitom** (`git commit`) — iako nije obavezno za sesiju, preporučeno je da se svaka faza zabilježi.
- **Ažuriranjem dokumenata** (`CHECKLIST.md`, `HANDOFF.md`, `03_gap_analysis.md`) — ako se nešto promijeni.
- **Provjerom** (`npm run build`, `npm run test`, `npm run test:e2e`) — osigurati da ništa nije slomljeno.

---

## 10. Dodatni resursi i reference

- `.cursor/plans/gradix-core/00_overview.md` — pregled svih faza.
- `.cursor/plans/gradix-core/PLAN_FREEZE.md` — zaključane odluke (v1).
- `.cursor/docs/DECISIONS.md` — ključne odluke (`timer`, `ture`, `gorivo`, `geofence`, `auth`, `tenant`, `SMS`, `notify`).
- `.cursor/docs/DOMAIN.md` — glosar i entiteti.
- `.cursor/docs/matrices/` — matrice (`auth`, `rbac`, `permissions`, `data-scope`, `screens`, `fleet-status`, `service`, `documents-expiry`, `reports`, `diary`, `trips`, `quantities`, `audit`, `amendments`, `notifications`, `public-site`, `ci-deploy`, `settings`, `payroll`, `task-status`, `project-status`, `timer`, `gps`, `hse`, `offline-sync`, `tenant`, `erp`).
- `.cursor/docs/03_gap_analysis.md` — aktivni i zatvoreni gapovi.
- `.cursor/plans/gradix-core/CHECKLIST.md` — master checklist (`11/11` faza, `41/41` segment).
- `.cursor/plans/gradix-core/HANDOFF.md` — status (`100%` implementacija, `e2e` zeleno za `iot` i `fleet`).
- `docker-compose.yml` — samo `minio`.
- `.env.example` — placeholder tajne.
- `.github/workflows/ci.yml` — CI pipeline (`backend`, `frontend`, `playwright`).

---

*Ovaj dokument je kreiran 2026-10-18 kao dio sesije na grani `arena/0874ef4b-gradix`. Preporuka je da se svaki korak iz plana (`Faza A` → `Faza M`) izvrši u zasebnoj sesiji, s provjerom (`build`, `test`, `e2e`) i ažuriranjem dokumenata (`CHECKLIST.md`, `HANDOFF.md`, `03_gap_analysis.md`).*
