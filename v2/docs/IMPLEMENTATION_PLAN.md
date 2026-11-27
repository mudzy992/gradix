# IMPLEMENTATION_PLAN — Gradix v2

**Status:** predlog za odobrenje (2026-11-23) · **Osnova:** `docs/specs/01…12` (Faza 1 zaključena) · **Brief:** A4, A6, B8, B12
**Pravilo:** nijedna izmjena `apps/*`, `packages/*` ni migracija dok vlasnik ne kaže **„KREĆEMO U KODIRANJE“**.

---

## 0. Polazno stanje (mjerljivo)

| Pokazatelj | Sada |
|---|---|
| Migracije / tabele | 32 / 49 |
| `schema.prisma` modela | 9 od 49 (lažna šema: pokriva samo R1/R2a) |
| API rute | 82 (`routes.ts` 107 navoda vs OpenAPI 105 — nesklad) |
| Web ekrani | 20 modula u `/ured` + `/pregled` |
| Mobilni ekrani | 9, sync za 7 entiteta |
| `apps/worker` | ne postoji |
| Obavještenja (tabela, inbox, push, email) | ne postoje |
| Izvještaji (PDF/XLSX) | ne postoje (samo CSV sati) |
| Maestro tokovi | 11, nestabilni u CI |
| CI | `ci-v2.yml`, ~35 koraka, **9m1s** (limit 10 min) |

**Cilj plana:** svaka faza ostavlja sistem **deployabilnim** i **provjerenim**; tehnički dug se ne gomila iza funkcionalnosti.

---

## 1. FAZA 0 — Tehnički dug prije novih funkcionalnosti

> Trajanje: ~1 sedmica. Nijedna nova poslovna funkcionalnost dok Faza 0 nije zelena.

### 0.1 `schema.prisma`: konačna odluka — **SQL-first + generisani tipovi**

**Odluka:** Prisma se **uklanja iz toka izgradnje**. Baza je izvor istine; migracije su ručno pisani, naprijed-samo SQL (već tako radimo 32 migracije). Tipovi se **generišu iz baze**, ne iz šeme.

- `packages/db/src/schema.generated.ts` — generisano sa **`kysely-codegen`** iz žive baze (`DATABASE_URL` sa read-only rolom), u CI provjereno da je sinhrono (`pnpm db:types:check` → diff prazan).
- **Zašto kysely-codegen, a ne `pg-typed`:** radi bez izmjene upita (tipovi su `interface`, ne obavezni query builder), pokriva `VIEW`/`ENUM`/nullable tačno, i ne uvodi runtime zavisnost. Query builder (Kysely) **nije** obavezan — upiti ostaju parametrizovani SQL kroz `withCompany`.
- `packages/db/src/index.ts` izvozi generisane tipove (`DbWorker`, `DbProject`, …) pored `withCompany`.
- `schema.prisma` se **briše** iz repoa (uz ADR 0015 koji zamjenjuje ADR 0002), zajedno sa `prisma` skriptama u `package.json` i koracima u CI.
- Provjera: `pnpm typecheck` mora proći sa generisanim tipovima; nijedan `any` u servisima koji dodiruju bazu (ESLint pravilo).

**Alternativa odbačena:** vraćanje Prisma klijenta — 9 modela bi trebalo ručno mapirati na 49 tabela, a `schema-engine` blokada je i dalje stvarna u dijelu okruženja.

### 0.2 Zajednički `attachment-service`

Danas postoje **tri** paralelna pristupa (`obligation_attachments`, `tender_attachments`, `machine_daily_check_attachments`), svaki sa svojim register/confirm/url rutama.

- Jedan servis: `packages/domain/src/attachments.ts` (validacija: tip, veličina, sha256) + `apps/web/src/server/attachment-service.ts` (register → presigned PUT → confirm → url → purge).
- Jedna tabela `attachments (id, company_id, entity_type, entity_id, object_key, file_name, content_type, size_bytes, sha256, status, retention_until, created_by, …)` sa `entity_type` CHECK listom; postojeće tri tabele se **migriraju** (prenos redova + view za kompatibilnost jedan release, zatim drop).
- API: `/api/attachments` (register/confirm/url/delete-request) — **jedan obrazac za sve module**.
- RLS + `privilege-matrix.tsv` + preflight; `DELETE` grant ne postoji (brisanje je status + purge u workeru).

### 0.3 `canUseEntity` motor blokada

Danas su provjere rasute (dodjele, ture, sati mašine, gorivo). Spec 02/05 traže **jedno** mjesto.

- `packages/domain/src/can-use-entity.ts`: ulaz `{entityKind: 'WORKER'|'MACHINE', entityId, usage: 'ASSIGN'|'HAUL'|'MACHINE_HOURS'|'FUEL'|'WORKDAY', onDate}`, izlaz `{allowed: boolean, blocks: Cause[], warns: Cause[]}`.
- Izvori: `obligations` (Modul 2) + `machine_faults`/`service_orders` (5/9) + `maintenance_plans` (9).
- Servisni sloj `checkUse()` koji puni izvore jednim upitom (batch za listu entiteta) i **jedan** test matrica: worker × {istekao ljekarski, istekao ROC, aktivan kvar, istekao preventivni servis} × usage.
- UI komponenta `<UsageWarning>` — koristi je svaki ekran koji dodjeljuje; **ista poruka** svuda.

### 0.4 `apps/worker` + `notifications` kostur

- `apps/worker`: Node 22, `pg-boss`, `withCompany` sa sistemskim tenantom po poslu; `boss.work()` registracija; graceful shutdown; Dockerfile.
- Poslovi u Fazi 0: samo `ping.health` + `notifications.deliver` (in-app uvijek, email `BLOCKED_NO_PROVIDER`, push stub).
- `notifications` + `notification_preferences` + `notification_deliveries` (spec 12 §1.2) — inbox `/obavjestenja`, zvonce u shellu sa brojem.
- `/api/health` proširen stanjem reda (zaglavljeni poslovi, zadnji heartbeat).
- **Ovo je temelj za sve module**: svaki sljedeći modul samo poziva `notify()`.

### 0.5 Higijena (jednom, zauvijek)

- `routes.ts` vs OpenAPI: generisanje OpenAPI **iz** `routes.ts` (jedan izvor), test da brojevi odgovaraju.
- `privilege-matrix.tsv` + preflight: provjera da svaka nova tabela ima RLS politiku **i** grant — postaje CI korak, ne ručna disciplina.
- `AGENTS.md` osvježen (putanje, komande, pravila iz ovog plana).
- Ukloniti `node_modules` artefakte iz praćenja, provjeriti `.gitignore` (Korak 0 je to većinom uradio).

**Checkpoint 0 (tag/commit):** `chore(phase-0)`, CI zelen, deploy prolazi, aplikacija radi isto kao prije — bez novih ekrana.

---

## 2. Faze izgradnje — vertikalni presjeci

Svaka faza = **migracija + domena + servis + API + web UI (+ mobilno gdje spec traži) + testovi**, sa deployom na kraju. Redoslijed je od jezgra ka rubovima; zavisnosti su eksplicitne.

### Faza 1 — Jezgro i pristup (Modul 1)
- `companies` proširenje (postavke, `planned_hours_per_month`, pragovi, `night_from/to`, `holiday_paid`, `min_markup_pct`, pragovi nabavke i servisa), `company_holidays`.
- 2FA (TOTP + recovery kodovi) za OWNER/ADMIN/ACCOUNTANT, sesije po uređaju, `user_devices`, odjava na daljinu, politika lozinke, onboarding wizard, `/ured/postavke` 4 taba, `platform_users`.
- **Isporuka:** firma se može ispravno konfigurisati; svi pragovi iz spec 5/6/7/9/11 postoje.

### Faza 2 — Obaveze s rokom (Modul 2)
- `obligation_requirements`, dinamički `missing`, „Kreiraj sve nedostajuće“, bulk renew, Excel import, CSV/PDF, kalendar, `reminder_days` po tipu, jedno eskaliranje OWNER-u.
- `canUseEntity` se **puni** iz obaveza i koristi na dodjelama (Modul 3 je već sada).
- **Isporuka:** nijedan rok ne promakne; blokade dodjele rade kroz jedan motor.

### Faza 3 — Radnici i radno vrijeme (Moduli 3 + 4)
- `worker_rates`, `worker_leave_entitlements`, `worker_issuances`, `ppe_templates`, `worker_history`, ressentitive polja + audit.
- Timer-first `Moj dan`, `day_kind`, forgotten day, `rounding_minutes`, bulk foreman confirm, sedmična matrica, `sync_conflicts` sa `entity_type`.
- Mobilno: `moj-dan`, `grupa`, profil radnika.
- **Isporuka:** jedini izvor sati postoji i radi offline; satnica ima historiju.

### Faza 4 — Mehanizacija (Modul 5)
- `machine_cost_components`, `machine_cost_rate_snapshots`, `fuel_prices`, `fuel_tanks`, `check_templates`, `route_segments` numerika, dvostruka dodjela, `RENTED`.
- Mobilno: `sati-masine`, `gorivo`, `ture`, `dnevni-pregled`, `kvarovi` (postoje — proširenje na šablone i cijene).
- **Isporuka:** trošak mašine po satu je objašnjiv; gorivo ima jedan izvor istine.

### Faza 5 — Projekti, budžet i troškovi (Modul 6) ⚠️ najveći rez
- `project_phases`, `cost_categories`, `project_budget_lines`, **`cost_entries`** (zamjena `project_cost_entries`), `project_boq_items`, `project_amendments`, `project_tasks`, `budget_alert_events`, `project_close_snapshots`.
- Automatsko knjiženje iz Modula 3/5/7/9 — **prvi put** trošak rada ulazi u projekat.
- Web: kartica projekta sa 8 tabova; `/pregled` dobija maržu i rizične projekte.
- **Isporuka:** „stvarni trošak naspram budžeta u svakom trenutku“ postaje istinit; `bookProjectCosts` nestaje.

### Faza 6 — Obračun sati (Modul 7)
- `pay_periods`, `payroll_components`, `payroll_parameters`, `payroll_runs`/`lines`/`line_sources`, `worker_advances`, `pay_corrections`.
- Klasifikacija sati (praznik > nedjelja > noćni > prekovremeni > redovni) u domeni sa testom; XLSX dva lista; `payroll.own.view`; `SELF_APPROVAL_FORBIDDEN`.
- **Isporuka:** računovođa prestaje sabirati u Excelu; svaki iznos ima raspis.

### Faza 7 — Tenderi (Modul 8)
- Prošireni statusi (`OPPORTUNITY…CANCELLED`), datumi, kalkulacija, revizije cijene, checklista, garancije, ishod, uspješnost, **konverzija** koja prenosi vrijednost/predmjer/faze/dokumente/tim.
- `MATRIX.md` + parity test ažurirani u istom commitu.
- **Isporuka:** tender → projekat bez drugog unosa.

### Faza 8 — Servis i održavanje (Modul 9)
- `service_orders`, `service_order_events`/`parts`, `maintenance_templates`/`plans`, `stock_items`/`stock_movements` (minimum), garancija na popravku, MTBF/MTTR.
- `approval_requests.subject_type` proširen; `cost_entries.source_type + SERVICE_ORDER`.
- **Isporuka:** radionica ima red čekanja; preventiva se ne zaboravlja.

### Faza 9 — Dnevnik i HSE (Modul 10)
- `site_diaries`/`items`/`revisions`/`templates`, `hse_incidents`/`updates`/`investigation`/`actions`/`trainings`/`inspections`, PDF sa `DRAFT_FORMAT`.
- Mobilno: `/dnevnik`, `/hse/prijava` (offline), `/hse/toolbox`.
- **Isporuka:** zakonski dokument i HSE evidencija rade offline.

### Faza 10 — Skladište, nabavka, podizvođači (Modul 11)
- `warehouses` (3 tipa, cisterna migrirana), `stock_item_levels`, `stock_counts`, `purchase_requests`/`orders`/`goods_receipts`/`invoices`, `material_issues`, `partner_roles`, `subcontractor_contracts`/`statements`.
- **Isporuka:** nabavka i podizvođači ulaze u budžet; dupli račun je nemoguć.

### Faza 11 — Dashboard, izvještaji, worker, mobilno (Modul 12)
- Dashboard po roli, `report-service` (7 izvještaja, PDF/XLSX), globalna pretraga `pg_trgm`, izvozi iz listi, `data_health`, preostali worker poslovi, push, mjesečni izvještaj.
- **Isporuka:** pilot spreman za vlasnika: „šta moram danas“ + brojke koje se mogu odštampati.

### Faza 12 — Konsolidacija i pilot
- Seed demo podaci kroz **iste servise** (ne direktan SQL), kontrolna lista pilota, opterećenje (80 radnika / 40 mašina / 12 projekata), sigurnosni pregled (RLS, grant, rate limit), backup/restore vježba.
- **Isporuka:** pilot na `https://gradix.ba101.top`.

---

## 3. CI/CD i kvalitet

### 3.1 CI (cilj: ≤ 8 min, trenutno 9m1s)
- **Keširanje:** pnpm store + Turborepo remote/local cache; `typecheck`/`test`/`lint` samo za pogođene pakete (`--filter=[origin/main]`).
- **Paralelizacija:** `verify` se dijeli na `lint+typecheck`, `unit`, `integration (postgres)`, `e2e-web`, `build` — svaki job svoj `timeout`.
- **Integracioni testovi** dobijaju jednu bazu po jobu sa paralelnim šemama (bez serijalizacije kroz jedan Postgres).
- **Maestro** ne ide u svaki PR — noćni `mobilni-e2e.yml` + `workflow_dispatch` za stabilnost; u PR-u samo `maestro --dry-run` validacija YAML-a.
- **`db:types:check`** kao korak (generisani tipovi sinhroni sa migracijama).
- **Preflight** (RLS + grant + matrica) kao korak, ne ručno.

### 3.2 Testovi — obavezni po fazi
- **Domena:** čista funkcija = test prije UI. Finansijske i satne funkcije **moraju** imati test: `cost_entries` idempotencija, klasifikacija sati, budžetski pragovi, alokacija zadržavanja, prosječna cijena zaliha, MTBF/MTTR, LTIFR, EAC.
- **Integracija:** svaka RLS tabela ima test izolacije (firma B ne vidi A) — obrazac već postoji, proširiti na sve nove tabele.
- **Zlatni testovi za novac:** fiksni scenariji (radni dan × satnica × množioci) sa očekivanim iznosom u centima; promjena formule ruši test.
- **E2E (`Playwright`):** jedan tok po fazi (ne po ekranu), `@smoke` za PR, `@deep-*` noćno.

### 3.3 Pristupačnost i UI
- `eslint-plugin-jsx-a11y` u flat configu (već ESLint 9) — greška, ne upozorenje.
- `axe-core` preko `@axe-core/playwright` na **svakom ekranu** u `@smoke` setu; prag: 0 ozbiljnih/kritičnih prekršaja.
- Fokus: dijalog hvata fokus jednom (postojeći obrazac), `Esc`, `returnFocusTo`; tastatura za `Cmd/Ctrl+K`.
- Kontrast i veličine iz `DESIGN.md`; terenske mete ≥ 56 dp (postojeći test).
- Kompaktnost: tabele sa `sticky` zaglavljem, bez horizontalnog skrola na 1280 px.

### 3.4 Maestro stabilizacija
- Ukloniti zavisnost od tajminga: `extendedWaitUntil` sa eksplicitnim uslovom umjesto `waitForAnimationToEnd`.
- Deterministički seed (`@demo.test`) prije svakog toka; jedan tok = jedna svježa baza.
- Tagovi: `smoke` (3 toka: prijava, moj dan, grupa), `deep` (ostali).
- Mjerenje: 20 uzastopnih prolaza bez retryja (postojeći `e2e_stabilnost` input) kao **izlazni kriterij** faze.

### 3.5 Rad na grani i checkpointi
- Rad isključivo na aktivnoj grani sesije (`arena/44b867b0-gradix`), commit po vertikalnom presjeku.
- **Checkpoint po fazi:** tag `phase-N` + kratak zapis u `docs/STATUS.md` (šta je isporučeno, koji testovi, poznata odstupanja).
- **Definition of Done po fazi:** migracija + RLS + grant + preflight; servis + API + OpenAPI; web UI; mobilno (ako spec traži); testovi (domena + izolacija + E2E tok); `docs/STATUS.md` ažuriran; CI zelen; deploy na staging.
- Rollback: svaka faza ima migraciju koja ne ruši prethodnu (naprijed-samo, bez `DROP` bez prethodnog prenosa podataka) — `project_cost_entries → cost_entries` je prvi takav slučaj i ide u dva koraka (prenos + view, pa drop).

---

## 4. Redoslijed i zavisnosti (sažeto)

```
F0 dug ──► F1 jezgro ──► F2 obaveze ──► F3 radnici+sati ──► F4 mehanizacija
                                                                    │
                                                                    ▼
                                              F5 projekti/budžet/troškovi
                                                    │              │
                                     ┌──────────────┘              └────────────┐
                                     ▼                                          ▼
                              F6 obračun sati                            F7 tenderi
                                     │                                          │
                                     └──────────────► F8 servis ◄───────────────┘
                                                        │
                                                        ▼
                                                   F9 dnevnik/HSE
                                                        │
                                                        ▼
                                              F10 skladište/nabavka
                                                        │
                                                        ▼
                                          F11 dashboard/izvještaji/mobilno
                                                        │
                                                        ▼
                                                F12 pilot
```

Kritična staza: **F0 → F3 → F5 → F6** (bez sata i troška nema obračuna ni budžeta). F7 (tenderi) može paralelno sa F6 jer ne dijeli tabele; F8 zavisi od F5 (trošak) i F4 (kvarovi).

---

## 5. Rizici i mjere

| Rizik | Mjera |
|---|---|
| F5 (`cost_entries`) je najveći rez — migracija dirа trošak | Dvostepena migracija (prenos + view, pa drop), zlatni testovi prije i poslije, rollback plan |
| `schema.prisma` uklanjanje lomi postojeći CI | Faza 0 to rješava prvo; generisani tipovi ulaze prije brisanja |
| Obračun sati dira zakon (entiteti FBiH/RS/Brčko) | Nijedan procenat u kodu; `payroll_parameters` sa datumom važenja; `PARAMETER_MISSING`; pisana potvrda računovođe prije F6 |
| Maestro nestabilan → CI nepouzdan | Tagovi + noćno pokretanje + deterministički seed |
| Obim (12 modula) | Vertikalni presjeci; svaka faza deployabilna; nema „big bang“ |
| Dupli izvori brojeva (trošak, sati) | Pravilo „jedan izvor“ iz spec 6/12, provjereno testom da izvještaj = ekran |

---

## 6. Šta tražim da potvrdiš prije kodiranja

1. **SQL-first + `kysely-codegen`** kao konačna odluka (brisanje `schema.prisma`, ADR 0015).
2. **Faza 0 prije svega** (dug: tipovi, `attachment-service`, `canUseEntity`, worker + notifications).
3. Redoslijed faza **F1→F12** kako je gore (kritična staza F0→F3→F5→F6).
4. **Checkpoint po fazi** (`phase-N` + `docs/STATUS.md`), rad na aktivnoj grani.
5. CI politika: Maestro van PR-a, `axe-core` u `@smoke`, `db:types:check` + preflight kao obavezni koraci.

Nakon tvoje riječi **„KREĆEMO U KODIRANJE“** počinjem Fazu 0, prvi commit: `chore(phase-0): generisani tipovi iz baze`.
