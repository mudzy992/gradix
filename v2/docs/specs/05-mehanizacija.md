# 05 — Mehanizacija: mašine, sati, gorivo, ture, pregledi, kvarovi

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.8, B6.9, B15.8 · **Modul:** 5 od 11
**Zavisi od:** Modul 1 (postavke firme, `attachment-service`, notifikacije), Modul 2 (`canUseEntity`, iznimke), Modul 3 (sync obrasci), Modul 4 (radnici, vozačke kategorije)

Postojeće stanje (ostaje): mašina i vozilo u jednoj tabeli, kategorije kao podatak, brojilo `HOURS`/`KM` + historija očitanja, `machine_work_logs` sa `mode` (`WORK`/`IDLE`/`BREAKDOWN`) + append-only revizije, `fuel_entries` sa `NULL` iznosom za nepoznato (D1), `hauls` + `route_segments`, `machine_daily_checks` + prilozi, `machine_faults` + `approval_requests` (prag 500 KM), `machine_cost_rates` (ravna stopa), `project_cost_entries` (`source_type='MACHINE_WORK_LOG'`).

---

## 1. Poslovna pravila

### 1.1 Trošak po satu: razložen, sa zamrznutim snapshotom
1. Stopa se sastoji od **komponenti**: `DEPRECIATION`, `FUEL`, `SERVICE`, `OPERATOR`, `INSURANCE`, `OTHER`, svaka sa `basis` (`PER_HOUR` | `PER_MONTH` | `PER_KM`) i periodom važenja.
2. Izračunata stopa = `Σ PER_HOUR` + `Σ PER_MONTH / companies.planned_hours_per_month` (default **160**) + `FUEL` iz prosječne potrošnje (ili planirane, ako stvarna ne postoji).
3. Komponente imaju **istoriju** (novi red, stari dobija `valid_to`) — nikad prepisivanje.
4. **Ručna stopa** ostaje dopuštena; jasno je označena (`is_manual`), promjena ide u audit sa razlogom, a ekran nudi „vrati na izračunato“.
5. **Pri knjiženju troška** (`project_cost_entries`) upisuje se **snapshot** (`rate_snapshot jsonb`: komponente, izračunata stopa, izvor, datum). Stari obračun ostaje objašnjiv i poslije promjene stope.
6. `project_cost_entries.source_type` se proširuje: `MACHINE_WORK_LOG`, `HAUL`, `FUEL_ENTRY`, `SERVICE_ORDER`, `MANUAL`. Unikatnost ostaje `(company_id, source_type, source_id)` — jedan događaj, jedan trošak (bez dvostrukog knjiženja).

### 1.2 Iskorištenost
7. Iskorištenost se **računa**, ne čuva: iz `machine_work_logs` po periodu.
8. **Primarna kolona:** `WORK / (WORK + IDLE + BREAKDOWN)` — definicija zapisana jednom, u domeni, sa testom. **Druga kolona:** `WORK / kalendarski radni sati` (radna sedmica i praznici iz Modula 1).
9. Prikaz: po mašini (mjesec), po kategoriji, top/bottom 5 na Pregledu. Isti izvor kao `project_cost_entries` — nema drugog sabiranja.

### 1.3 Gorivo: jedan izvor istine
10. `fuel_prices` (šifarnik): `fuel_kind`, `supplier_partner_id` (nullable), `price_cents`/lit, `currency_code`, `valid_from`. Točenje **predlaže** cijenu po datumu; ured može prepisati (tada `price_source='MANUAL'` u zapisu).
11. Iznos ostaje **nullable** kad je nepoznat (D1) — nema lažne nule.
12. **Potrošnja** po mašini = `litri / (metar_end − metar_start)`, jedinica `l/h` ili `l/100 km` po vrsti brojila.
13. **Odstupanje:** > `companies.fuel_deviation_threshold_pct` (default **20%**) iznad prosjeka zadnjih 90 dana → upozorenje na Pregledu i kartici mašine. Upozorenje ima **obavezan status** (`OPEN` → `EXPLAINED` sa razlogom `kvar`/`krađa`/`pogrešno očitanje`/`ostalo` ili `DISMISSED` sa razlogom). Ne zatvara se tiho.
14. **Cisterna** (opciono, `companies.fuel_tank_enabled`): ako je uključena, točenje nosi `tank_id` i skida stanje (`ulaz kupovine − izlaz točenja`); ako je isključena, točenje je na pumpi i stanje se ne vodi. **Nikad oba paralelno.**
15. Blokada iz Modula 2 za gorivo: **samo crveno upozorenje**, unos uvijek dopušten.

### 1.4 Ture i stacionaža
16. `route_segments` dobija API i UI: šifra, naziv, projekat, `from_km`+`from_m`, `to_km`+`to_m` (numerika, ne slobodan tekst), dužina izračunata.
17. Tura nosi `segment_id` (nullable); zbir po dionici daje **izvedene količine** — ulaz u Modul 6 i kasnije u situacije.
18. Količina ostaje `quantity` + `quantity_unit` (`M3`/`T`), uz `mass_kg`/`volume_m3` kad su poznati (vaga daje tone).
19. Korekcija ture je append-only sa razlogom (postojeće).

### 1.5 Dnevni pregled sa šablonom
20. `check_templates` po kategoriji mašine: stavke `{key, label, required, critical}`.
21. `machine_daily_checks` dobija `template_id` i `result` (`PASS`/`FAIL`).
22. **Kritična `FAIL` stavka** → obavezna fotografija + automatski otvara `machine_fault` (status `OPEN`, veza na pregled). Rad **nije** automatski blokiran — odluka je čovjeka, ali je vidljiva šefu i u `canUseEntity` kao upozorenje.

### 1.6 Kvarovi
23. Tok ostaje: `OPEN → WAITING_APPROVAL → APPROVED → IN_PROGRESS → DONE` (+ `CANCELLED`), sa razlogom za svaki prelaz.
24. Prag odobrenja troška **po firmi**: `companies.fault_approval_threshold_cents` (default **500 KM**); iznad praga → `WAITING_APPROVAL`, ispod → odmah `APPROVED`.
25. `APPROVED` kvar otvara **servisni nalog** (Modul 8); trošak naloga knjiži se u `project_cost_entries` sa `source_type='SERVICE_ORDER'`.
26. `downtime_minutes` ulazi u iskorištenost i u pouzdanost (MTBF/MTTR — izračun, ne tabela).

### 1.7 Dodjela i zauzetost mašine
27. Ista mašina **ne može** biti na dva projekta u istom periodu (triger + `pg_advisory_xact_lock`, isti obrazac kao radnici). Iznimka ide kroz Modul 2 (`usage_overrides`).
28. Kalendar zauzetosti: mjesec × mašina, boja po projektu, „slobodno“ vidljivo.
29. `canUseEntity`: registracija/tehnički/osiguranje **blokiraju** dodjelu, turu i radne sate; za gorivo samo upozorenje (Modul 2 §15).
30. Vozačka kategorija (Modul 4) za turu: upozorenje, ne blokada.

### 1.8 Najam mašine
31. `ownership` dobija `RENTED` uz `rental_partner_id`, `rental_rate_cents`, `rental_basis` (`PER_HOUR`|`PER_DAY`|`PER_MONTH`) i period.
32. Trošak najma ulazi u komponentu `OTHER` (ili vlastitu `RENTAL`) stope — unajmljena mašina ima stvarni trošak po satu.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `machine_cost_rates` | prestaje biti izvor istine za iznos; ostaje kao **ručna stopa** (`is_manual bool`, `reason`) |
| `machine_cost_components` (novo) | `id, company_id, machine_id, component, amount_cents, currency_code, basis, valid_from, valid_to, created_by` |
| `machine_cost_rate_snapshots` (novo) | `id, company_id, machine_id, computed_at, components JSONB, rate_cents, currency_code, source (CALCULATED/MANUAL)` |
| `project_cost_entries` | `+ rate_snapshot JSONB`, `source_type` proširen (§1.6), `+ component_breakdown JSONB` |
| `fuel_prices` (novo) | `id, company_id, fuel_kind, supplier_partner_id NULL, price_cents, currency_code, valid_from, created_by` |
| `fuel_entries` | `+ price_source ('PRICE_LIST'\|'MANUAL')`, `+ tank_id NULL`, `+ deviation_flag` |
| `fuel_tanks` (novo, opciono po firmi) | `id, company_id, name, capacity_l, current_l (izvedeno), last_count_at` |
| `route_segments` | `+ from_km, from_m, to_km, to_m INT`, `CHECK (to_km*1000+to_m > from_km*1000+from_m)`; `from_station/to_station` ostaju kao naziv |
| `check_templates` (novo) | `id, company_id, category_id NULL, name, items JSONB, is_active` |
| `machine_daily_checks` | `+ template_id`, `+ result ('PASS'\|'FAIL')` |
| `machines` | `+ rental_partner_id, rental_rate_cents, rental_basis, rental_from, rental_to`; `ownership` CHECK proširen sa `RENTED` |
| `companies` | `+ planned_hours_per_month SMALLINT DEFAULT 160`, `+ fuel_deviation_threshold_pct SMALLINT DEFAULT 20`, `+ fuel_tank_enabled BOOL DEFAULT false`, `+ fault_approval_threshold_cents BIGINT DEFAULT 50000` |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/machines/:id/cost-components` | `machines.cost_rate.view` / `.manage` |
| GET | `/api/machines/:id/cost-rate` (izračunata + komponente) | `machines.cost_rate.view` |
| GET | `/api/machines/:id/utilization?from&to` | `equipment.view` |
| GET/POST/PATCH | `/api/fuel-prices` | `machines.fuel.view` / `.manage` |
| GET/POST | `/api/fuel-tanks` (+`/:id/count`) | `machines.fuel.manage` |
| GET | `/api/fuel-entries/deviations` (+`/:id/explain`) | `machines.fuel.view` |
| GET/POST/PATCH | `/api/route-segments` | `machines.haul.view` / `.manage` |
| GET/POST/PATCH | `/api/check-templates` | `machines.check.manage` |
| GET | `/api/machines/:id/availability?from&to` | `equipment.view` |
| POST | `/api/machines/:id/rental` | `equipment.manage` |

Nove dozvole: `machines.fuel.manage`, `machines.check.manage`, `machines.haul.manage`.
Novi kodovi: `MACHINE_DOUBLE_BOOKED`, `FUEL_DEVIATION_EXPLANATION_REQUIRED`, `COST_RATE_MANUAL_OVERRIDE`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/masine/[id]` | kartica: osnovno, brojilo, **trošak/h (komponente)**, iskorištenost, gorivo (potrošnja + odstupanja), rokovi (`missing`), kvarovi, ture, zauzetost |
| `/ured/trosak-masina` | komponente po mašini, izračunata vs ručna stopa, istorija |
| `/ured/gorivo` | točenja + predložena cijena + odstupanja sa obaveznim objašnjenjem; cisterna tab ako je uključena |
| `/ured/stacionaze` | šifarnik dionica (km+m) + zbir izvedenih količina |
| `/ured/dnevni-pregled` | šablonski pregled, obavezna fotografija za `FAIL`, kritično odmah otvara kvar |
| `/ured/kvarovi` | tok + prag + „otvori servisni nalog“ |
| `/ured/masine/kalendar` | zauzetost po mjesecu |

---

## 5. Testovi

1. Stopa: komponente → izračunata stopa; mjesečna komponenta podijeljena sa 160; ručna stopa nadjačava uz audit.
2. Snapshot: knjiženje zapamti stopu; promjena komponente ne mijenja stari trošak.
3. Idempotencija: isti `source_type+source_id` ne knjiži dvaput.
4. Iskorištenost: obje kolone tačne na fiksnom skupu zapisa; `WORK/(WORK+IDLE+BREAKDOWN)` definicija testirana.
5. Gorivo: predložena cijena po datumu; `NULL` iznos ostaje `NULL`; odstupanje > 20% traži objašnjenje prije zatvaranja.
6. Cisterna: uključena → stanje = ulaz − izlaz; isključena → nema stanja i nema dvostruke evidencije.
7. Stacionaža: km+m validacija; zbir dužina po projektu.
8. Dnevni pregled: kritična `FAIL` bez fotografije se odbija; sa fotografijom otvara `machine_fault` vezan na pregled.
9. Kvar: prag po firmi; `APPROVED` otvara servisni nalog; trošak ulazi u projekat jednom.
10. Dvostruka dodjela: triger odbija, iznimka pušta uz rok; savremeni zahtjevi ne prolaze oba.
11. Blokade: istekla registracija blokira turu i sate, ne blokira gorivo.
12. Izolacija: firma B ne vidi troškove, gorivo, ture, preglede firme A.

Van opsega: GPS/telematika (B15), predmjer (Modul 6), servisni nalozi UI (Modul 8), nabavka goriva (Modul 10).
