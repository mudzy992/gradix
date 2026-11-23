# 09 — Servis i održavanje mašina

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.9 · **Modul:** 9 od 11
**Zavisi od:** Modul 1 (postavke, `attachment-service`, notifikacije, audit), Modul 2 (`canUseEntity`, obaveze), Modul 4 (`worker_rates` — sat mehaničara), Modul 5 (`machine_faults`, `machine_meter_readings`, `machine_work_logs`, `machine_cost_components`, prag kvara), Modul 6 (`cost_entries`), Modul 7 (sati i satnice mehaničara)

Postojeće stanje (ostaje): `machine_faults` (`OPEN → WAITING_APPROVAL → APPROVED → IN_PROGRESS → DONE/CANCELLED`, `priority`, `estimated_cost_cents`, `downtime_minutes`, `partner_id`) + append-only `machine_fault_revisions`, `approval_requests` (`subject_type` **samo** `machine_fault`, prag `FAULT_COST_APPROVAL_THRESHOLD_CENTS = 50_000n`), mobilna prijava kvara + sync (`r4-sync-fault.ts`, `r5-fault-sync.ts`), `machine_cost_rates`/komponente (Modul 5), `cost_entries` (Modul 6, `SERVICE_ORDER` predviđen ali nema izvora), `partners.kind='SERVICE'`.

**Dijagnoza:** model poznaje **kvar** (događaj) i odobrenje njegove procjene. Ne poznaje **rad**: izvršioca, radnje, dijelove, stvarno trajanje, stvarni trošak, vraćanje u rad. Preventivno održavanje — pola B5.9 — nema nosilac. Skladište ne postoji ni u jednoj tabeli.

---

## 1. Poslovna pravila

### 1.1 Servisni nalog: jedan entitet, više porijekla
1. `service_orders` sa statusima `PLANNED → APPROVED → IN_PROGRESS → WAITING_PARTS → DONE | CANCELLED` (`CANCELLED` iz bilo kojeg osim `DONE`; `DONE` je terminalan).
2. `origin`: `FAULT` (iz kvara), `PREVENTIVE` (iz plana), `MANUAL`, `INSPECTION` (sa dnevnog pregleda, Modul 5).
3. `kind`: `INTERNAL` (vlastita radionica, `assigned_mechanic_worker_id`) | `EXTERNAL` (`partner_id`, `external_quote_cents`, `external_invoice_ref`).
4. **Jedan kvar = jedan nalog:** `machine_faults.status='APPROVED'` automatski otvara nalog (`origin='FAULT'`), `UNIQUE (company_id, fault_id) WHERE fault_id IS NOT NULL`. Kvar ostaje zapis o događaju, nalog je zapis o radu.
5. Kvar `REJECTED` (odobrenje odbijeno) → nalog `CANCELLED` sa razlogom; kvar ostaje vidljiv kao neriješen.
6. `total_cost_cents = labor_cost_cents + parts_cost_cents + external_cost_cents` — **izvedeno**, nikad ručno. `labor_cost_cents` = `labor_hours × satnica mehaničara na dan rada` (Modul 4/7).

### 1.2 Preventivno održavanje
7. `maintenance_templates` po kategoriji mašine: `code`, `name`, `basis` (`HOURS|KM|DAYS`), `interval_value`, `tolerance_pct` (default 10), `items JSONB`, `sort_order`.
8. `maintenance_plans` (po mašini): `template_id`, `basis`, `interval_value`, `tolerance_pct`, `last_done_at`, `last_done_meter`, `next_due_at`, `next_due_meter`, `is_active`.
9. **Okidač iz stvarnih podataka:** brojilo iz `machine_meter_readings` / `machine_work_logs` (Modul 5) i datum iz `next_due_at`. Kad se pređe `next_due − interval × tolerance_pct/100` → automatski `service_orders` red (`origin='PREVENTIVE'`, `status='PLANNED'`) + notifikacija mehaničaru. **Jedan nalog po planu po ciklusu** (`dedupe_key` = plan + `next_due_meter`).
10. **Istek preventivnog servisa mašinu ne blokira** (upozorenje na kartici mašine, Pregledu i u `canUseEntity`). Firma može uključiti `companies.block_on_overdue_maintenance` za strogu blokadu dodjele/radnih sati.
11. Zatvaranje preventivnog naloga pomjera `last_done_*` i računa `next_due_*` **iz stvarnog brojila u trenutku izvršenja**, ne iz plana.
12. Šablon „zamjena ulja svakih 250 h“ se definiše jednom po kategoriji; mašina nasljeđuje i može prepisati vrijednosti.

### 1.3 Dijelovi: minimalno skladište, spremno za Modul 10
13. `stock_items` (`code`, `name`, `unit`, `category_id NULL`, `min_quantity`, `is_active`) i `stock_movements` (`kind` `IN|OUT|TRANSFER|COUNT`, `quantity`, `unit_cost_cents`, `occurred_on`, `source_type`, `source_id`, `warehouse_id NULL`, `note`).
14. **Stanje je `SUM(stock_movements)`, nikad `UPDATE quantity`.** Automatske kretnje su idempotentne po `(company_id, source_type, source_id)`.
15. `service_order_parts` (`service_order_id`, `item_id`, `quantity`, `unit_cost_cents`, `stock_movement_id`) → `parts_cost_cents`.
16. `warehouse_id` je **nullable** u MVP-u (jedno implicitno skladište po firmi); Modul 10 dodaje više skladišta **bez promjene modela kretnji**.
17. Utrošak dijela skida zalihu i piše `cost_entries` (`category_id` = `MATERIJAL`/`REZERVNI DIJELOVI`) — jednom, sa vezom na nalog i mašinu.
18. Pad zaloge ispod `min_quantity` je upozorenje, ne blokada.

### 1.4 Knjiženje troška: mašina **ili** projekat
19. `cost_entries.source_type` dobija `SERVICE_ORDER` (Modul 5/6 to već predviđaju).
20. **Pravilo razgraničenja:** trošak ide **na projekat** ako je mašina u periodu zastoja bila dodijeljena projektu (`project_assignments`) i kvar je nastao u radu (nalog ima `project_id`); inače ide **samo na mašinu** (`project_id NULL`).
21. **Nikad oboje:** jedan `source_type + source_id` = jedan `cost_entries` red. `phase_id` iz dodjele ako postoji.
22. Stvarni mjesečni servisni trošak ulazi u komponentu `SERVICE` stope mašine (Modul 5) — time stopa postaje tačnija, ali **historijski snapshot ostaje**; stari obračuni se ne mijenjaju.

### 1.5 Odobrenja
23. `approval_requests.subject_type` se proširuje: `('machine_fault','service_order','purchase')`.
24. Prag servisa **po firmi** (`companies.service_approval_threshold_cents`, default **500 KM** — odvojen ključ od praga kvara, da se mijenjaju nezavisno).
25. Iznad praga: `PLANNED → APPROVED` traži odobrenje; **planiranje je besplatno**, odobrenje se traži prije `IN_PROGRESS`.
26. Vanjski servis iznad praga traži **ponudu** prije odobrenja (`external_quote_cents` obavezan).
27. Odbijeno odobrenje → `CANCELLED` + razlog (≥10 znakova), audit.

### 1.6 Vraćanje u rad i pouzdanost
28. `service_order_events` (`kind` `OPENED|APPROVED|STARTED|PARTS_REQUESTED|WAITING|FINISHED|REOPENED|CANCELLED`, `at`, `by`, `note`) — tok unutar naloga, append-only.
29. **Stvarni `downtime_minutes`** = `finished_at − started_at` (računa se; ručna korekcija uz razlog i audit). `machine_faults.downtime_minutes` se popunjava iz naloga kad postoji.
30. **MTBF/MTTR i trošak održavanja su izračuni, ne tabele:**
    - MTTR = prosječno `finished_at − started_at` po mašini u periodu;
    - MTBF = radni sati mašine u periodu / broj kvarova;
    - `maintenance_cost_per_hour` = `Σ servisni trošak / Σ radni sati` mašine.
31. Na kartici mašine: plan održavanja, historija naloga, trošak/h održavanja, MTBF/MTTR, „top 3 mašine po trošku održavanja“ za OWNER/ADMIN.

### 1.7 Garancija na popravku
32. `service_orders.warranty_until`: novi kvar na istoj mašini unutar garancije nosi `warranty_claim=true`, veže se na originalni nalog (`warranty_source_order_id`) i **ne stvara ponovni trošak** (trošak ide u `cost_entries` sa iznosom 0 i `note='garancija'`, ili se ne knjiži — vidljivo u svakom slučaju).
33. Modul 2 `WARRANTY` obligacija mašine ostaje izvor za garanciju proizvođača; `warranty_until` na nalogu je garancija **na izvedeni rad** — dvije različite stvari, obje vidljive.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `service_orders` (novo) | vidi §1.1; `UNIQUE (company_id, fault_id) WHERE fault_id IS NOT NULL`; `CHECK (total_cost_cents = labor + parts + external)` kao generisana kolona ili triger |
| `service_order_events` (novo) | vidi §1.6/28 |
| `service_order_parts` (novo) | vidi §1.3/15 |
| `maintenance_templates` (novo) | vidi §1.2/7 |
| `maintenance_plans` (novo) | vidi §1.2/8; unique `(company_id, machine_id, template_id)` |
| `stock_items` (novo) | vidi §1.3/13; unique `(company_id, code)` |
| `stock_movements` (novo) | vidi §1.3/13; djelimični unikat `(company_id, source_type, source_id) WHERE source_id IS NOT NULL` |
| `approval_requests` | `subject_type` CHECK proširen na `('machine_fault','service_order','purchase')` |
| `companies` | `+ service_approval_threshold_cents BIGINT DEFAULT 50000`, `+ block_on_overdue_maintenance BOOLEAN DEFAULT false` |
| `cost_entries` | `source_type` proširen sa `SERVICE_ORDER` (Modul 6 već ima CHECK listu) |
| `machine_faults` | `+ service_order_id NULL` (denormalizovan za brz prikaz), `downtime_minutes` se puni iz naloga |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight. Nijedan `DELETE` grant.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/service-orders` (+`?status&machine`) | `service.view` / `service.manage` |
| GET | `/api/service-orders/:id` (+events, parts, cost) | `service.view` |
| POST | `/api/service-orders/:id/start` / `/finish` / `/wait-parts` | `service.manage` |
| POST | `/api/service-orders/:id/approve` / `/reject` | `service.approve` |
| POST | `/api/service-orders/:id/parts` | `service.manage` |
| GET/POST/PATCH | `/api/maintenance-templates` | `service.manage` |
| GET/POST/PATCH | `/api/machines/:id/maintenance-plans` | `service.view` / `.manage` |
| GET | `/api/machines/:id/maintenance` (historija + MTBF/MTTR + trošak/h) | `equipment.view` |
| GET/POST | `/api/stock-items` | `stock.view` / `stock.manage` |
| POST | `/api/stock-movements` | `stock.manage` |
| GET | `/api/machines/:id/reliability?from&to` | `equipment.view` |

Nove dozvole: `service.view` (OWNER/ADMIN/PM/SITE_SUPERVISOR/MECHANIC), `service.manage` (MECHANIC/ADMIN/OWNER), `service.approve` (OWNER/ADMIN), `stock.view` (OWNER/ADMIN/PM/SITE_SUPERVISOR/MECHANIC), `stock.manage` (OWNER/ADMIN/MECHANIC).
Novi kodovi: `SERVICE_APPROVAL_REQUIRED`, `EXTERNAL_QUOTE_REQUIRED`, `SERVICE_ALREADY_DONE`, `MAINTENANCE_OVERDUE`, `STOCK_ALREADY_POSTED`, `WARRANTY_CLAIM_ACTIVE`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/servis` | **radionica**: red čekanja po prioritetu, mehaničar × mašina, „čekaju dijelove“, kašnjenje (koliko dana stoji), brzi `Start/Finish` |
| `/ured/servis/[id]` | nalog: mašina, kvar, radnje, dijelovi, sati, trošak (labor/dijelovi/vanjski), odobrenje, garancija, prilozi |
| `/ured/masine/[id]` tab „Održavanje“ | plan, historija naloga, trošak/h održavanja, MTBF/MTTR, garancije |
| `/ured/servis/planovi` | šabloni po kategoriji + planovi po mašini, „sljedeći servis za X h/dana“ |
| `/ured/dijelovi` | artikli, stanje (`SUM`), minimum, kretnje, ručni `IN`/`OUT` |
| `/pregled` | istekao/odmah ističe preventivni servis, nalozi bez odobrenja, zaliha pod minimumom |
| mobilno (mehaničar) | moji nalozi, start/stop, unos dijelova i sati — **offline**, sync kao Modul 3/5 |

---

## 5. Testovi

1. Kvar `APPROVED` automatski pravi nalog; drugi poziv ne pravi duplikat (`UNIQUE`); `REJECTED` poništava nalog.
2. Statusi: nedozvoljen prelaz odbijen (`WAITING_PARTS` ↔ `IN_PROGRESS` dopušteno, `DONE → IN_PROGRESS` nije).
3. Trošak: `total = labor + parts + external`; `labor_hours ×` satnica na dan rada; promjena satnice ne mijenja stari nalog.
4. Preventivno: pređen `next_due_meter − interval × tolerance` → nalog `PLANNED`; dupli okidač ne pravi drugi nalog; zatvaranje računa sljedeći rok iz stvarnog brojila.
5. Blokada: po defaultu **nema** blokade; sa `block_on_overdue_maintenance` dodjela/sati su blokirani, gorivo nije.
6. Dijelovi: utrošak skida zalihu; stanje = `SUM`; dupli `source_id` ne skida dvaput; pad pod minimum je upozorenje.
7. Knjiženje: mašina dodijeljena projektu → `cost_entries` sa `project_id`; nije dodijeljena → `project_id NULL`; nikad oba; dupli `source_id` odbijen.
8. Odobrenje: iznos ispod praga ne traži odobrenje; iznad traži; vanjski iznad praga bez ponude odbijen; `service.approve` bez role `FORBIDDEN`.
9. Zastoj: `downtime_minutes` iz `finished_at − started_at`; ručna korekcija traži razlog i piše audit.
10. Pouzdanost: MTBF/MTTR i trošak/h tačni na fiksnom skupu naloga i radnih sati.
11. Garancija: kvar unutar `warranty_until` nosi `warranty_claim=true` i ne stvara novi trošak.
12. Izolacija: firma B ne vidi naloge, dijelove, zalihe, planove firme A.

Van opsega: puno skladište (više skladišta, popis, prenos — Modul 10), nabavka dijelova i narudžbenice (Modul 10), obračun vanjskog servisa (Modul 10), telematika/dijagnostika mašine (B15).
