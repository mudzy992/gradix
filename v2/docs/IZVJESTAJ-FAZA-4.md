# Izvještaj — Faza 4: Mehanizacija

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Tag:** `phase-4` → `9d2b4ce` ·
**Spec:** `05-mehanizacija.md` (32 pravila / 7 sekcija, zaključano)

Faza 4 je isporučena kao **kompletna vertikala**: baza → domena → ugovor → API → web → provjere →
CI. Nijedan sloj nije ostavljen kao „doći će poslije“ — osim mjesta gdje ga spec izričito daje
drugom modulu (servisni nalog puni Modul 8).

---

## 1. Šta je napravljeno

### 1.1 Baza (2 migracije: `20261124160000_f4_1_mehanizacija`, `20261124160100_f4_2_pregled_i_servis`)

Ukupno sada **43 migracije, 73 tabele**. Sve nove tabele: `FORCE ROW LEVEL SECURITY` +
`tenant_isolation`, grantovi u `bootstrap/grants.sql`, redovi u `privilege-matrix.tsv`, unosi u
`check-tenant-sql` (lista tenant tabela je sada **64 = 64** prema katalogu baze).

| Tabela | Promjena | Zašto |
|---|---|---|
| `machine_cost_components` *(novo)* | komponenta + osnov `PER_HOUR`/`PER_KM`/`PER_MONTH`, važenje; `EXCLUDE` kad je `btree_gist` dostupan, inače **triger + `pg_advisory_xact_lock`** | Dvije važeće komponente istog tipa = dvostruko veći trošak u stopi; mehanizam se bira istim prekidačem kao dodjele i satnice, pa nema bezuslovnog `EXCLUDE`-a koji ruši server bez contrib-a |
| `machine_cost_rate_snapshots` *(novo)* | zamrznuta stopa + razlaganje | Trošak mora ostati dokaziv i poslije promjene komponenti |
| `fuel_prices` *(novo)* | cijena po vrsti goriva i datumu | Cijena je **predlog po datumu**, ne globalna konstanta |
| `fuel_tanks` *(novo)* | `capacity_l`, `current_l`, `is_active` | Cisterna je skladište sa stanjem; deaktivacija je UPDATE |
| `check_templates` *(novo)* | stavke (`key/label/required/critical`), kategorija opciona | Šablon po kategoriji mašine + rezervni opšti šablon |
| `service_orders` *(novo)* | `UNIQUE (company_id, fault_id)` | Jedan kvar = jedan nalog; **`APPROVED` ga otvara trigerom**, tačno jednom |
| `project_cost_entries` | `+ rate_snapshot`, `component_breakdown`, `snapshot_id`; `source_type` + `SERVICE_ORDER` | Snapshot se **ne može prepisati** (`COST_SNAPSHOT_IMMUTABLE`) |
| `machine_cost_rates` | `+ is_manual`, `reason` (CHECK ≥10 znakova kad je ručna) | Ručna stopa je **nadjačavanje sa razlogom**, ne tiho prepisivanje |
| `machine_daily_checks` | `+ template_id`, `photo_required`, `photo_confirmed_at/by` | Kritična FAIL stavka traži dokaz, a ne blokira rad |
| `fuel_entries` | `+ tank_id`, `price_source`, `deviation_*` | Nepoznat iznos ostaje `NULL` (**ne nula**), odstupanje je stanje reda |
| `route_segments` | `+ from_km/from_m/to_km/to_m` + CHECK parova i smjera | Dionica ima smjer; pola kilometraže ne ulazi ni u jedan zbir |
| `machines`, `project_assignments` | `RENTED` + rental kolone; dvostruka dodjela **globalna**, iznimka kroz `usage_overrides.double_booking_override_id` | Mašina ne može biti na dva gradilišta nigdje, ne samo unutar firme |
| `companies` | `+ fault_approval_threshold_cents`, `planned_hours_per_month`, `fuel_deviation_threshold_pct`, `fuel_tank_enabled` | Pragovi su **podaci firme**, ne konstante u kodu |

### 1.2 Domena (`packages/domain/src/machine-cost-components.ts`) — 18 novih testova (196 ukupno)

- `machineCostRate` — zbir komponenti; **zaokruživanje po komponenti na cent, pa sabiranje**;
  `PER_MONTH` → stoti dio centa, pa pola-naviše; `PER_KM` **ne ulazi** u satnu stopu (`0n`), ide
  kao `rateWithKm`.
- `utilization` — **dvije kolone**: primarna `WORK/(WORK+IDLE+BREAKDOWN)` i sekundarna kalendarska
  (radni dani iz `company_holidays`, `is_working = true` = prenesena radna subota).
- `mtbf`/`mttr` — `null` bez kvarova, nikad `0` (nula bi tvrdila da se mašina kvari beskonačno rijetko).
- `fuelDeviation` — `>=` prag (20,0 % **jeste** iznad), `baseline <= 0` → `{null,false}`.
- `fuelConsumption`, `stationingLength` (km+m → metri), `checklistCriticalFailures`.

### 1.3 API — 24 nove rute (OpenAPI **150 putanja / 195 operacija**)

| Grupa | Rute |
|---|---|
| Trošak | `GET/POST/PATCH /api/machines/{id}/cost-components`, `GET/POST /api/machines/{id}/cost-rate` |
| Iskorištenost | `GET /api/machines/{id}/utilization`, `GET /api/machines/{id}/availability`, `GET /api/calendar/availability` |
| Najam | `POST /api/machines/{id}/rental` |
| Gorivo | `GET/POST /api/fuel-prices`, `GET/POST /api/fuel-tanks`, `PATCH /api/fuel-tanks/{id}/count`, `GET /api/fuel-entries/deviations`, `PATCH /api/fuel-entries/{id}/explain` |
| Dionice | `GET/POST/PATCH /api/route-segments` |
| Pregledi | `GET/POST/PATCH /api/check-templates`, `POST /api/machine-daily-checks/{id}/photo` |

Nove dozvole: `machines.cost_rate.{view,manage}`, `machines.cost_component.manage`,
`machines.fuel_price.manage`, `machines.fuel_tank.manage`, `machines.fuel.deviation.review`,
`machines.check_template.manage`, `machines.utilization.view`.
Novi kodovi: `COST_SNAPSHOT_IMMUTABLE`, `COST_RATE_MANUAL_OVERRIDE`, `FUEL_DEVIATION_EXPLANATION_REQUIRED`.
15 novih audit akcija (npr. `machine.cost_rate_manual_set` nosi **razlog** u metadata — bez toga audit
ne odgovara na jedino pitanje koje se poslije postavlja: „zašto je sat bio skuplji od komponenti“).

### 1.4 Web ekrani

| Ekran | Šta radi |
|---|---|
| `/ured/trosak-masina` | `CostComponentsPanel` (komponente, izračunata vs. ručna stopa, „vrati na izračunato“) |
| `/ured/gorivo` | `DeviationsPanel` (objašnjenje uz razlog + napomena ≥10 znakova), `FuelPricesPanel`, `FuelTanksPanel` (popis sa razlikom uživo), unos **bez obaveznog iznosa** |
| `/ured/ture` | `SegmentsPanel` — stacionaža `km+m`, dužina, „Izvedeno“ (`quantity_sum`; **miješane jedinice** kad su `M3` i `T`) |
| `/ured/dnevni-pregled` | `CheckTemplatesPanel`, izbor šablona u unosu, per-stavka `PASS/FAIL`, kolone „Fotografija“ i „Kvar“, upozorenje kad kritična stavka padne |
| `/ured/masine/kalendar` | mjesec × mašina; ćelija = oznaka projekta (+ `*` za iznimku), prazno = **slobodno** |

Navigacija: `/ured/masine/kalendar` u grupu „Mehanizacija/Evidencija“; `nav.test.ts` prolazi.

### 1.5 Provjere

- `check-preklapanje.mjs` proširen na `machine_cost_components` — sada traži **isti** mehanizam na
  tri mjesta (dodjele, satnice, komponente).
- `nul-guard.integration.test.ts` — 14 F4 ruta dodano u `HANDLERS`; NUL u tijelu/query-ju/putanji
  nikad ne daje 5xx.
- `phase4.integration.test.ts` — **15 scenarija protiv prave baze** (dolje).
- `check-tenant-sql` — 679 upita, 64 tenant tabele, 0 prekršaja.
- `check-cycles`, `check-ui-hardcode`, `check-privacy`, `check-contrast` — čisto.

---

## 2. Kako je provjereno

### 2.1 Integracioni test (`apps/web/src/server/phase4.integration.test.ts`)

| # | Scenario | Šta dokazuje |
|---|---|---|
| 1 | komponente → stopa (18/h + 16000/mj) = **118,00** | mjesečna rata se dijeli sa `planned_hours_per_month` |
| 2 | ručna stopa bez razloga → `COST_RATE_MANUAL_OVERRIDE`; sa razlogom → `is_manual`, izračunata **ostaje vidljiva** | odstupanje se ne skriva |
| 3 | knjiženje zamrzava stopu; drugi pokušaj = `skippedExisting` | idempotencija po izvoru |
| 4 | `UPDATE rate_snapshot` kroz **admin** konekciju pada na `COST_SNAPSHOT_IMMUTABLE` | test ne može proći zbog nedostatka prava, samo zbog trigera |
| 5 | WORK 2 h + IDLE 1 h + BREAKDOWN 1 h → 50 % primarna, 25 % kalendarska | obje kolone imaju smisla |
| 6 | druga dodjela iste mašine na drugi projekat pada; iznimka kroz `usage_overrides` prolazi | globalna dvostruka dodjela + kontrolisana iznimka |
| 7 | cijena iz šifarnika po datumu; bez šifarnika `amount_cents` je `NULL` | nepoznato ≠ nula (D1) |
| 8 | točenje 100 l na 4 h uz baseline 5 l/h → **prolazi**, otvara odstupanje; tiho zatvaranje odbijeno | upozorenje, ne blokada |
| 9 | cisterna: 1000 − 100 = 900; popis 880 → razlika **−20** u audit | gubitak se vidi |
| 10 | cisterna isključena → unos sa `tank_id` odbijen jasnom porukom | izbor se ne zanemaruje tiho |
| 11 | stacionaža: pola para odbijeno, obrnuti smjer odbijen, 10+250 → 12+750 = **2500 m**, zbir 20 `M3` iz 2 ture | km+m i zbir po dionici |
| 12 | kritična FAIL stavka → kvar **vezan na pregled**; foto bez priloga → 409, sa `ready` prilogom → 200 | dokaz mora stvarno postojati |
| 13 | prag firme 500 KM: 700 → `WAITING_APPROVAL` + zahtjev, 100 → `OPEN` bez zahtjeva; terenac ne odobrava; drugo odobrenje → 409; **jedan** servisni nalog | prag je podatak firme; triger je idempotentan |
| 14 | najam 300/dan → `RENTED` + komponenta `RENTAL` **3750 centi/h** | dnevna cijena se dijeli sa `workday_hours` |
| 15 | firma B ne vidi komponente/šablone/dionice firme A; tuđa mašina → 404 | izolacija kroz RLS + servise |

Stanje lokalno: **web 595, domain 196, db 67, contracts 21, worker 21, mobile 96, a11y 117** —
sve zeleno. Puni `pnpm test` + `pnpm typecheck` + `eslint .` prolaze.

### 2.2 CI (`CI (v2)` na `9d2b4ce`) — **success**

Prvi push (`830c993`) je pao na koraku **B1 — Izolacija tenanata**, i to je bio **stvarni nalaz**:
`check-tenant-sql` unakrsno provjerava svoju listu s katalogom, a šest F4 tabela sa `company_id`
(`machine_cost_components`, `machine_cost_rate_snapshots`, `fuel_prices`, `fuel_tanks`,
`check_templates`, `service_orders`) nije bilo u listi. Lokalno je provjera preskočila unakrsnu
provjeru jer nije bilo `psql`-a — zato se greška vidjela samo u CI-ju. Popravka: lista dopunjena
(64 = 64), ponovljen push → **zeleno** (uklj. runtime preflight, preklapanje na oba mehanizma,
a11y, generisane tipove, migracije na praznoj i popunjenoj bazi, Docker image).

---

## 3. Greške koje su uhvaćene prije produkcije

Tri stvari su padale **na svakom** zahtjevu, a `tsc` ih nije vidio jer su SQL greške u izvršavanju:

| # | Gdje | Šta je bilo | Posljedica da je prošlo |
|---|---|---|---|
| 1 | `machine-cost-component-service.ts` | `UPDATE` sa `$4/$5` uz tri parametra, i `$3::date` u `WHERE` bez tipa | **svaki** ručni unos stope → 500 |
| 2 | `fuel-price-service.ts` | `baselineConsumption` lijepio `T00:00:00Z` na već potpuni trenutak (`…+01:00T00:00:00Z`) | **svaki** unos goriva → 500 |
| 3 | `machine-utilization-service.ts` | `company_holidays` ima `holiday_date`, ne `date` | kalendarska iskorištenost → 500 na svakom zahtjevu |

Uz njih: `attachments` u testu tražio `uploaded_by` (kolona je `created_by`) i `ready` bez
`uploaded_at`; `partners` traži `code` (NOT NULL) i `kind` iz skupa `VENDOR|SERVICE|OTHER|CLIENT`;
`hauls` traži `origin_text`/`destination_text`/`material_text`/`trip_count`; `project_assignments`
zabranjuje `DELETE` (Modul 3) — test ga čisti sa `session_replication_role = replica`, jer je
alternativa bila da ostavlja smeće u bazi.

---

## 4. Odluke koje se ne smiju izgubiti

1. **Stopa je zbir komponenti.** Zaokruživanje po komponenti na cent, pa sabiranje. `PER_MONTH` u dva
   koraka. `PER_KM` van satne stope.
2. **Snapshot je dokaz i ne mijenja se** — triger, ne konvencija.
3. **Ručna stopa ne briše izračunatu** — razlog ≥10 znakova, „vrati na izračunato“ zatvara red.
4. **Dvostruka dodjela mašine je globalna**; iznimka kroz `usage_overrides` sa rokom.
5. **Iskorištenost ima dvije kolone** — jedna bi lagala ili o efikasnosti ili o trošku.
6. **Odstupanje goriva je upozorenje**; cijena iz šifarnika je predlog; `NULL` ≠ `0`.
7. **Cisterna i pumpa se ne vode paralelno**; popis upisuje razliku.
8. **Kritična FAIL stavka traži dokaz, ne blokira rad**; kvar se veže na pregled.
9. **Prag odobrenja kvara je podatak firme**; `APPROVED` otvara nalog trigerom, jednom.
10. **Kalendar: „slobodno“ je odsustvo reda** — `to_date IS NULL` je otvorena dodjela.

---

## 5. Namjerno nije u ovoj fazi

- **Servisni nalog nema ekran** — `service_orders` se otvara automatski, ali ga puni **Modul 8**
  (dobavljač, faktura, zatvaranje). Do tada je vidljiv kroz bazu i `SERVICE_ORDER` trošak.
- **Baseline goriva traži bar dva očitanja u 90 dana** — prva točenja nove mašine nemaju odstupanje
  i to je namjerno; inače bi svaki prvi unos tražio pisanje razloga.
- **`check-preklapanje.mjs` u ovom okruženju nije pokrenut** (traži `psql` kroz `db-apply.sh`);
  mehanizam je provjeren direktnim upitom nad `gradix_fresh` (dodjele: 2 × `EXCLUDE`, komponente:
  1 × `EXCLUDE`, bez trigera) i testom trke koji traži da preklapanje padne na **oba** puta.
- **Web ekran timera** nije isporučen ni ovdje (F4 je donio kalendar zauzetosti, ne timer).

---

## 6. Sljedeće

**Faza 5** po `docs/IMPLEMENTATION_PLAN.md`. Otvoreni dugovi su u `docs/STATUS.md` (§ Dugovi).
