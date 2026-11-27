# 07 — Obračun sati i troška rada

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.7 (Faza 1) · **Modul:** 7 od 11
**Zavisi od:** Modul 1 (postavke firme, praznici, notifikacije), Modul 3 (`work_entries`, `workdays`, `day_kind`, `rounding_minutes`, statusi dana), Modul 4 (`worker_rates`, `coefficient`, `worker_leave_entitlements`), Modul 6 (`cost_entries` — trošak rada po projektu), Modul 5 (rukovalac mašine)

Postojeće stanje (ostaje kao polazna tačka): `work_entries` (`kind` `WORK|BREAK`, `end_state` `OPEN|UNKNOWN_END|KNOWN_END`, `machine_id`, `project_id`), `workdays` (`approval_status` `SUBMITTED|FOREMAN_CONFIRMED|LOCKED`, `day_kind` iz Modula 3), `work_week_approvals`, `workday_revisions`, `listHoursForExport()` (jedan CSV: `radnik, datum, sati, projekat, status`), dozvola `payroll.hours.export` (OWNER/ADMIN/PM/ACCOUNTANT), ekran `/ured/obracun-sati` (dva datuma + tabela + CSV).

**Dijagnoza:** naziv je „obračun“, sadržaj je sirovi dnevni izvoz segmenata. Nema mjeseca kao jedinice obračuna, nema podjele sati po vrsti, nema satnice, nema iznosa, nema izostanaka, nema praznika, nema zaključavanja. Računovođa i dalje sabira ručno. Ovaj modul **ne dira** zakonske stope — daje model, aritmetiku i izvoz; sve stope su konfigurabilni podaci sa datumom važenja.

---

## 1. Poslovna pravila

### 1.1 Period obračuna
1. `pay_periods`: `year`, `month`, `status` (`OPEN` → `CALCULATED` → `APPROVED` → `LOCKED`), `calculated_at`/`calculated_by`, `approved_at`/`approved_by`, `locked_at`/`locked_by`. Unique `(company_id, year, month)`.
2. `OPEN`: sati se slobodno mijenjaju. `CALCULATED`: obračun izračunat i zamrznut u reviziji; ponovni izračun je **nova revizija** (`payroll_runs.revision`), stara ostaje. `APPROVED`: računovodstvo potvrdilo. `LOCKED`: isplaćeno.
3. Prelaz `CALCULATED → APPROVED` **odbija se** ako postoji `RATE_MISSING`, `PARAMETER_MISSING`, otvoren sukob (`sync_conflicts`) ili dan sa `approval_status='SUBMITTED'` u periodu.
4. Nakon `LOCKED` izmjena radnog dana je **dozvoljena** — posao se nastavlja — ali automatski otvara `pay_corrections` red (§1.7). Stari obračun se **ne prepisuje**.

### 1.2 Izvor sati i klasifikacija
5. Ulaz: `work_entries` sa `kind='WORK'`, `end_state='KNOWN_END'`, iz `workdays` sa `approval_status IN ('FOREMAN_CONFIRMED','LOCKED')` i `day_kind='WORK'`, `work_date` u periodu. `BREAK` je isključen po `kind`; `UNKNOWN_END`/`OPEN` dani blokiraju izračun (§1.1/3).
6. Segment se dijeli na dijelove: **noćni** po `companies.night_from`/`night_to` (prelaz preko ponoći), **praznik** po `company_holidays.is_paid`, **nedjelja** po `companies.week_start`.
7. **Prioritet jedne kategorije** (sat nikad nije plaćen dvaput): `PRAZNIK > NEDJELJA > NOĆNI > PREKOVREMENI > REDOVNI`. Algoritam je jedan, u domeni (`packages/domain`), sa testom na graničnim slučajevima (praznik koji je nedjelja, noćni prekovremeni, segment preko ponoći).
8. **Prekovremeni:** `companies.overtime_daily_threshold` po danu (default 8.00) **ili** sedmični prag (`overtime_weekly_threshold`, nullable) — `companies.overtime_basis` (`DAILY`|`WEEKLY`), default `DAILY`. **Nikad oba**; promjena osnova važi od narednog perioda.
9. Zaokruživanje segmenata po `companies.rounding_minutes` (Modul 3, default 0) — obračun koristi **već zaokružene** sate, ne zaokružuje ponovo.
10. **Izostanci** se ne izvode iz sati: za `day_kind ≠ 'WORK'` nastaje linija sa `days` (1 ili 0.5 po `absence_note`) i komponentom `BOLOVANJE`/`GODIŠNJI`; `UNPAID_LEAVE` i `NO_SHOW` daju liniju sa iznosom 0, ali **vidljivu** (objašnjivost).

### 1.3 Satnica i parametri
11. `rate` = `worker_rates` važeća **na dan rada** (historija, Modul 4), `coefficient` primijenjen na osnovnu satnicu prije množenja sati; izbor je zapisan u `calc_note`. Nedostaje satnica → `RATE_MISSING`, period se ne zaključava. **Nema tihe nule.**
12. `payroll_components` je **šifarnik po firmi**: `code`, `name`, `kind` (`EARNING|DEDUCTION`), `basis` (`HOURS|DAYS|FIXED|PERCENT_OF_EARNINGS`), `category` (`REGULAR|OVERTIME|NIGHT|SUNDAY|HOLIDAY|ABSENCE|FIELD_ALLOWANCE|ADVANCE|LOAN|OTHER`), `is_taxable`, `sort_order`, `is_active`. Početni set pri onboardingu: `REDOVNI`, `PREKOVREMENI`, `NOĆNI`, `NEDJELJA`, `PRAZNIK`, `BOLOVANJE`, `GODIŠNJI`, `TERENSKI`, `AKONTACIJA`, `POZAJMICA`, `OSTALO`.
13. `payroll_parameters`: `code`, `value NUMERIC`, `unit` (`MULTIPLIER|PERCENT|CENTS`), `valid_from`, `valid_to`, `confirmed_by`, `note`. Kodovi: `OVERTIME_MULTIPLIER` (**default 1.0**), `NIGHT_MULTIPLIER`, `SUNDAY_MULTIPLIER`, `HOLIDAY_MULTIPLIER`, `SICK_PAY_PCT`, `FIELD_ALLOWANCE_PER_DAY`. **Nijedan zakonski procenat nije u kodu.** Nedostaje parametar → linija nosi `PARAMETER_MISSING` i ne izdaje iznos.
14. **Rukovalac mašine:** plata isključivo iz radnih sati (`workdays`/`work_entries`); `machine_work_logs` ide **isključivo** u trošak projekta (Modul 5/6). Nikad obrnuto, nikad oboje.

### 1.4 Obračun i raspis
15. `payroll_runs` (`period_id`, `revision`, `status`, `computed_at`, `computed_by`, `payload JSONB` sa ulaznim hashom). `payroll_run_lines` (`run_id`, `worker_id`, `component_code`, `hours`, `days`, `rate_cents`, `amount_cents`, `currency_code`, `calc_note`, `source_hash`) + `status` (`OK|RATE_MISSING|PARAMETER_MISSING`).
16. `payroll_line_sources` (`line_id`, `source_type` `WORK_ENTRY|WORKDAY|ADJUSTMENT`, `source_id`, `hours`, `applied_parameters JSONB`): **raspis** — klik na liniju pokazuje koji su zapisi ušli i koji je parametar primijenjen, sa datumom važenja. Isti raspis ide kao drugi list izvoza.
17. Automatski spoj sa Modulom 6: za svaku liniju `amount_cents` nastaje i `cost_entries` red (`source_type='WORKDAY'`, `source_id = workday_id`, `category_id` `RAD`) — **idempotentno** po `(company_id, source_type, source_id)`. Trošak rada tako ulazi u budžet projekta jednom.
18. Faza 2 pripremljena, ne implementirana: `payroll_run_lines.gross_cents`, `net_cents`, `contributions JSONB` ostaju **prazni** u MVP-u.

### 1.5 Terenski dodatak, akontacije, pozajmice
19. **Terenski** = `FIELD_ALLOWANCE_PER_DAY × broj dana na terenu`; teren = dan rada na projektu čiji `site_place` ≠ `companies.city`. Ručna korekcija dopuštena uz razlog.
20. `worker_advances` (`worker_id`, `amount_cents`, `issued_on`, `kind` `ADVANCE|LOAN`, `installment_cents NULL`, `remaining_cents`, `note`): akontacija se odbija u mjesecu izdavanja, pozajmica u ratama. Obje su `DEDUCTION` linije sa vezom na izvor.
20a. Izračun `OPEN`/`CALCULATED` perioda samo rezerviše odbitak u posljednjoj reviziji. Druge nezaključane revizije istog perioda ne rezervišu dodatni dug; rezervacije drugih perioda imaju prednost prema redoslijedu obrade. Tek `LOCKED` atomski umanjuje `remaining_cents`, jednom. Datum izdavanja mora biti u periodu ili ranije.
21. **Odbici nikad ne stvaraju negativan obračun:** ako ukupni odbici prelaze zaradu mjeseca, naplaćuje se do nule, a ostatak (`remaining_cents`) prelazi u sljedeći period. Nema negativne linije.

### 1.6 Izvoz
22. **XLSX, dva lista:** `OBRAČUN` (jedan red = radnik, kolone = komponente: sati redovni/prekovremeni/noćni/nedjelja/praznik, dani bolovanja/godišnjeg, terenski, akontacija, pozajmica, ukupno zarade, ukupno odbici, **bruto osnova**) i `RASPIS` (jedan red = linija sa izvorima). CSV ostaje sekundarni, isti sadržaj.
23. Izvoz je **isključivo `LOCKED`** po defaultu; opcija „uključi `FOREMAN_CONFIRMED` (provizorno)“ je eksplicitna i nosi oznaku u zaglavlju fajla. Time se rješava dvostruki izvoz istog dana kroz dva statusa.
24. `export_format_version` u zaglavlju; raspored kolona potvrđuje računovođa prije implementacije, a promjena verzije je vidljiva u audit-u.

### 1.7 Korekcije nakon zaključavanja
25. `pay_corrections` (`period_id`, `workday_id`/`payroll_line_id`, `delta_hours`, `delta_amount_cents`, `reason` (obavezan), `target_period_id`, `status` `OPEN|APPLIED`): izmjena dana u `LOCKED` periodu otvara korekciju koja se primjenjuje u **narednom** obračunu.
25a. Automatska evidencija izmjene ne određuje novčanu razliku: računovođa ili drugi korisnik s `payroll.manage` na kartici radnika potvrđuje **već izračunati** potpisani iznos u BAM i obrazloženje (sati sami nisu dovoljni za klasifikacije/dodatke). Potvrda se evidentira u finansijskom auditu i ne može se prepisati. Ciljni period mora se zatim ponovo izračunati; neobrađena korekcija blokira odobrenje i zaključavanje. Ako su podaci za ispravan obračun nepotpuni, iznos ne treba nagađati.
26. Korekcija je vidljiva na oba mjesta: u periodu gdje je nastala (referenca) i u periodu gdje je primijenjena (linija sa `calc_note`). Ništa se ne briše.

### 1.8 Kontrola i pristup
27. **`SELF_APPROVAL_FORBIDDEN`:** niko ne odobrava obračun u kojem je sam (radnik iz obračuna vezan na `approved_by`) — važi za računovođu, PM i šefa.
28. `payroll.own.view`: radnik vidi **svoje** sate, svoj mjesečni zbroj i linije svog obračuna kad je period `APPROVED`/`LOCKED`. Tuđe ne vidi nikad.
29. Plate i satnice vide samo OWNER/ADMIN/ACCOUNTANT (Modul 4). PM/šef vide **sate**, nikad iznose.
30. „Period spreman za obračun“ = svi dani `FOREMAN_CONFIRMED`/`LOCKED`, bez otvorenih sukoba, bez `RATE_MISSING`/`PARAMETER_MISSING` — status na ekranu perioda, ne skrivena provjera.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `pay_periods` (novo) | `id, company_id, year SMALLINT, month SMALLINT, status, calculated_at/by, approved_at/by, locked_at/by`; unique `(company_id, year, month)`; `CHECK (month BETWEEN 1 AND 12)` |
| `payroll_components` (novo) | vidi §1.3/12; unique `(company_id, code)` |
| `payroll_parameters` (novo) | vidi §1.3/13; unique `(company_id, code, valid_from)`; `CHECK (valid_to IS NULL OR valid_to > valid_from)` |
| `payroll_runs` (novo) | `id, company_id, period_id, revision, status ('DRAFT'\|'CALCULATED'\|'APPROVED'), computed_at, computed_by, payload JSONB`; unique `(company_id, period_id, revision)` |
| `payroll_run_lines` (novo) | vidi §1.4/15 + `status ('OK'\|'RATE_MISSING'\|'PARAMETER_MISSING')`, `gross_cents NULL`, `net_cents NULL`, `contributions JSONB NULL` (Faza 2) |
| `payroll_line_sources` (novo) | vidi §1.4/16 |
| `worker_advances` (novo) | vidi §1.5/20; `CHECK (remaining_cents >= 0)` |
| `pay_corrections` (novo) | vidi §1.7/25 |
| `companies` | `+ overtime_basis ('DAILY'\|'WEEKLY') DEFAULT 'DAILY'`, `+ overtime_weekly_threshold NUMERIC(4,2) NULL` (ostalo — `overtime_daily_threshold`, `night_from/to`, `workday_hours`, `rounding_minutes` — već iz Modula 1/3) |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight. Nijedan `DELETE` grant.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET | `/api/pay-periods` (+`?year`) / `/:id` | `payroll.view` |
| POST | `/api/pay-periods/:id/calculate` | `payroll.manage` |
| POST | `/api/pay-periods/:id/approve` | `payroll.approve` |
| POST | `/api/pay-periods/:id/lock` | `payroll.approve` |
| GET | `/api/pay-periods/:id/lines` (+`?worker&component`) | `payroll.view` |
| GET | `/api/payroll/lines/:id/sources` (raspis) | `payroll.view` |
| GET | `/api/me/payroll?period` (vlastiti sate i obračun) | `payroll.own.view` |
| GET | `/api/pay-periods/:id/export?format=xlsx\|csv&includeProvisional` | `payroll.hours.export` |
| GET/POST/PATCH | `/api/payroll/parameters` | `payroll.manage` |
| GET/POST/PATCH | `/api/payroll/components` | `payroll.manage` |
| GET/POST | `/api/workers/:id/advances` | `payroll.manage` |
| GET | `/api/payroll/corrections` (+`?worker`) | `payroll.view` |
| POST | `/api/payroll/corrections` (potvrda iznosa i obrazloženje) | `payroll.manage` |

Nove dozvole: `payroll.view` (OWNER, ADMIN, ACCOUNTANT), `payroll.manage` (OWNER, ADMIN, ACCOUNTANT), `payroll.approve` (OWNER, ADMIN, ACCOUNTANT — uz `SELF_APPROVAL_FORBIDDEN`), `payroll.own.view` (svi, samo vlastito).
Novi kodovi: `RATE_MISSING`, `PARAMETER_MISSING`, `PERIOD_NOT_READY`, `SELF_APPROVAL_FORBIDDEN`, `PERIOD_LOCKED_CORRECTION`, `NEGATIVE_NET_FORBIDDEN`, `PAYROLL_ALREADY_LOCKED`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/obracun-sati` | **prepravljen:** lista perioda (mjesec × status × broj radnika × bruto) + „Spremnost“ indikator; klik vodi u period |
| `/ured/obracun-sati/[period]` | tabela radnik × komponente (sati i iznosi), boja za `RATE_MISSING`/`PARAMETER_MISSING`, dugmad Izračunaj / Odobri / Zaključaj, izvoz XLSX/CSV |
| isto, drill-down linije | **raspis**: izvorni dani/sati, primijenjeni parametri sa datumom važenja |
| `/ured/obracun-sati/postavke` | komponente (šifarnik) + parametri sa datumom važenja, istorija, „ko je potvrdio“ |
| `/ured/radnici/[id]` | tab „Obračun“: mjesečni zbroj, akontacije/pozajmice, korekcije |
| mobilno `/moj-obracun` | radnik: svoji sati po danu za mjesec, zbroj po komponentama kad je period odobren/zaključan |
| `/pregled` | „period nije zaključan“ podsjetnik računovodstvu nakon 5. u mjesecu |

---

## 5. Testovi

1. Klasifikacija: fiksni skup segmenata → sati po kategorijama; praznik-nedjelja i noćni-prekovremeni idu u **jednu** kategoriju; zbir kategorija = ukupni sati.
2. Granica ponoći: segment 22:00–02:00 daje noćne sate po `night_from/to`, bez gubitka minute.
3. Prekovremeni: dnevni prag 8 h → 10 h rada = 8 redovnih + 2 prekovremena; sedmični osnov daje drugu raspodjelu; oba nikad istovremeno.
4. Praznik: `company_holidays.is_paid` mijenja kategoriju; neradni dan bez `is_paid` ne plaća se kao praznik.
5. Izostanci: `day_kind='SICK'` daje liniju dana bez sati; `UNPAID_LEAVE`/`NO_SHOW` vidljivi sa 0; `VACATION` konzumira saldo (Modul 4) bez dvostrukog unosa.
6. Satnica: koristi se stopa važeća na dan rada, ne trenutna; `coefficient` primijenjen; `RATE_MISSING` blokira `APPROVED`.
7. Parametri: nedostatak množioca → `PARAMETER_MISSING`, linija bez iznosa; promjena parametra od narednog perioda ne mijenja stari obračun.
8. Revizije: ponovni izračun = nova revizija; stara ostaje čitljiva i sa istim iznosima.
9. Zaključavanje: `LOCKED` period + izmjena dana → `pay_corrections` red, stari obračun nepromijenjen, korekcija se primjenjuje u narednom periodu.
10. Raspis: svaka linija ima izvore; zbir `payroll_line_sources.hours` = linija `hours`.
11. Terenski: dan na projektu van sjedišta daje dodatak; ručna korekcija traži razlog.
12. Akontacija/pozajmica: rata se odbija, `remaining_cents` se smanjuje; kad odbici prelaze zaradu, obračun nije negativan i ostatak prelazi dalje.
13. Samoodobravanje: računovođa koji je i radnik u obračunu ne može odobriti svoj period.
14. Trošak rada: `cost_entries` (`WORKDAY`) nastaje jednom po danu rada; ponovni izračun ne duplira.
15. Izvoz: XLSX ima oba lista; `export_format_version` u zaglavlju; default isključuje `FOREMAN_CONFIRMED`; provizorni izvoz je označen.
16. Vlastiti pregled: radnik vidi svoje, ne tuđe; iznosi skriveni dok period nije `APPROVED`/`LOCKED`.
17. Izolacija: firma B ne vidi periode, parametre, komponente, akontacije firme A.

Van opsega (Faza 2, uz pisanu potvrdu računovođe i paralelni probni obračun): bruto→neto, doprinosi, porez, olakšice, platni listić PDF, uplatni nalozi, bankovni export.

### Nadogradnja rezervacija (Sweep 2B)

Migraciju `20261201120000_sweep2b_advance_reservations` izvršiti u održavanju, bez paralelnog rada stare aplikacije, kontrolisanim migracijskim administratorom sa `BYPASSRLS` ili superuser privilegijom; runtime `gradix_app` je nikad ne izvodi. Migracija atomarno vraća odbitke svih historijskih revizija nezaključanih perioda, a posljednja revizija postaje rezervacija. Zaključani periodi ostaju naplaćeni. Ako naslijeđeni izvori i saldo nisu konzistentni, migracija se zaustavlja bez promjena (`ADVANCE_LEGACY_BALANCE_INCONSISTENT`); prije ponovnog pokušaja potrebna je računovodstvena provjera i usklađenje podataka, ne ručno preskakanje migracije. Dovršena migracija se ne primjenjuje dvaput.
