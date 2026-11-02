# 02 — Master audit plan (FAZA 2)

| | |
|---|---|
| **Datum** | 2026-11-02 |
| **Grana** | `arena/0bc0e56e-gradix` |
| **Osnova** | `AUDIT/00_PROJECT_UNDERSTANDING.md`, `AUDIT/01_DOCS_VS_REALITY.md`, `docs/**` |
| **Kapija** | **KAPIJA 2** — nakon ovog plana + inventara (`AUDIT/COVERAGE_MATRIX.csv`) stojim i čekam odobrenje |

> Ovaj dokument je **radni nalog**: šta se radi, kojim redom, kako se mjeri da je gotovo i šta
> se ne dira. Segment ID-evi su obavezujući i koriste se u commitima, matrici i `AUDIT/STATE.md`.

---

## 1. Ciljevi (mjerljivi)

| Sloj | Kriterij „gotovo“ (mjerljivo) |
|---|---|
| **Infra** | `docker compose config` bez host portova; svi servisi `healthy` u CI-ju; entrypoint preflight pokriven testom; tri runbooka (deploy, restore, troubleshooting) u `docs/INFRASTRUCTURE.md` |
| **CI** | Push okida **samo aktivna grana**; `workflow_dispatch` sa izborom suite-a; akcije pinovane po SHA; static gate (lint/format/types/secret/audit) + coverage prag + audit gate; mobile job posljednji; artefakti (JUnit, coverage, Playwright report, Maestro video); ukupno < 8 min |
| **Backend** | Svaki endpoint: validacija + auth pravilo + test; 0 `any`; 0 neobrađena Prisma greška na granici; env validacija pri startu; unit coverage za `common/` ≥ 70 %; svaki modul ima `docs/BACKEND.md` unos |
| **Frontend** | 0 sirovih boja/spacing-a van tokena; WCAG 2.2 AA (axe bez critical/serious na ključnim ekranima); svaka stranica ima loading/empty/error stanja; E2E za 8 ključnih tokova; bundle budžet |
| **Mobile** | Unit testovi za `sync/`, `timer-actions`, `permissions`; Maestro E2E (login → promjena lozinke → timer → tura → sync → logout) zelen u CI-ju; 0 `any`; `offline-bar` prikazuje stanje reda |
| **Standardi** | `npm run check:all` prolazi lokalno i u CI-ju; svaki guard ispisuje pravilo/lokaciju/zašto/ispravku; svaki izuzetak u konfiguraciji sa obrazloženjem |
| **Audit** | `AUDIT/COVERAGE_MATRIX.csv` pokriva 100 % fajlova; `check-coverage` u CI-ju; nijedan segment nije „done“ sa nepregledanim fajlom |

---

## 2. Pravila izvršavanja

1. Jedan segment = jedna sesija: **analiza → nalazi → (pitanja) → popravke → testovi → lokalna
   verifikacija → commit → push → CI zelen → matrica + STATE → zatvaranje**.
2. Bez promjene vidljivog ponašanja, API ugovora ili šeme baze bez **prethodnog** odobrenja.
3. Svaki popravljeni bug = regression test u istom segmentu.
4. Segment je „done“ **samo** kad su svi njegovi fajlovi u matrici na `pregledano` /
   `popravljeno` / `pokriveno testom` i DoD checklista je ✅.
5. `check-coverage` u CI-ju pada ako: fajl nije u matrici, matrica ima zastario red, segment
   „done“ ima nepregledane fajlove, ili segment iz matrice ne postoji u `segments.json`/planu.

---

## 3. Redoslijed izvršavanja (i zašto)

```
STD-01 ─▶ CI-01 ─▶ CI-03 ─▶ CI-04 ─▶ CI-05(već postoji skelet) ─▶ INF-01…INF-03
      ─▶ BE-01 ─▶ BE-02 ─▶ BE-03 ─▶ BE-04 ─▶ (BE-05…BE-18)
      ─▶ FE-01 ─▶ FE-02 ─▶ FE-03 ─▶ FE-15 ─▶ (FE-07…FE-16) ─▶ FE-04
      ─▶ MOB-01 ─▶ MOB-02 ─▶ MOB-04 ─▶ MOB-03 ─▶ MOB-06
      ─▶ CI-07 (mobile E2E, posljednji) ─▶ MOB-05
```

**Zašto tako:** (a) guardrail skripte prvo — inače svaki sljedeći segment „zagađuje“ standarde;
(b) CI okidači/pinning prije sadržaja — da svaki commit ima isto mjerenje; (c) backend prije
frontenda — frontend zavisi od ugovora; (d) dizajn tokeni prije ekrana — da se ne prepisuje CSS
dva puta; (e) admin dashboard redizajn **nakon** tokena i a11y pravila i **nakon odobrenja IA**;
(f) mobile E2E na kraju — najskuplji job i najosjetljiviji na promjene API-ja.

---

## 4. Segmenti

> Kolone: **Ulaz** = fajlovi/dokumenti koje segment dira; **Rizik** = vjerovatnoća da mijenja
> vidljivo ponašanje / da zasmeta drugima; **DoD** = dodatni kriteriji osim opštih iz §1.

### 4.1 Standardi i alat (STD)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **STD-01** | `scripts/standards` + `check:all` | `scripts/standards/**`, root `package.json` (novi), `docs/CONVENTIONS.md` | nizak | 12 skripti iz `CONVENTIONS.md` §7 rade; izuzeci u `standards.config.json` sa obrazloženjem |
| **STD-02** | Docs guard (linkovi + `_retired` baner + „docs u istom commitu“) | `scripts/standards/check-docs.mjs`, CI | nizak | link check preko cijelog `docs/`; baner obavezan u `_retired`; pad ako `docs/` nije diran uz promjenu ruta/env-a |

### 4.2 CI (CI)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **CI-01** | Okidači: samo aktivna grana, bez PR-a | `.github/workflows/ci.yml`, `docs/CI.md` | nizak | `pull_request` uklonjen; `docs/CI.md` navodi aktivnu granu |
| **CI-02** | `workflow_dispatch` inputi (suite/verbose/tag) | isto | nizak | jobovi poštuju `inputs.suite`; `all` = sve |
| **CI-03** | Pinning po SHA, `timeout-minutes`, cache | isto | nizak | nijedna akcija nije na `@vN`; svaki job ima timeout |
| **CI-04** | Static gate + coverage prag | isto, `backend/package.json` | srednji | secret scan, `npm audit --omit=dev`, license check, `coverageThreshold` (TEST-01 pragovi) |
| **CI-05** | Audit gate (matrica + docs u raskoraku) | `scripts/audit/**` (postoji), CI | nizak | job `audit` zelen; pad na zastarjelu matricu (implementirano u FAZI 3) |
| **CI-06** | Web E2E izvještaji + axe | `frontend/e2e/**`, workflow | nizak | trace/video na failure; `axe` bez critical/serious na 5 ekrana |
| **CI-07** | Mobile job (Jest + Maestro, posljednji) | workflow, `mobile/**` | **visok** (emulator, trajanje) | job `needs` sve ostale; retry samo infra; artefakti; < 12 min |

### 4.3 Infrastruktura (INF)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **INF-01** | Compose i mreže (finalizacija) | `docker-compose.yml`, `docker-compose.local-ports.yml`, `.env.*` | srednji | resource limiti; komentari = stvarno stanje; guard testovi u CI-ju |
| **INF-02** | Backend image + entrypoint | `backend/Dockerfile`, `Dockerfile`, `backend/docker-entrypoint.sh` | srednji | non-root korisnik; pinovan base image; preflight test u CI-ju (postoji) |
| **INF-03** | Frontend image + nginx | `frontend/Dockerfile`, `Dockerfile.frontend`, `frontend/nginx/**` | srednji | non-root nginx; security headeri; gzip/brotli; healthcheck |
| **INF-04** | Strukturisano logovanje | `backend/src/main.ts`, `app.setup.ts`, novi logger | srednji | JSON logovi, korelacioni ID, nema PII u logu |
| **INF-05** | Health/readiness | `modules/health/**` | nizak | `/api/health` (liveness) + `/api/ready` (DB + MinIO + migracije) |
| **INF-06** | Backup/restore runbook + skripte | `scripts/ops/**`, `docs/INFRASTRUCTURE.md` | nizak | `backup.sh`/`restore.sh` + test restore u CI-ju (noćni, `schedule`) |
| **INF-07** | Redis: aktivirati ili ukloniti | compose, `docs/INFRASTRUCTURE.md` | **odluka** | vlasnik bira; env/mreža se usklađuju sa odlukom |

### 4.4 Backend (BE)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **BE-01** | Temelj API-ja: config, greške, ugovor | `main.ts`, `app.setup.ts`, `app.module.ts`, `common/{constants,dto,errors,filters,interceptors,decorators,guards,utils,types}`, `modules/prisma`, `prisma/schema`, `prisma.config.ts` | srednji | env validacija pri startu; mapiranje Prisma grešaka; envelope testovi |
| **BE-02** | Auth | `modules/auth/**` | **visok** | refresh reuse, `mustChangePassword`, throttle — sve pokriveno testom |
| **BE-03** | Korisnici, role, scope | `modules/users/**`, `common/rbac/**`, `common/scope/**` | **visok** | IDOR testovi; unija permisija; temp lozinka jednom |
| **BE-04** | Firme, podešavanja, audit | `modules/companies/**`, `modules/settings/**`, `common/settings/**`, `modules/audit/**` | srednji | slug immutable; `X-Company-Id` pravila; defaulti settings |
| **BE-05** | Projekti, faze, dodjele, dokumenti | `ops/projects*`, `ops/phases*`, `ops/assignments*`, `ops/documents*` | srednji | scope po roli; terminalni statusi blokiraju write |
| **BE-06** | Zadaci i dispečing | `ops/tasks*`, `ops/task-*`, dispatch | srednji | complete = `tasks.write`; notifikacije assigneeima |
| **BE-07** | Timer i ispravke | `ops/timer*`, `ops/amendments*`, `timer-cron` | **visok** | mutex po useru i mašini; pauza ne teče; auto-close 12 h; sati mašine |
| **BE-08** | Seed, migracije, demo podaci | `prisma/seed*.ts`, `prisma/migrations/**` | srednji | `seed-prod` (1 platform admin, D-009); demo seed odvojen |
| **BE-09** | Flota i IoT | `ops/machines*`, `machine-*`, `gps*`, `iot*`, `locations*` | srednji | 1 uređaj/mašini; ključ nikad u GET; throttle |
| **BE-10** | Logistika: ture, gorivo, šifarnici | `ops/trips*`, `fuel*`, `depots*`, `catalog*`, `materials*` | srednji | immutable poslije sync; picker pravila |
| **BE-11** | Dnevnik, HSE, fajlovi | `ops/diary*`, `incidents*`, `modules/files/**`, `common/utils/storage-path.ts` | srednji | unique dnevnik; foto limiti; path guard |
| **BE-12** | Dashboard i prisustvo | `ops/dashboard*`, `geofence-notify`, `presence*` | nizak | KPI po roli; presence info-only |
| **BE-13** | Payroll | `modules/payroll/**` | **visok** | mjesec u TZ; self-approve blokiran; export tačan |
| **BE-14** | ERP-lite | `modules/erp/**` | srednji | `CostEntry` unique; `apply-stock` idempotentno |
| **BE-15** | Ured: tenderi, servis, dokumenti, reporti | `modules/polish/**` | srednji | statusi; force-close; fiksni reporti |
| **BE-16** | Javni sajt, notifikacije, email | `modules/public/**`, `notifications/**`, `mail/**`, `common/notify/**` | srednji | DTO whitelist; email stub → odluka |
| **BE-17** | Sync (serverska strana) | `ops/sync*` | srednji | idempotentnost; TTL katalog |
| **BE-18** | Health | `modules/health/**` | nizak | pokriveno u INF-05, ovdje samo API ugovor |

### 4.5 Frontend (FE)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **FE-01** | Design tokeni + paleta | `src/index.css`, `src/lib/theme*`, `docs/FRONTEND.md` | **odluka** (paleta) | predlog palete odobren; tokeni kompletni; 0 sirovih vrijednosti |
| **FE-02** | Shell, navigacija, layout | `routes/**`, `components/layout/**`, `App.tsx`, `main.tsx`, `vite.config.ts`, `index.html`, config paketa | nizak | nav iz permisija; mobilni Sheet; guardovi |
| **FE-03** | A11y (WCAG 2.2 AA) | sve stranice + `components/ui/**` | srednji | fokus, labele, kontrast, tastatura; axe prag |
| **FE-04** | Admin dashboard (IA + redizajn) | `pages/dashboard-page.tsx`, `components/layout/**` | **visok** (odobrenje) | IA + wireframe odobreni; pa implementacija |
| **FE-05** | Testovi (unit/component) | `src/**/*.test.tsx` (novi) | nizak | helperi + 3 komponente |
| **FE-06** | E2E tokovi | `e2e/**`, `playwright.config.ts` | nizak | page objects + fixtures + 8 tokova |
| **FE-07** | Auth stranice | `login/forgot/reset/change-password-page.tsx` | nizak | stanja + validacija + a11y |
| **FE-08** | Operacije (projekti, zadaci) | `projects-*`, `tasks-*`, `components/ops/**`, `project-tabs`, `planned-gantt`, `quantity-tab`, `dispatch-sheet` | srednji | tabele (sort/filter/paginacija), forme |
| **FE-09** | Flota i logistika | `fleet-*`, `logistics-page.tsx` | srednji | mapa (Leaflet) + tabele |
| **FE-10** | Dnevnik, HSE, dokumenti | `diary-page`, `hse-page`, `documents-page`, `diary-conflict-sheet` | srednji | foto upload, konflikt |
| **FE-11** | Ured (tenderi, servis, reporti) | `tenders-page`, `services-page`, `reports-page` | nizak | statusi + exporti |
| **FE-12** | Payroll i ERP | `payroll-page`, `erp-page`, `erp-*-tab` | srednji | tabele + odobravanje |
| **FE-13** | Administracija | `settings-page`, `users-page`, `companies-page`, `company-switcher`, `registry-fields` | srednji | forme + permisije |
| **FE-14** | Javni sajt | `public-site-page`, `public-brand-fields`, `use-public-settings` | nizak | whitelisted prikaz, SEO meta |
| **FE-15** | i18n, store, helperi, hookovi | `i18n/**`, `stores/**`, `hooks/**`, `lib/**` | nizak | bs/en paritet; helperi testirani |
| **FE-16** | UI primitive | `components/ui/**` | nizak | varijante + a11y + dokumentovani tokeni |

### 4.6 Mobile (MOB)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **MOB-01** | Navigacija i shell | `app/**`, `app.json`, `babel.config.js`, `metro.config.js`, `package.json` | nizak | tabovi po permisijama; deep link |
| **MOB-02** | Auth i tokeni | `lib/auth-store.ts`, `lib/secure.ts`, `app/login.tsx`, `change-password.tsx` | srednji | secure store; refresh; logout |
| **MOB-03** | Unit testovi | `**/__tests__/**` (novi) | nizak | `queue`, `engine`, `timer-actions`, `permissions` ≥ 40 % |
| **MOB-04** | Offline sync + indikator | `db/client.ts`, `sync/**`, `components/offline-bar.tsx` | **visok** | broj zapisa i zadnji sync; konfliktno ponašanje dokumentovano |
| **MOB-05** | Maestro E2E | `mobile/e2e/**` (novi), CI | visok | 1 tok zelen u CI-ju (CI-07) |
| **MOB-06** | Greške, i18n, pristupačnost | `lib/errors.ts`, `i18n/**`, `components/**` | nizak | poruke po `error.code`; labele; kontrast |
| **MOB-07** | Build profili (EAS) | `eas.json` (novi) | odgođeno (D-003) | nakon stabilizacije API-ja |

### 4.7 Testovi (TEST)

| ID | Naziv | Ulaz | Rizik | DoD |
|---|---|---|---|---|
| **TEST-01** | Coverage infrastruktura + pragovi | `backend/package.json`, `test/jest-e2e.json`, CI | nizak | `jest --coverage` + prag 40 %; pragovi u `TESTING.md` |
| **TEST-02** | Unit pokrivenost `common/` | `backend/src/common/**/*.spec.ts` (novi) | nizak | pagination, scope, storage-path, iot-key, geo ≥ 70 % |

---

## 5. Standardi i alati po sloju (predlog + alternativa)

| Sloj | Alat / standard | Zašto | Alternativa (odbačena) |
|---|---|---|---|
| Format | **Prettier** (svi paketi) | jedan alat, nula rasprave | ESLint stylistic (sporiji, više konfiguracije) |
| Lint backend | **ESLint** (flat config postoji) | tipizirana pravila, `typescript-eslint` | oxlint (nedovoljna pokrivenost tipova) |
| Lint frontend | **oxlint** (postoji) | brzina u CI-ju | ESLint (sporiji; može se dodati kasnije) |
| Tipovi | `tsc --noEmit` / `tsc -b`, `strict` | već postoji | — |
| Testovi | Jest (BE/MOB), Playwright (FE), **Maestro** (MOB E2E) | odluke D-004/D-005 | Detox, Appium |
| Coverage | `jest --coverage` + `coverageThreshold` | jednostavno, bez servisa | Codecov (vanjski servis) |
| A11y | `axe-core` u Playwrightu | bez nove platforme | ručni audit (neponovljiv) |
| Secret scan | `gitleaks` (binarni, u CI-ju) | brz, bez konfiguracije | `trufflehog` (teži) |
| Deps audit | `npm audit --omit=dev` + `license-checker` | već dostupno | Snyk (vanjski servis) |
| Logovanje | **pino** (JSON) | standard, brz | Winston (teži), ručni logger |
| Env validacija | **zod** (već u frontendu) | jedno pravilo za sve slojeve | `joi` (duplikat), ručne provjere |
| Image pinning | digest + renovate | reproducibilnost | rolling tagovi (sadašnje stanje) |
| Inventar audita | `scripts/audit/inventory.mjs` (node, bez zavisnosti) | klasifikacija je u kodu, matrica se generiše | ručno vođenje tabele (zastari odmah) |
| Gate pokrivenosti | `scripts/audit/check-coverage.mjs` u CI jobu `audit` | fajl van matrice = crven CI | „disciplina“ (nije provjerljiva) |

Svaka nova zavisnost ide u `docs/DECISIONS.md` (D-006).

---

## 6. Zavisnosti između segmenata

| Segment | Zavisi od | Zašto |
|---|---|---|
| svi BE/FE/MOB | STD-01, CI-01, CI-03 | guardrail i mjerenje prije sadržaja |
| FE-03, FE-04 | FE-01 | tokeni i a11y pravila prije ekrana |
| FE-06 | FE-07…FE-14 | tokovi testiraju postojeće stranice |
| BE-08 (seed-prod) | BE-02, BE-03 | platform admin zavisi od auth modela |
| MOB-05 | CI-07 | E2E se pokreće u CI-ju |
| INF-05 | BE-18 | readiness endpoint = API ugovor |
| CI-04 | TEST-01 | coverage prag mora postojati prije gate-a |

---

## 7. Rizici i mitigacije

| Rizik | Uticaj | Mitigacija |
|---|---|---|
| Promjena vidljivog ponašanja „usput“ | visok | pravilo 1: stani i pitaj; segmenti sa rizikom „visok“ imaju eksplicitnu tačku odobrenja |
| Node/Docker/toolchain nedostupni lokalno | srednji | sve teške provjere kroz CI `docker` job; lokalno lint/types/build |
| Maestro/emulator nestabilan u CI-ju | visok | retry samo za infra; job posljednji; artefakti za dijagnozu |
| Prevelik broj segmenata (59) → spor napredak | srednji | spajati samo kad su isti fajlovi i isti rizik **uz zapis u STATE** |
| `check-coverage` blokira normalan rad | srednji | matrica se regeneriše skriptom; nove fajlove dodaje `inventory` automatski |
| Migracije/šema dirane bez odobrenja | visok | BE-01/BE-08 imaju obaveznu tačku odobrenja prije migracije |
| Tajne procure u logove/CI | visok | INF-04 (bez PII), CI-04 (secret scan), review checklista |

---

## 8. Otvorena pitanja (ne blokiraju početak, blokiraju pojedine segmente)

| # | Pitanje | Blokira |
|---|---|---|
| Q1 | Nova paleta: da li da pripremim 2 predloga (konzervativan + smjeli) sa kontrast tabelom? | FE-01 |
| Q2 | Email: implementirati SMTP sada (`nodemailer`) ili ostaviti stub i ukloniti `trySend` lažni uspjeh? | BE-16 |
| Q3 | Redis: ukloniti `REDIS_*`/`redis_net` iz v1 ili ostaviti rezervisano (INF-07)? | INF-07 |
| Q4 | Bundle budžet za web (initial JS gzip) — predlog 250 kB? | FE-06 |
| Q5 | Coverage prag 40 % sada (rast do 70 %) — prihvaćeno? | TEST-01 / CI-04 |

---

## 9.1 Struktura `AUDIT/segments/<ID>.md`

Skeletoni se generišu sa `node scripts/audit/scaffold-segments.mjs` (postojeći fajlovi se ne
prepisuju; `--force` regeneriše, `--check` provjerava da svih 59 postoji). Deset sekcija:

| # | Sekcija | Šta mora sadržavati |
|---|---|---|
| 1 | Svrha i obim | šta segment provjerava + izričita granica prema susjedima |
| 2 | Ulaz | zavisni segmenti, lista fajlova iz matrice, pretpostavke |
| 3 | Kriteriji završetka (DoD) | checklist iz §9, konkretizovan za segment |
| 4 | Trenutno stanje (dokazi) | tabela `tvrdnja | fajl:linija | ✅/⚠️/❌/❓` |
| 5 | Nalazi | `F-<ID>-NN`, težina (blokada/visoko/srednje/nisko), dokaz, odluka |
| 6 | Popravke | šta/zašto, odbačene alternative, nove zavisnosti |
| 7 | Testovi i verifikacija | komanda → rezultat |
| 8 | Rizici i rollback | rizik → kako se vraća |
| 9 | Dokumentacija | koji `docs/` fajl se mijenja (+ `DECISIONS.md` ako je odluka) |
| 10 | Zapis izvršavanja | datum, commit(ovi), CI run, status |

## 9. Definition of Done (svaki segment)

- [ ] Svi fajlovi segmenta u matrici: `pregledano` / `popravljeno` / `pokriveno testom`
- [ ] Nalazi upisani u `AUDIT/segments/<ID>.md` (sekcije iz FAZE 4)
- [ ] Popravke + regression testovi
- [ ] `npm run check:all` (kad postoji) + relevantni testovi zeleni lokalno
- [ ] Commit `type(scope): opis [ID]` + push + **CI zelen** (run ID u `AUDIT/STATE.md`)
- [ ] `docs/` ažuriran u istom commitu ako se ponašanje/konfiguracija mijenja
- [ ] `AUDIT/STATE.md`: šta je urađeno, šta je sljedeće, otvorena pitanja
