# Izvještaj — Faza 8: Servis i održavanje mašina (Modul 9)

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Tag:** `phase-8` ·
**CI: zelen (run `45671009367`)** · **Spec:** `09-servis-odrzavanje.md` (zaključano)

Faza 8 je isporučena kao **vertikala do kraja**: baza → domena → ugovor → API → servis → web →
worker → mobilno → provjere. Radionica nije „još jedan spisak naloga“: nalog ima tok sa kapijom
odobrenja, trošak nastaje na serveru iz unosa, zalihe su ledger, a mehaničar radi **offline** i
sinkronizuje namjeru — ne obračun.

---

## 1. Šta je napravljeno

### 1.1 Baza (1 migracija)

`20261125140000_f8_1_servis_odrzavanje` — **49 migracija, 105 tabela (96 tenant)**.

| Tabela | Zašto |
|---|---|
| `service_orders` *(proširena)* | Puni tok `PLANNED → APPROVED → IN_PROGRESS → WAITING_PARTS → DONE/CANCELLED`, `version` za optimističko zaključavanje, `started_at`/`finished_at`, `labor_hours`, `labor_cost_cents`, `parts_cost_cents`, `external_cost_cents`, `total_cost_cents`, `warranty_until` |
| `maintenance_templates` *(novo)* | Šablon preventive po firmi: interval, osnov (`HOURS`/`KM`/`DAYS`), `tolerance_pct` |
| `maintenance_plans` *(novo)* | Plan po mašini: `next_due_*`, `last_done_at`, `is_active`; prag se računa u domeni |
| `stock_items` *(novo)* | Šifarnik dijelova: `code`, `name`, `unit`, `min_quantity`, `warehouse_id` (nullable — puni se u F10) |
| `stock_movements` *(novo)* | **Append-only** kretnje (`IN`/`OUT`/`TRANSFER`/`COUNT`), `source_type`/`source_id` uz `source_pair_check` (oba ili nijedan), unique `(company_id, source_type, source_id, item_id)` |
| `service_order_events` *(novo)* | Trag toka naloga (ko, kad, `from → to`, razlog) |
| `service_order_parts` *(novo)* | Ugrađeni dijelovi sa količinom i jediničnim troškom |
| `companies` | `block_on_overdue_maintenance` (default `false`), `service_approval_threshold_cents` (default 500 KM) |
| `approval_requests.subject_type` | Proširen na `service_order` |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + grant u
`bootstrap/grants.sql` (**bez `DELETE`** nad kretnjama i događajima) + `schema.generated.ts`.

### 1.2 Domena — `packages/domain/src/service-maintenance.ts`

- `serviceCost`: `labor = hoursHundredths × rate / 100`, zaokruživanje pola-naviše;
  `total = labor + parts + external` (nikad `total` iz unosa)
- `machineReliability`: MTTR u **minutama**, MTBF = radni sati / **kvarovi** (`isFault` filtrira
  preventivne naloge), pa preventiva ne obara broj
- `evaluateMaintenance`: prag = `nextDue − interval × tolerance`, stanja `OK → DUE_SOON → OVERDUE`
- `stockOnHand`: Σ IN − Σ OUT (kretnje su izvor, nema kolone stanja)
- `serviceApprovalCheck`: **strogo `>`** — iznos tačno na pragu ne traži odobrenje
- `toHundredths`/`toThousandths`: decimalni unos bez `float`

**20 testova** (`service-maintenance.test.ts`).

### 1.3 API — 23 nove rute

Nalozi (`GET/POST /api/service-orders`, `GET/PATCH /api/service-orders/{id}`, `start`,
`wait-parts`, `finish`, `approve`, `reject`, `parts`), planovi i šabloni
(`/api/machines/{id}/maintenance-plans`, `/api/maintenance-templates`), zalihe
(`/api/stock-items`, `/api/stock-movements`), pouzdanost (`/api/machines/{id}/reliability`).
OpenAPI: **219 putanja**, `check-openapi` potvrđuje ažurnost.

### 1.4 Knjiženje troška

`postCost` iz `cost-entry-service.ts` je ostao **jedno mjesto** knjiženja:

- `source_type = SERVICE_ORDER`, `source_id = orderId` → **jedan red** po nalogu
- nalog sa projektom knjiži `project_id`; nalog bez projekta `project_id = NULL` + `machine_id`
  (constraint `cost_entries_subject_check` traži bar jedno)
- garancijska popravka: red sa iznosom **0** i napomenom — posao je vidljiv, drugi trošak ne nastaje
- bez iznosa → `PENDING` (knjiži se kad iznos postane poznat)
- knjiženje ide **poslije** commit-a naloga (isti redoslijed kao F5)
- `ensureCostCategories` **dopunjava** šifarnik: firma sa F5 kategorijama dobija `SERVIS`
  (sortOrder 70) bez duplikata (`ON CONFLICT DO NOTHING`)
- izbor kategorije: `ORDER BY (default_for_source_type = $2) DESC NULLS LAST` — vidi §3

### 1.5 Worker

`reminders-scan.ts` → `scanMaintenance()`: preventiva po **datumu i satima rada**, idempotentno po
`(maintenance_plan_id, planned_for)`; istek je upozorenje, blokada samo uz
`block_on_overdue_maintenance`.

### 1.6 Web (6 ekrana)

| Ekran | Sadržaj |
|---|---|
| `/ured/servis` | Red čekanja po prioritetu, filter „čekaju dijelove“, radnje stanja u listi |
| `/ured/servis/[id]` | Sati, dijelovi, tok, trošak; `total_cost` je **prikaz**, ne unos |
| `/ured/servis/planovi` | Planovi i šabloni preventive |
| `/ured/dijelovi` | Stanje zaliha **bez polja za unos** (stanje je zbir kretnji) |
| `/ured/masine/[id]` | Novi tab „Održavanje“ (planovi + pouzdanost) |
| `/pregled` | Kartica „Servis“ — isti `dueMaintenancePlans` kao worker |

### 1.7 Mobilno (`/servisni-nalozi`)

- Offline-first kroz R4 outbox: `queueServiceOrderAction`, `entityType = "service_order_action"`
- `servis-model.ts`: red čekanja (otvoreni → moji prvo → prioritet → najstariji), glavna radnja iz
  stanja (`IN_PROGRESS → FINISH`, `WAITING_PARTS/APPROVED → START`)
- `LOCAL_SCHEMA_VERSION = 2` + `upgradeToV2` — prenos `outbox`/`sync_events` **bez gubitka redova**
- dugmad ≥ 56 dp

### 1.8 Sync

`R4SyncPushItem` dobio `service_order_action` (`localId`, `actionId`, `serviceOrderId`,
`deviceSentAt`, `action { kind, laborHours, externalCostAmount, warrantyUntil, note, part }`).
Obrada u `r4-sync-service-order.ts` → `setOrderStatusFromSync` / `finishOrderFromSync`; telefon
**ne računa** trošak ni zalihu. `actionId` je ključ idempotencije; `PART` kretnja dobija
`source_id = "<orderId>:sop_<actionId>"`, pa ponovljeni push daje `STOCK_ALREADY_POSTED`, a ne
drugu kretnju. `DUPLICATE`, `SERVICE_ALREADY_DONE` i `STOCK_ALREADY_POSTED` telefon tretira kao
**uspjeh** (red se zatvara, ne vrti u istu grešku).

---

## 2. Provjere

| Provjera | Rezultat |
|---|---|
| `pnpm test` sa bazom (`REQUIRE_DB_TESTS=1`) | **1 221 prošao** — web 691 (114 fajlova), domain 296, mobile 118, db 70, worker 25, contracts 21 |
| `pnpm typecheck` | 6/6 paketa |
| `pnpm lint` | čist |
| `db:types:check` | „generisani tipovi su sinhroni sa bazom“ |
| `check-tenant-sql` | 96/96 tenant tabela, 995 upita ✓ |
| `check-matrix-parity` | 0 grešaka (1 poznato upozorenje za R1 tenant listu) |
| preflight `001_security.sql` / `002_privileges.sql` | oba prolaze protiv `gradix_fresh` |
| `check-cycles` (A2) | 0 ciklusa u web i mobile |
| CI `ci-v2` (`45671009367`) | `verify` **success** — migracije/role, preflight prije i poslije testova, integracijski testovi, E2E `@smoke`+`@deep`, Docker image, sinhroni tipovi, migracije na praznoj i popunjenoj bazi |
| integracioni testovi F8 | `f8-service-orders` 12/12, `f8-service-sync` 6/6, `f8-isolation` 3/3 |
| domenski | `service-maintenance` 20/20, `service-order-sync` 8/8, `servis-model` 13/13, `migrations` 5/5, `mobile-nav` 10/10 |

`psql` u ovom okruženju nema, pa je preflight pokrenut kroz `pg` klijent (TSV matrica učitana u
temp tabelu umjesto `\copy`); SQL je isti, izvršava se aplikacijskom rolom.

---

## 3. Greške nađene u toku rada (i zašto su važne)

1. **`ORDER BY (default_for_source_type = $2) DESC` u Postgresu stavlja NULL PRVE.**
   `OSTALO` ima `default_for_source_type = NULL`, poređenje daje NULL, i **svaki** trošak —
   i servis sa svojom kategorijom — padao je u „Ostalo“. Popravka: `DESC NULLS LAST`. Nađeno
   testom `f8-service-sync`, ne u produkciji; greška je tiha (knjiženje prolazi, kategorija je
   pogrešna), pa ju je mogao naći samo test koji gleda kategoriju, ne iznos.
2. **`ensureCostCategories` se vraćao rano na „ima ijednu kategoriju“.** Firma sa šifarnikom iz F5
   nema `SERVIS`, pa bi servis zauvijek knjižio u `OSTALO`. Popravka: dopuna nedostajućih sa
   `ON CONFLICT DO NOTHING`.
3. **Sync START nije postavljao `started_at`.** `service_orders_done_time_check` traži
   `started_at IS NOT NULL` kad je nalog `DONE`, pa je FINISH iz telefona padao na tuđem
   ograničenju. Popravka: START iz sync-a šalje `startedAt`.
4. **Telefon je mogao zaobići prag odobrenja.** `setOrderStatusFromSync` sada zove `approvalBlock`
   — ista kapija kao web (`SERVICE_APPROVAL_REQUIRED`), jer bi inače mobilni put bio rupa.
5. **`stock_movements_source_pair_check` traži oba ili nijedan.** „Ručno primanje“ u testu je
   slalo samo `source_type`; u proizvodu par uvijek nastaje zajedno.
6. **Cleanup u F4 testovima je padao poslije F8.** `machine_faults.service_order_id` je RESTRICT
   veza na nalog, pa brisanje `service_orders` prije nuliranja veze obara `afterAll`. Popravljeno
   u `machine-fault.integration.test.ts` i `phase4.integration.test.ts` — redoslijed je sada
   veza → događaji → nalog.
7. **Dva ciklusa uvozâ koja `pnpm test` ne vidi.** CI korak A2 ih je našao: tip je uziman iz
   barrela (`r4-sync-service`) i `orderStatus`/`parseExternalCost` su bili u fajlu koji zove
   transakciju koja ih uvozi. Popravka: tip iz `r4-sync-fault-types`, a dijeljene funkcije u
   `service-order-shared.ts`. Pouka: `check-cycles` ide u lokalnu završnu provjeru, jer zeleni
   `pnpm test` ne znači zelen CI.
8. **Nepoznat `entityType` u pull-u je prolazio na mobilnom.** Lokalni `sync_events` CHECK je
   proširen u F8, pa je test „nepoznat tip odbija stranicu“ ostao bez zaštite. Popravka: izričita
   provjera tipa **prije** transakcije u `applyPullPage` — događaj ne uđe u keš i kursor ne ode
   dalje.

---

## 4. Odluke koje se ne smiju izgubiti

- Stanje zaliha je **zbir kretnji**, nikad kolona; popis ulazi kao kretnja razlike.
- Trošak ide **ili na projekat ili na mašinu**, nikad oboje; jedan izvor = jedan red.
- Garancija **ne briše trag** — red sa iznosom 0.
- Istek preventive je **upozorenje**; blokada je uključiva i nikad ne blokira gorivo.
- Prag odobrenja je **odvojen** od praga kvara i poređenje je strogo `>`.
- MTBF broji **kvarove**, ne naloge; MTTR u minutama, MTBF u satima.
- Telefon šalje **namjeru**, server računa novac i zalihu; `actionId` je idempotencija.

---

## 5. Ostaje za kasnije (svjesno)

- `sync_conflicts.entity_type` CHECK nije proširen na `service_order_action`: konflikt za ovaj tip
  se ne upisuje (sync radnja je idempotentna po `actionId`, pa „sukob“ ne postoji — ponovljeni
  push je `DUPLICATE`). Ako F9/finansije uvedu konkurentne izmjene istog naloga, CHECK se širi
  zajedno sa pravilom razrješenja.
- Skladišta (`warehouse_id`) su nullable do F10; zaliha je po firmi, ne po lokaciji.
- Web ekran za planiranje preventive je lista + izmjena; kalendar preventive nije rađen.
