# Izvještaj — Faza 5: Projekti, budžet i troškovi

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Tag:** `phase-5` ·
**Spec:** `06-projekti-budzet-troskovi.md` (zaključano)

Faza 5 je isporučena kao **vertikala do kraja**: baza → domena → ugovor → API → web → mobilni →
worker → provjere → CI. Nijedan sloj nije ostavljen kao „doći će poslije“.

---

## 1. Šta je napravljeno

### 1.1 Baza (3 migracije)

`20261124170000_f5_1_projekti_finansije`, `20261124170100_f5_2_ledger_budzet`,
`20261124170200_f5_3_prilozi_projekta` — ukupno sada **46 migracija, 83 tabele (74 tenant)**.
Svaka nova tabela: `FORCE ROW LEVEL SECURITY` + `tenant_isolation`, grant u `bootstrap/grants.sql`,
red u `privilege-matrix.tsv`, unos u listu tenant tabela (`check-tenant-sql`).

| Tabela | Zašto |
|---|---|
| `project_phases` *(novo)* | Redoslijed rada sa `weight 1–1000`; procenat napretka ima **imenilac** (zbir težina), a ne „broj završenih faza“ |
| `project_phase_dependencies` *(novo)* | Zavisnost faza je podatak; ciklus se odbija |
| `cost_entries` *(novo)* | **Jedini** ledger troška: 8 `source_type`, `POSTED/PENDING/REVERSED`; `PENDING` **mora** imati `amount_cents NULL` — nema izmišljene nule |
| `cost_categories` *(novo)* | Šifra po firmi, budžet po kategoriji |
| `project_budget_lines` *(novo)* | Append-only linije budžeta; izmjena = nova verzija, ne UPDATE iznosa |
| `project_amendments` *(novo)* | Aneksi mijenjaju ugovorenu vrijednost; odobren aneks ulazi u `contract_with_amendments` |
| `project_boq_items` *(novo)* | Predmjer: količina × cijena; napredak po stavci |
| `budget_alert_events` *(novo)* | Dedupe upozorenja na prag 80/100 %; `UNIQUE (company_id, dedupe_key)` |
| `project_tasks` *(novo)* | Zadaci po projektu, dodjela radniku, status |
| `attachments` | `entity_type` + `'PROJECT'`; `budget_alert_events` `resolved_check` relaksiran (`resolved_by` nije obavezan pri automatskom razrješenju) |

**`cost_entry_guard()`** je jedina kapija nad ledgerom:

- `POSTED` se **ne može** vratiti u izmjenu (knjižen iznos se stornira, ne prepisuje),
- `REVERSED` je konačan, `INSERT` sa `status='REVERSED'` je zabranjen,
- `FINISHED` projekat ne prima nova knjiženja.

Storno je **novi red**: `source_id = '<src>:<id>:reversal:<newId>'`, `reverses_id` na original,
zamjenski red je `MANUAL` sa `0.00` — original ostaje netaknut i vidljiv.

### 1.2 Domena (`packages/domain/src/projects.ts`, `attachments.ts`)

`projectProgress`, `boqProgress`, `projectMargin`, `estimateAtCompletion`,
`crossedBudgetThreshold({budgetCents, spentCents, revision})`,
`budgetAlertDedupeKey` = `"prj:<revision>:<scope>:<pct>"`, `closeChecklist`.
**226 testova** u domeni (bilo 178).

Dvije odluke koje se lako tiho pokvare, pa su eksplicitne u kodu i u testu:

- **EAC pri 0 % napretka ne postoji.** `estimateAtCompletion` vraća `amount: null`,
  `reason: "NO_PROGRESS"`. Nula bi bila tvrdnja koju nemamo; „ostatak budžeta“ je druga formula i
  ne zove se EAC. EAC je uz to **uvijek** `kind: "EAC_ESTIMATE"` — nikad knjižen iznos.
- **`PENDING` je broj zapisa, ne novac.** Nikad se ne sabira sa `POSTED`; prikazuje se kao
  „N bez cijene“.

### 1.3 API — 19 novih ruta (OpenAPI **169 putanja / 222 metode**)

Faze i zavisnosti (`phases`, `phase-dependencies`, `progress`, `progress-source`), novac
(`profitability`, `costs`, `budget`), predmjer (`boq`), aneksi (`amendments`), zatvaranje
(`close-checklist`, `close`, `reopen`), zadaci (`/api/tasks`), ručni trošak (`/api/costs/manual`),
kategorije (`/api/cost-categories`), prilozi projekta (`/api/attachments` sa `entityType: "PROJECT"`
+ `confirm`, `url`, `DELETE`) i `amendments`. Uz to `+22` akcije u `audit.ts` i nove dozvole:
`projects.costs.view` [OWNER, ADMIN, PM, ACCOUNTANT], `projects.costs.book` / `projects.budget.manage`
[OWNER, ADMIN, PM], `projects.manage` [OWNER, ADMIN] (zadaci).

### 1.4 Knjiženje troška — **jedno mjesto**

`cost-entry-service.ts` drži sve ulaze u ledger, svi primaju `PoolClient` (ista transakcija):

| Funkcija | Kad pravi trošak |
|---|---|
| `bookFuelEntryCost` | terenski unos goriva — knjiži **isto** kao servisni put |
| `bookMachineWorkLogCost` | samo `WORK` sat; `IDLE`/`BREAKDOWN` ne prave trošak (pravilo u servisu) |
| `bookHaulCost` | tura; cijena iz dionice, inače `PENDING` **sa količinom** |
| `postCost` / `settlePendingCost` | ručni trošak i naknadna cijena za `PENDING` |
| `reverseCost` / `reverseSourceCost` | storno; `reverseSourceCost` **nikad ne baca** (`{reversed:boolean}`) i zove se iz `fuel-entry-revise`, `haul-revise`, `machine-work-log-revise` |

**R4 sync je bio praznina** — offline unos goriva/sata/ture je upisivao red a **nije** knjižio
trošak. Sada `r4-sync-fuel-entry.ts`, `r4-sync-machine-work-log.ts`, `r4-sync-haul.ts` zovu `book*`
u istoj transakciji, pa teren i ured daju isti ledger. Greška u knjiženju ne obara sync.

Revizija izvora (npr. ispravka litre goriva) stornira stari trošak i knjiži novi; audit nosi
`project.cost_reversed` sa `metadata.trigger = "SOURCE_REVISED"`.

### 1.5 Web UI

- `/ured/projekti` — lista sa maržom, `%` napretka i brojem troškova bez cijene; filter
  „Rizičnost“; kolone sa novcem **samo** uz `projects.costs.view`.
- `/ured/projekti/[id]` — 8 tabova: **Pregled** (novac + EAC + zatvaranje), **Faze**, **Troškovi**
  (ledger + ručni trošak + storno sa razlogom ≥10 znakova), **Budžet**, **Predmjer**, **Aneksi**,
  **Zadaci**, **Prilozi**.
- `/ured/zadaci` — svi zadaci firme.
- `/ured/postavke/kategorije-troska` — CRUD kategorija (`projects.costs.view`).
- `/pregled` — kartica „Rizični projekti“ sa **imenovanim** uzrocima (negativna marža, preko
  budžeta, troškovi bez cijene), ne samo bojom.

**Umjesto ekrana** `/ured/troskovi-projekta` (F4, zasebna strana) ledger je sada tab u projektu —
jedan projekat, jedan kontekst. Stavka je uklonjena iz `nav.ts` i iz svih e2e testova.

### 1.6 Mobilni

`/moji-zadaci` (današnji zadaci, promjena statusa) i `/trosak` (unos troška sa terena: kategorija,
iznos ili količina bez cijene, fotografija). `trosak-model.ts` drži validaciju (**6 testova**),
`mobile-nav.ts` 9/9. Foto sa kamere: `expo-image-picker` → base64 → `registerProjectAttachment` →
`confirmAttachment`; `expo-crypto` računa `sha256` (`bytesToBase64` u petlji — `String.fromCharCode(...)`
puca na `RangeError` za veće slike).

### 1.7 Worker

`budget.thresholds` (`JOB_NAMES.budgetThresholds`), raspored `*/15 * * * *`. `evaluateThresholds`
gleda **ukupno i po kategoriji** protiv `revision` budžeta; 100 % daje **jedno** upozorenje, ne
seriju. Dedupe je troslojan (dogodek + `dedupe_key` + `UNIQUE`). Primaoci: PROJECT_MANAGER + OWNER,
`kind = "budget.threshold"`, `href = /ured/projekti/{id}`. `apps/worker` 22 testa (+3 preskočena).

---

## 2. Kako je provjereno

```
pnpm test            639 prošlo, 338 preskočeno (web 277 + domain 226 + mobile 93 + contracts 21 + worker 22)
                     preskočeno = DB integracija (bez DATABASE_URL) — 55 suite-ova, 344 testa
pnpm typecheck       6/6
pnpm lint            čist (uklonjen neiskorišten `fail` import)
npx next build       prolazi (sve F5 rute u build izlazu)
pnpm openapi         169 putanja · check: „openapi.json je ažuran“
check-tenant-sql     769 upita, svi nad tenant tabelama nose company_id ✓
a11y                 axe (WCAG 2.1 AA) u svakom novom UI testu — bez serious/critical
```

**Novi UI testovi (F5):**

- `project-overview.test.tsx` (5) — EAC označen kao „Procjena, ne knjiga“; pri 0 % napretka EAC se
  **ne ispisuje**; `PENDING` je broj zapisa.
- `project-costs.test.tsx` (5) — red bez cijene piše „bez cijene“; izvor troška je link
  `?workdayId=…`; storno traži razlog ≥10 znakova; bez `projects.costs.book` nema „+ Ručni trošak“.
- `risky-projects-card.test.tsx` (4) — uzroci imenovani riječima; prazno stanje kaže riječima.
- `projects-client.test.tsx` (+2) — marža i `%` u listi, **bez** `projects.costs.view` marže nema;
  filter „samo rizični“ koristi serverski `risky`, ne svoju računicu.

**Testovi su hvatali prave greške, ne samo prolazili:**

1. `RowActions` je za red sa **jednom** akcijom renderuje kao primarno dugme — test je tražio meni
   „Više radnji“ koji u tom slučaju ne postoji. Selektor je usklađen sa stvarnim UI-om.
2. `findByText("300.00")` je padao na „Found multiple elements“ — iznos postoji i u sažetku i u redu;
   prebačeno na `findAllByText`. To je i dokaz da sažetak **nije** skriven.
3. `estimateAtCompletion` tip: `amount: null` i `reason: string` su u testu bili zamijenjeni —
   `tsc` je uhvatio prije `vitest`-a.

**Integracioni testovi protiv baze** (`REQUIRE_DB_TESTS=1`) u ovom okruženju nisu pokrenuti — nema
`psql` ni PG servera. Oslanjaju se na CI; lokalno su prijavljeni kao preskočeni, ne kao prošli.

---

## 3. Šta namjerno nije urađeno

- **`workday-timer-service.ts` još ne knjiži trošak** — timer pravi sate, a sat mašine se knjiži iz
  `machine_work_log`. Spajanje ta dva toka traži odluku (koji izvor je mjerodavan kad postoje oba);
  do tada nema tihog dvostrukog knjiženja.
- **`PATCH /api/tasks/{id}` traži `projects.manage`** [OWNER, ADMIN] — šef gradilišta i radnik na
  terenu ne mogu prebaciti status zadatka. Mobilni ekran zato prikazuje zadatke, ali promjena
  statusa je otvorena odluka (vjerovatno `projects.tasks.update` ili dodjela po zadatku).
- **Storno na zatvorenom projektu pada** (`FINISHED` ne prima knjiženja) — greška se guta i vraća
  `{reversed:false}`. Ispravka („storno je dozvoljen i poslije zatvaranja“) je odluka o pravilu, ne
  bug u kodu.
- EAC se **ne** prikazuje na listi projekata (samo u tabu Pregled) — na listi bi izgledao kao knjiga.

---

## 4. Sljedeće

Modul/`IMPLEMENTATION_PLAN.md` → **Faza 6**.
