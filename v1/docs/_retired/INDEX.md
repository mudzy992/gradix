# Penzionisana dokumentacija — indeks

**Datum penzionisanja:** 2026-11-02
**Grana:** `arena/0bc0e56e-gradix`
**Razlog:** odluka vlasnika **P2(a)** — sva stara dokumentacija se povlači, a važeća pravila
se prenose u novu dokumentaciju (`docs/`). Novi izvor istine su `docs/` i `AUDIT/`.

> ⚠️ Nijedan dokument ovdje **nije** relevantan za implementaciju. Služe isključivo kao
> historijska referenca. Ako penzionisani dokument kaže jedno, a `docs/` drugo — važi `docs/`.
> Ako nije jasno šta važi, **pitanje vlasniku**, ne nagađanje.

## Kako čitati

- `docs/_retired/` čuva **originalnu putanju** u podfolderima (npr. `.cursor/docs/DECISIONS.md`
  → `docs/_retired/.cursor/docs/DECISIONS.md`).
- Na vrhu svakog fajla je baner „⚠️ PENZIONISANO“.
- Živa dokumentacija: [`docs/`](../) · dnevnik rada: [`AUDIT/STATE.md`](../../AUDIT/STATE.md).

## Glavni dokumenti

| Originalna putanja | Penzionisano u | Šta je unutra |
|---|---|---|
| `ANALIZA_I_PLAN_PRODUKCIJA.md` | `docs/_retired/ANALIZA_I_PLAN_PRODUKCIJA.md` | Analiza stanja repoa (2026-10-18) i predlog plana produkcijske spremnosti po fazama; **tvrdi MySQL** i stanje prije Docker/Coolify radova. |
| `DEPLOYMENT_COOLIFY.md` | `docs/_retired/DEPLOYMENT_COOLIFY.md` | Coolify deploy vodič (verzija od 2026-11-02): compose, mreže, TLS/CA, seed, troubleshooting. **Zamijenjen sa `docs/INFRASTRUCTURE.md`.** |
| `ENV_LIST.md` | `docs/_retired/ENV_LIST.md` | Katalog env varijabli sa MySQL/TLS ostacima. **Zamijenjen sa `docs/INFRASTRUCTURE.md` §5.** |
| `redis-cli-command.md` | `docs/_retired/redis-cli-command.md` | Pomoćne `redis-cli` komande iz vremena planiranja Redisa; v1 kod ne koristi Redis. |
| `backend/README.md` | `docs/_retired/backend/README.md` | Generički NestJS starter README (nije opis Gradix backenda). |
| `.cursor/docs/DECISIONS.md` | `docs/_retired/.cursor/docs/DECISIONS.md` | Zaključane produktne odluke (auth, tenant, timer, ture, gorivo, payroll, javni sajt). **Važeće poslovno znanje — preneseno u `docs/BACKEND.md` i `docs/DECISIONS.md`.** |
| `.cursor/docs/DOMAIN.md` | `docs/_retired/.cursor/docs/DOMAIN.md` | Glosar domena, entiteti po fazi i „srećan put“ glavnih tokova. |
| `.cursor/docs/03_gap_analysis.md` | `docs/_retired/.cursor/docs/03_gap_analysis.md` | Kratka gap analiza dokumentacije i koda (2026-08-16). |
| `.cursor/rules/00_project.mdc` | `docs/_retired/.cursor/rules/00_project.mdc` | AI pravila projekta (banned liste, paleta, invarijante). **Sadrži kontradikciju: zabranjuje PostgreSQL, a sistem je na PostgreSQL-u.** Zamijenjen novim `.cursor/rules/00_project.mdc`. |

## Matrice (`.cursor/docs/matrices/**`)

| Originalna putanja | Penzionisano u | Šta je unutra |
|---|---|---|
| `.cursor/docs/matrices/amendments/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/amendments/MATRIX.md` | Ispravke timer/tura/goriva (ko, šta, kada, obavezan razlog). |
| `.cursor/docs/matrices/amendments/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/amendments/CHANGELOG.md` | Istorija izmjena matrice `amendments`. |
| `.cursor/docs/matrices/audit/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/audit/MATRIX.md` | AuditEvent — zatvoren skup akcija i šta se bilježi. |
| `.cursor/docs/matrices/audit/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/audit/CHANGELOG.md` | Istorija izmjena matrice `audit`. |
| `.cursor/docs/matrices/auth/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/auth/MATRIX.md` | Login, refresh rotacija, temp lozinke, reset, reuse detekcija. |
| `.cursor/docs/matrices/auth/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/auth/CHANGELOG.md` | Istorija izmjena matrice `auth`. |
| `.cursor/docs/matrices/ci-deploy/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/ci-deploy/MATRIX.md` | Šta CI provjerava i zašto nema auto-deploya. |
| `.cursor/docs/matrices/ci-deploy/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/ci-deploy/CHANGELOG.md` | Istorija izmjena matrice `ci-deploy`. |
| `.cursor/docs/matrices/data-scope/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/data-scope/MATRIX.md` | Vidljivost podataka po roli (tenant, projekti, liste). |
| `.cursor/docs/matrices/data-scope/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/data-scope/CHANGELOG.md` | Istorija izmjena matrice `data-scope`. |
| `.cursor/docs/matrices/diary/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/diary/MATRIX.md` | Dnevnik građenja — unique po danu, foto limit, PDF. |
| `.cursor/docs/matrices/diary/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/diary/CHANGELOG.md` | Istorija izmjena matrice `diary`. |
| `.cursor/docs/matrices/documents-expiry/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/documents-expiry/MATRIX.md` | Istek dokumenata: upozorenja 30/15/5, bez blokiranja. |
| `.cursor/docs/matrices/documents-expiry/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/documents-expiry/CHANGELOG.md` | Istorija izmjena matrice `documents-expiry`. |
| `.cursor/docs/matrices/erp/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/erp/MATRIX.md` | Partneri, troškovi, lager (SITE/YARD/CISTERN). |
| `.cursor/docs/matrices/erp/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/erp/CHANGELOG.md` | Istorija izmjena matrice `erp`. |
| `.cursor/docs/matrices/fleet-status/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/fleet-status/MATRIX.md` | Statusi mašina, servis, deaktivacija. |
| `.cursor/docs/matrices/fleet-status/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/fleet-status/CHANGELOG.md` | Istorija izmjena matrice `fleet-status`. |
| `.cursor/docs/matrices/gps/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/gps/MATRIX.md` | GPS pingovi (telefon vs IoT), geofence, retencija. |
| `.cursor/docs/matrices/gps/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/gps/CHANGELOG.md` | Istorija izmjena matrice `gps`. |
| `.cursor/docs/matrices/hse/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/hse/MATRIX.md` | HSE incidenti — online-only, foto limit 5. |
| `.cursor/docs/matrices/hse/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/hse/CHANGELOG.md` | Istorija izmjena matrice `hse`. |
| `.cursor/docs/matrices/notifications/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/notifications/MATRIX.md` | In-app notifikacije, sobe, primaoci po tipu. |
| `.cursor/docs/matrices/notifications/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/notifications/CHANGELOG.md` | Istorija izmjena matrice `notifications`. |
| `.cursor/docs/matrices/offline-sync/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/offline-sync/MATRIX.md` | Offline red, unique ključevi, TTL katalog 24 h. |
| `.cursor/docs/matrices/offline-sync/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/offline-sync/CHANGELOG.md` | Istorija izmjena matrice `offline-sync`. |
| `.cursor/docs/matrices/payroll/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/payroll/MATRIX.md` | Obračun: mjesec u TZ, odobravanje, export. |
| `.cursor/docs/matrices/payroll/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/payroll/CHANGELOG.md` | Istorija izmjena matrice `payroll`. |
| `.cursor/docs/matrices/permissions/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/permissions/MATRIX.md` | Unija permisija po rolama, guardovi. |
| `.cursor/docs/matrices/permissions/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/permissions/CHANGELOG.md` | Istorija izmjena matrice `permissions`. |
| `.cursor/docs/matrices/project-status/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/project-status/MATRIX.md` | Životni ciklus projekta (ACTIVE/ON_HOLD/terminalni). |
| `.cursor/docs/matrices/project-status/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/project-status/CHANGELOG.md` | Istorija izmjena matrice `project-status`. |
| `.cursor/docs/matrices/public-site/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/public-site/MATRIX.md` | Javni DTO whitelist i `/p/:slug` pravila. |
| `.cursor/docs/matrices/public-site/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/public-site/CHANGELOG.md` | Istorija izmjena matrice `public-site`. |
| `.cursor/docs/matrices/quantities/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/quantities/MATRIX.md` | Predmjer: plan vs izvedeno, ne dira progress %. |
| `.cursor/docs/matrices/quantities/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/quantities/CHANGELOG.md` | Istorija izmjena matrice `quantities`. |
| `.cursor/docs/matrices/rbac/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/rbac/MATRIX.md` | Role N:M, `PLATFORM_ADMIN` vs firma. |
| `.cursor/docs/matrices/rbac/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/rbac/CHANGELOG.md` | Istorija izmjena matrice `rbac`. |
| `.cursor/docs/matrices/reports/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/reports/MATRIX.md` | Fiksna lista izvještaja i slugovi. |
| `.cursor/docs/matrices/reports/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/reports/CHANGELOG.md` | Istorija izmjena matrice `reports`. |
| `.cursor/docs/matrices/screens/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/screens/MATRIX.md` | Mapa ekrana i potrebnih permisija. |
| `.cursor/docs/matrices/screens/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/screens/CHANGELOG.md` | Istorija izmjena matrice `screens`. |
| `.cursor/docs/matrices/service/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/service/MATRIX.md` | Servis mašine: IN_SERVICE, force-close timera. |
| `.cursor/docs/matrices/service/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/service/CHANGELOG.md` | Istorija izmjena matrice `service`. |
| `.cursor/docs/matrices/settings/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/settings/MATRIX.md` | Registry podešavanja firme i defaulti. |
| `.cursor/docs/matrices/settings/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/settings/CHANGELOG.md` | Istorija izmjena matrice `settings`. |
| `.cursor/docs/matrices/spend-progress/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/spend-progress/MATRIX.md` | Jedna formula za trošak i progress. |
| `.cursor/docs/matrices/spend-progress/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/spend-progress/CHANGELOG.md` | Istorija izmjena matrice `spend-progress`. |
| `.cursor/docs/matrices/task-status/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/task-status/MATRIX.md` | Statusi zadataka i prelazi. |
| `.cursor/docs/matrices/task-status/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/task-status/CHANGELOG.md` | Istorija izmjena matrice `task-status`. |
| `.cursor/docs/matrices/tenant/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/tenant/MATRIX.md` | Firma kao tenant, slug, header pravila. |
| `.cursor/docs/matrices/tenant/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/tenant/CHANGELOG.md` | Istorija izmjena matrice `tenant`. |
| `.cursor/docs/matrices/tenders/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/tenders/MATRIX.md` | Tenderi: statusi, konverzija WON → projekat. |
| `.cursor/docs/matrices/tenders/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/tenders/CHANGELOG.md` | Istorija izmjena matrice `tenders`. |
| `.cursor/docs/matrices/timer/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/timer/MATRIX.md` | Timer: mutex, pauza, auto-close, sati mašine. |
| `.cursor/docs/matrices/timer/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/timer/CHANGELOG.md` | Istorija izmjena matrice `timer`. |
| `.cursor/docs/matrices/trips/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/trips/MATRIX.md` | Ture: obavezna polja, QR/vagar opciono, immutable. |
| `.cursor/docs/matrices/trips/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/trips/CHANGELOG.md` | Istorija izmjena matrice `trips`. |
| `.cursor/docs/matrices/upload/MATRIX.md` | `docs/_retired/.cursor/docs/matrices/upload/MATRIX.md` | Upload: veličina, putanje `{companyId}/`, MinIO. |
| `.cursor/docs/matrices/upload/CHANGELOG.md` | `docs/_retired/.cursor/docs/matrices/upload/CHANGELOG.md` | Istorija izmjena matrice `upload`. |

## Planovi faza (`.cursor/plans/gradix-core/**`)

| Originalna putanja | Penzionisano u | Šta je unutra |
|---|---|---|
| `.cursor/plans/gradix-core/00_overview.md` | `docs/_retired/.cursor/plans/gradix-core/00_overview.md` | Pregled plana: identitet proizvoda, zaključane odluke, 11 faza. |
| `.cursor/plans/gradix-core/01_phase-01-foundation.md` | `docs/_retired/.cursor/plans/gradix-core/01_phase-01-foundation.md` | Plan Faze 1 — foundation (tenant, auth, settings, notify, upload, audit). |
| `.cursor/plans/gradix-core/02_phase-02-core-ops-api.md` | `docs/_retired/.cursor/plans/gradix-core/02_phase-02-core-ops-api.md` | Plan Faze 2 — projekti, zadaci, timer. |
| `.cursor/plans/gradix-core/03_phase-03-frontend-shell.md` | `docs/_retired/.cursor/plans/gradix-core/03_phase-03-frontend-shell.md` | Plan Faze 3 — Vite shell, login, layout, settings, users. |
| `.cursor/plans/gradix-core/04_phase-04-fleet-logistics-api.md` | `docs/_retired/.cursor/plans/gradix-core/04_phase-04-fleet-logistics-api.md` | Plan Faze 4 — flota, ture, gorivo, GPS. |
| `.cursor/plans/gradix-core/05_phase-05-web-ops-ui.md` | `docs/_retired/.cursor/plans/gradix-core/05_phase-05-web-ops-ui.md` | Plan Faze 5 — web ops UI, dnevnik, šifarnici, dashboard. |
| `.cursor/plans/gradix-core/06_phase-06-mobile-expo.md` | `docs/_retired/.cursor/plans/gradix-core/06_phase-06-mobile-expo.md` | Plan Faze 6 — Expo aplikacija i offline sync. |
| `.cursor/plans/gradix-core/07_phase-07-advanced-polish.md` | `docs/_retired/.cursor/plans/gradix-core/07_phase-07-advanced-polish.md` | Plan Faze 7 — tenderi, servis, dokumenti, reporti, CI. |
| `.cursor/plans/gradix-core/08_phase-08-public-site.md` | `docs/_retired/.cursor/plans/gradix-core/08_phase-08-public-site.md` | Plan Faze 8 — javni one-page `/p/:slug`. |
| `.cursor/plans/gradix-core/09_phase-09-payroll.md` | `docs/_retired/.cursor/plans/gradix-core/09_phase-09-payroll.md` | Plan Faze 9 — obračun sati i export. |
| `.cursor/plans/gradix-core/10_phase-10-erp-lite.md` | `docs/_retired/.cursor/plans/gradix-core/10_phase-10-erp-lite.md` | Plan Faze 10 — partneri, troškovi, lager. |
| `.cursor/plans/gradix-core/11_phase-11-iot-fleet.md` | `docs/_retired/.cursor/plans/gradix-core/11_phase-11-iot-fleet.md` | Plan Faze 11 — IoT GPS uređaji. |
| `.cursor/plans/gradix-core/CHANGELOG.md` | `docs/_retired/.cursor/plans/gradix-core/CHANGELOG.md` | Hronologija izmjena plana. |
| `.cursor/plans/gradix-core/CHECKLIST.md` | `docs/_retired/.cursor/plans/gradix-core/CHECKLIST.md` | Master checklist implementacije po fazama (tvrdi 100 %). |
| `.cursor/plans/gradix-core/HANDOFF.md` | `docs/_retired/.cursor/plans/gradix-core/HANDOFF.md` | Handoff između sesija (2026-08-17): šta je urađeno, test status, rizici. |
| `.cursor/plans/gradix-core/PLAN_FREEZE.md` | `docs/_retired/.cursor/plans/gradix-core/PLAN_FREEZE.md` | Zamrznuti obim v1 (faze 1–11), cross-cutting pravila i katalog error kodova. |

## Uklonjeno bez premještanja (odluka P10)

| Putanja | Šta je bilo | Zašto je uklonjeno | Kako vratiti |
|---|---|---|---|
| `backup/migrations/**` | 9 starih **MySQL** migracija + `migration_lock.toml` | zamijenjene jednom PostgreSQL migracijom `20261102130000_init_postgres`; nisu izvršive ni potrebne | `git checkout 5679a4b -- backup/migrations` (ili `git show 5679a4b:backup/migrations/<fajl>`) |
| `backend/README.md` | generički NestJS starter README | nije opis projekta; zamijenjen sa `docs/BACKEND.md` | `git show 5679a4b:backend/README.md` (premješten u `docs/_retired/backend/README.md`) |

## Šta je preneseno u novu dokumentaciju

| Izvor | Gdje sada živi |
|---|---|
| `PLAN_FREEZE.md` (invarijante, error kodovi, defaulti) | `docs/BACKEND.md` §4–§6, `docs/DECISIONS.md` |
| `.cursor/docs/DECISIONS.md` | `docs/BACKEND.md` §6, `docs/DECISIONS.md` |
| `.cursor/docs/DOMAIN.md` (glosar) | `docs/ARCHITECTURE.md` §2 |
| matrice (ponašanje po feature-u) | pravila po modulu u `docs/BACKEND.md` (konsolidovano u segmentima) |
| `DEPLOYMENT_COOLIFY.md`, `ENV_LIST.md` | `docs/INFRASTRUCTURE.md` |
| `PLAN_FREEZE.md` (paleta), `.cursor/rules` (boje) | `docs/FRONTEND.md` §4 (nova paleta — odluka P8) |
