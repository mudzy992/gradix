# 11 — Skladište, nabavka, dobavljači i podizvođači

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.11 · **Modul:** 11 od 12
**Zavisi od:** Modul 1 (postavke, `attachment-service`, notifikacije, audit), Modul 2 (`approval_requests` obrazac, obaveze), Modul 5 (`fuel_tanks`, `fuel_entries`), Modul 6 (`cost_entries`, `cost_categories`, budžet, faze), Modul 9 (`stock_items`, `stock_movements` — minimalno skladište), Modul 10 (projekti/faze za izlaz materijala)

Postojeće stanje: `partners` (`code`, `name`, `kind` `VENDOR|SERVICE|OTHER|CLIENT`, `note`, `active`), CRUD servis + `/ured/partneri`; `approval_requests` (`subject_type` proširen u Modulu 9 na `machine_fault|service_order|purchase`); `cost_entries` (Modul 6) ima `PURCHASE` i `SUBCONTRACTOR` u `source_type` **bez izvora koji ih proizvodi**; `stock_items`/`stock_movements` (Modul 9, minimalno, `warehouse_id` nullable); `fuel_tanks` (Modul 5, odvojen model zaliha).

**Dijagnoza:** osim partnera, B5.11 ne postoji. Nabavka je drugi najveći izvor troška u niskogradnji poslije rada, a podizvođači treći — oba bi u MVP-u bila potpuno nevidljiva, sa ručnim troškom koji nema dokument i sa dva paralelna modela zaliha goriva.

---

## 1. Poslovna pravila

### 1.1 Skladišta: jedan mehanizam, tri tipa
1. `warehouses`: `code`, `name`, `kind` (`CENTRAL|SITE|TANK`), `project_id NULL` (obavezan za `SITE`), `address`, `is_active`. Unique `(company_id, code)`.
2. **`TANK` je cisterna goriva:** Modul 5 `fuel_tanks` se **mapsira** na `warehouses` red (`fuel_tanks.warehouse_id`), a litri idu kroz `stock_movements` sa `item_id` = artikal goriva. **Nema paralelnog stanja** (`fuel_tanks.current_l` se izvodi iz `SUM`, ne čuva).
3. Migracija: `stock_movements.warehouse_id` postaje **NOT NULL**; postojeći redovi (Modul 9) idu u automatski kreirano skladište `CENTRAL` po firmi.
4. **Transfer je dvostruka kretnja:** `OUT` iz izvora + `IN` u cilj, oba sa istim `transfer_id`; stanje po skladištu je uvijek `SUM(stock_movements)`.
5. `stock_item_levels` (`item_id`, `warehouse_id`, `min_quantity`, `max_quantity`) — minimum **po skladištu**, ne globalno. Pad ispod minimuma = **upozorenje** + predlog zahtjeva za nabavku jednim klikom (nikad blokada).

### 1.2 Nabavka: zahtjev → odobrenje → narudžbenica → prijem → račun
6. `purchase_requests`: `project_id NULL`, `phase_id NULL`, `requested_by_worker_id`, `needed_by`, `justification`, `status` (`DRAFT|SUBMITTED|APPROVED|REJECTED|ORDERED|CLOSED|CANCELLED`), `total_estimated_cents`, `currency_code`; stavke `purchase_request_items` (`item_id NULL`, `description`, `unit`, `quantity`, `estimated_unit_price_cents`).
7. **Odobrenje kroz postojeći mehanizam** (`approval_requests.subject_type='purchase'`): iznad `companies.purchase_approval_threshold_cents` (default **1000 KM**) traži OWNER/ADMIN; ispod odobrava PM.
8. `purchase_orders`: `request_id NULL`, `partner_id`, `ordered_at`, `expected_at`, `status` (`DRAFT|SENT|PARTIALLY_RECEIVED|RECEIVED|CANCELLED`), `total_cents`; stavke `purchase_order_items`. Narudžbenica je **odvojen dokument od zahtjeva** — jedan zahtjev može dati više narudžbenica kod više dobavljača.
9. `goods_receipts` (+ `goods_receipt_items`): prijem robe u skladište, automatski `stock_movements` `IN`. Prijem bez narudžbenice je dopušten (hitna kupovina) uz `note` i upozorenje.
10. `purchase_invoices`: `partner_id`, `invoice_number`, `invoice_date`, `due_date`, `amount_cents`, `order_id NULL`, `project_id NULL`, `status` (`PENDING|APPROVED|PAID|DISPUTED`), `attachment_id`. **`UNIQUE (company_id, partner_id, invoice_number)`** — idempotencija na nivou dokumenta: isti račun se ne unosi dvaput, bez obzira ko ga unosi.
11. **Prijem i račun su odvojeni** (roba dođe u utorak, račun u petak). Neslaganje `primljeno ≠ fakturisano` je `PURCHASE_INVOICE_MISMATCH` — upozorenje na računu i Pregledu, ne blokada plaćanja.
12. Odobren račun → `cost_entries` (`source_type='PURCHASE'`, kategorija iz mapiranja, `project_id` ako je poznat) — idempotentno po `source_id = invoice_id`.

### 1.3 Izlaz materijala na projekat
13. `material_issues` (+ `material_issue_items`): `warehouse_id`, `project_id`, `phase_id NULL`, `issued_to_worker_id NULL`, `issued_at`.
14. Automatski: `stock_movements` `OUT` **i** `cost_entries` (`PURCHASE`, kategorija `MATERIJAL`, `project_id`/`phase_id`) — jedan `source_id`, idempotentno.
15. Vrijednost izlaza = **prosječna nabavna cijena** (`SUM(IN amount)/SUM(IN quantity)` po artiklu i skladištu). FIFO, serijski brojevi i lotovi su B15.
16. Izlaz bez projekta je dopušten (režijski materijal) → `project_id NULL`.

### 1.4 Popis
17. `stock_counts` (+ `stock_count_items` sa `counted_quantity`, `system_quantity`, `difference`), status `DRAFT|APPLIED`.
18. Primjena popisa stvara **jednu `COUNT` kretnju po razlici** (nikad `UPDATE` stanja).
19. **Kratko zaključavanje skladišta** (`pg_advisory_xact_lock`) tokom primjene; kretnje u toku popisa se odbijaju.
20. Razlika iznad `companies.stock_count_tolerance_cents` (default **200 KM**) traži razlog (+ opciono odobrenje); manja se primjenjuje tiho, ali ostaje u kretnjama.

### 1.5 Podizvođači
21. `partners.kind` dobija `SUBCONTRACTOR`; `partner_roles` (`partner_id`, `role` `CLIENT|VENDOR|SERVICE|SUBCONTRACTOR|OTHER`) — **jedan partner može biti više uloga** (dobavljač i podizvođač istovremeno). `kind` ostaje primarna uloga za kompatibilnost.
22. `subcontractor_contracts`: `partner_id`, `project_id`, `code`, `title`, `scope`, `contract_value_cents`, `currency_code`, `retention_pct`, `warranty_pct`, `valid_from`, `valid_to`, `status` (`DRAFT|ACTIVE|COMPLETED|TERMINATED`), `document_attachment_id`.
23. `subcontractor_statements` (+ `subcontractor_statement_items`): `period_from`, `period_to`, `statement_no`, `status` (`DRAFT|SUBMITTED|APPROVED|REJECTED|PAID`), `gross_cents`, `retention_cents`, `net_cents`.
24. **Kontrola prekoračenja:** `Σ odobrenih situacija + nova > contract_value_cents` → **upozorenje** (ne blokada) uz mogućnost aneksa ugovora (`value_amendment_cents` + razlog, audit).
25. **Zadržavanje i garancija** se ne plaćaju sada: vidljivi na ugovoru i u trošku projekta odmah, u plaćanju kasnije. `net_cents = gross − retention − warranty`.
26. Odobrena situacija → `cost_entries` (`SUBCONTRACTOR`, kategorija `PODIZVOĐAČI`, projekat/faza, `source_id = statement_id`) — idempotentno.

### 1.6 Ručni trošak sa prilogom
27. `cost_entries` (`source_type='MANUAL'`) + prilog (račun, slip) kroz `attachment-service`.
28. **Idempotencija duplog dodira:** `client_generated_id` (UUID iz forme) sa `UNIQUE (company_id, client_generated_id)` — ponovni POST vraća postojeći red, ne pravi novi.
29. Ručni trošak iznad `companies.manual_cost_approval_threshold_cents` (default **500 KM**) traži odobrenje kroz `approval_requests` (`subject_type='purchase'`).
30. Kategorija iz `cost_categories` (Modul 6), nikad slobodan tekst.

### 1.7 Granice modula
31. Ovaj modul **ne dira** trošak rada (Modul 7), trošak mašina (Modul 5/9) ni dnevnik/HSE (Modul 10) — samo dodaje `PURCHASE` i `SUBCONTRACTOR` kao dva nova izvora u isti `cost_entries` ledger.
32. **Situacije prema naručiocu (naplata, izlazno fakturisanje) su van opsega MVP-a** (Faza B15).

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `warehouses` (novo) | vidi §1.1; unique `(company_id, code)`; `CHECK (kind <> 'SITE' OR project_id IS NOT NULL)` |
| `stock_movements` | `warehouse_id` → **NOT NULL**; `+ transfer_id NULL`; `+ client_generated_id NULL` |
| `stock_items` | `+ default_unit_cost_cents NULL`, `+ category_id NULL` |
| `stock_item_levels` (novo) | `id, company_id, item_id, warehouse_id, min_quantity, max_quantity`; unique `(company_id, item_id, warehouse_id)` |
| `stock_counts` / `stock_count_items` (novo) | vidi §1.4 |
| `purchase_requests` / `purchase_request_items` (novo) | vidi §1.2/6 |
| `purchase_orders` / `purchase_order_items` (novo) | vidi §1.2/8 |
| `goods_receipts` / `goods_receipt_items` (novo) | vidi §1.2/9 |
| `purchase_invoices` (novo) | vidi §1.2/10; unique `(company_id, partner_id, invoice_number)` |
| `material_issues` / `material_issue_items` (novo) | vidi §1.3 |
| `partner_roles` (novo) | `id, company_id, partner_id, role`; unique `(company_id, partner_id, role)` |
| `partners` | `kind` CHECK proširen sa `SUBCONTRACTOR`; `+ oib/vat_number`, `+ address`, `+ contact_person`, `+ phone`, `+ email` |
| `subcontractor_contracts` (novo) | vidi §1.5/22 |
| `subcontractor_statements` / `_items` (novo) | vidi §1.5/23 |
| `fuel_tanks` | `+ warehouse_id` (unique); `current_l` postaje izvedeno, ne čuvano |
| `cost_entries` | `+ client_generated_id NULL` + `UNIQUE (company_id, client_generated_id) WHERE client_generated_id IS NOT NULL`; `+ supplier_invoice_id NULL` |
| `companies` | `+ purchase_approval_threshold_cents BIGINT DEFAULT 100000`, `+ manual_cost_approval_threshold_cents BIGINT DEFAULT 50000`, `+ stock_count_tolerance_cents BIGINT DEFAULT 20000` |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight. Nijedan `DELETE` grant.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/warehouses` | `stock.view` / `stock.manage` |
| GET/POST/PATCH | `/api/stock-items` (+`/:id/levels`) | `stock.view` / `stock.manage` |
| GET | `/api/stock/balance?warehouse&item` | `stock.view` |
| POST | `/api/stock-movements` (ručna kretnja) | `stock.manage` |
| POST | `/api/stock-transfers` | `stock.manage` |
| GET/POST | `/api/stock-counts` (+`/:id/apply`) | `stock.manage` |
| GET/POST/PATCH | `/api/purchase-requests` (+`/:id/submit`, `/approve`, `/reject`) | `purchase.view` / `purchase.manage` |
| GET/POST/PATCH | `/api/purchase-orders` (+`/:id/send`) | `purchase.view` / `purchase.manage` |
| POST | `/api/goods-receipts` | `purchase.manage` |
| GET/POST/PATCH | `/api/purchase-invoices` (+`/:id/approve`) | `purchase.view` / `purchase.manage` |
| POST | `/api/material-issues` | `stock.manage` |
| GET/POST/PATCH | `/api/partners/:id/roles` | `partners.manage` |
| GET/POST/PATCH | `/api/subcontractor-contracts` (+`/:id/amend`) | `subcontractors.view` / `.manage` |
| GET/POST | `/api/subcontractor-statements` (+`/:id/approve`) | `subcontractors.view` / `.manage` |
| POST | `/api/costs/manual` (prošireno: `clientGeneratedId`) | `projects.costs.book` |

Nove dozvole: `stock.view` (OWNER/ADMIN/PM/SITE_SUPERVISOR/MECHANIC), `stock.manage` (OWNER/ADMIN/SITE_SUPERVISOR/MECHANIC), `purchase.view` (OWNER/ADMIN/PM/ACCOUNTANT), `purchase.manage` (OWNER/ADMIN/PM), `purchase.approve` (OWNER/ADMIN), `subcontractors.view` (OWNER/ADMIN/PM/ACCOUNTANT), `subcontractors.manage` (OWNER/ADMIN/PM), `partners.manage` (postojeće, prošireno na uloge).
Novi kodovi: `STOCK_COUNT_IN_PROGRESS`, `PURCHASE_APPROVAL_REQUIRED`, `PURCHASE_INVOICE_MISMATCH`, `INVOICE_ALREADY_REGISTERED`, `SUBCONTRACTOR_CONTRACT_EXCEEDED`, `STOCK_INSUFFICIENT`, `MATERIAL_ISSUE_EMPTY`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/skladiste` | skladišta, stanje po artiklu (`SUM`), minimum, „pod minimumom“, brzi `IN`/`OUT`/transfer |
| `/ured/skladiste/[id]` | kretnje hronološki, stanje, nivoi, popis |
| `/ured/skladiste/artikli` | šifarnik artikala + kategorije + prosječna cijena |
| `/ured/nabavka` | zahtjevi po statusu, narudžbenice, prijemi, računi; upozorenja `MISMATCH` |
| `/ured/nabavka/zahtjev/[id]` | zahtjev: stavke, odobrenje, „pretvori u narudžbenicu“ |
| `/ured/nabavka/racuni` | računi sa prilogom, plaćanje, neslaganja |
| `/ured/podizvodjaci` | partneri sa ulogom podizvođača, ugovori, situacije, prekoračenja |
| `/ured/podizvodjaci/ugovor/[id]` | ugovor: obim, vrijednost, zadržavanje, garancija, situacije, aneksi |
| `/ured/partneri` | prošireno: uloge, kontakt, adresa |
| `/pregled` | artikli pod minimumom, računi u neslaganju, situacije za odobrenje, ugovori blizu prekoračenja |
| mobilno (šef) | izlaz materijala sa gradilišta (artikal → količina → projekat), offline |

---

## 5. Testovi

1. Skladišta: stanje = `SUM`; transfer stvara `OUT`+`IN` sa istim `transfer_id`; ukupno stanje firme se ne mijenja transferom.
2. Cisterna: `TANK` skladište + `fuel_entries` → litri kroz `stock_movements`; `fuel_tanks.current_l` izveden; nema drugog stanja.
3. Minimum: pad pod `min_quantity` daje upozorenje i predlog zahtjeva; ne blokira izlaz.
4. Nabavka: zahtjev iznad praga traži odobrenje; ispod odobrava PM; odbijeno ne može u narudžbenicu.
5. Prijem: `stock_movements` `IN`; djelimičan prijem → `PARTIALLY_RECEIVED`; prijem bez narudžbenice prolazi uz upozorenje.
6. Račun: dupli `(partner, invoice_number)` odbijen (`INVOICE_ALREADY_REGISTERED`); `primljeno ≠ fakturisano` daje `PURCHASE_INVOICE_MISMATCH`; odobren račun knjiži `cost_entries` jednom.
7. Izlaz: `OUT` + `cost_entries` (`PURCHASE`) jednom; vrijednost po prosječnoj cijeni; izlaz bez projekta → `project_id NULL`.
8. Popis: jedna `COUNT` kretnja po razlici; stanje poslije popisa = prebrojano; razlika iznad tolerancije traži razlog; paralelna kretnja tokom primjene odbijena.
9. Podizvođač: jedan partner sa dvije uloge; ugovor + situacije; `net = gross − retention − warranty`; prekoračenje daje upozorenje, ne blokadu; aneks mijenja vrijednost uz audit.
10. Odobrena situacija → `cost_entries` (`SUBCONTRACTOR`) jednom; dupli approve ne duplira trošak.
11. Ručni trošak: isti `client_generated_id` dva puta → jedan red; iznad praga traži odobrenje; kategorija iz šifarnika.
12. Izolacija: firma B ne vidi skladišta, zalihe, nabavku, ugovore firme A.

Van opsega: situacije prema naručiocu / izlazno fakturisanje (B15), FIFO i serijski brojevi/lotovi (B15), barkod skeniranje, e-fakture, valutno knjiženje sa kursnom listom.
