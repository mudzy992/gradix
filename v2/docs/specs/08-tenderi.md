# 08 — Tenderi: od prilike do dobijenog projekta

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.3 (+ Partneri R7.1) · **Modul:** 8 od 11
**Zavisi od:** Modul 1 (postavke, `attachment-service`, notifikacije), Modul 2 (obaveze, `canUseEntity`), Modul 4 (`worker_rates` za kalkulaciju), Modul 5 (`machine_cost_components` za kalkulaciju), Modul 6 (predmjer, faze, `contract_value_cents` — konverzija)

Postojeće stanje (ostaje): `tenders` (`title`, `partner_id` uz `partners.kind='CLIENT'`, `submitted_value_cents`/`currency_code`, `submitted_at`, `status`, `note`, `converted_project_id` UNIQUE), matrica prelaza u `tender-status.ts` + `MATRIX.md` + parity test, atomska konverzija (`tender-convert.ts`: `withCompany`, claim `UPDATE ... WHERE status='WON' AND converted_project_id IS NULL`, `ALREADY_CONVERTED`), `tender_attachments` (register → MinIO → confirm), `obligations.tender_id` + `entity_kind='TENDER'` + `TENDER_DOCS`, dozvole `tenders.view/manage/convert`, UI `/ured/tenderi` + `[id]`.

**Dijagnoza:** mehanika statusa, priloga i konverzije je dobra i ostaje. Nedostaje proces nabavke posla: rok za dostavu, izvor, kalkulacija sa maržom, kontrolna lista dokumenata, garancije, strukturirani ishod, uspješnost. Konverzija pravi projekat sa `name` + `note` — bez vrijednosti, predmjera, tima i dokumenata, pa se isti posao unosi drugi put.

---

## 1. Poslovna pravila

### 1.1 Tok sa odlukom o učešću
1. Statusi: `OPPORTUNITY → GO_NO_GO → PREPARATION → SUBMITTED → EVALUATION → WON | LOST | WITHDRAWN | CANCELLED`.
2. Prelazi ostaju **eksplicitna matrica u kodu** (`tender-status.ts`) i u `MATRIX.md`; parity test se proširuje na nove statuse. Preskakanje nije dopušteno.
3. `GO_NO_GO` nosi **odluku o učešću**: `participate` (DA/NE), `reason`, `decided_by`, `decided_at`. NE → `CANCELLED` sa razlogom. Bez odluke nema prelaska u `PREPARATION`.
4. `WITHDRAWN` = firma povukla **poslije** predaje. `CANCELLED` = odustala prije predaje ili naručilac poništio. Dvije različite stvari, dvije različite statistike.
5. Migracija postojećih: `DRAFT → OPPORTUNITY`, `SUBMITTED → SUBMITTED`; `WON/LOST/WITHDRAWN` ostaju. Bez gubitka redova.

### 1.2 Datumi i izvor
6. `deadline_at` (**obavezan** za prelazak u `SUBMITTED`), `questions_deadline_at`, `site_visit_at`, `opened_at` (javno otvaranje).
7. `source` (`PORTAL|INVITATION|DIRECT|OTHER`), `portal_name`, `external_ref` (referentni broj naručioca; unique po firmi kad postoji).
8. `estimated_value_cents` = procjena naručioca, **odvojeno** od naše ponuđene vrijednosti.
9. Pri prelasku u `PREPARATION` automatski nastaju dvije obaveze (Modul 2): `TENDER_DEADLINE` i `TENDER_QUESTIONS`, `default_reminder_days` `14/7/3/1`, `blocks_assignment=false`. Jedan posao — ne ručni unos dvaju rokova.

### 1.3 Kalkulacija
10. `tender_boq_items`: `code`, `description`, `unit`, `quantity`, `unit_cost_cents`, `unit_price_cents`, `sort_order` — **ista struktura kao `project_boq_items`** (Modul 6), da konverzija bude kopija.
11. `tender_resources`: `kind` (`LABOR|MACHINE|MATERIAL|SUBCONTRACTOR|OTHER`), `description`, `quantity`, `unit`, `unit_cost_cents`, `worker_rate_ref`/`machine_id` NULL. Cijena se **predlaže** iz `worker_rates` (Modul 4) i `machine_cost_components` (Modul 5) — stvarni trošak, ne procjena iz glave.
12. Cijena: `direct_cost_cents` = `Σ predmjer.quantity × unit_cost` + `Σ resursi`; `markup_pct` + `risk_reserve_pct` − `discount_pct` → `offered_value_cents`. `submitted_value_cents` postaje **izvedena** vrijednost sa `price_source` (`CALCULATED|MANUAL`); ručno prepisivanje traži razlog.
13. `tender_price_revisions` (`revision`, `offered_value_cents`, `markup_pct`, `approved_by`, `reason`): cijena se mijenja **kroz reviziju**, nikad prepisivanjem. Izmjena > **5%** ili ispod minimalne marže (`companies.min_markup_pct`) traži `tenders.price.approve` (OWNER/ADMIN).
14. **Kopiranje iz sličnog tendera** (`copyFromTenderId`): predmjer + resursi + kontrolna lista. **Ne** kopira naručioca, datume, cijenu ni ishod.

### 1.4 Kontrolna lista dokumenata i garancije
15. `tender_checklist_templates` (po firmi) → `tender_checklist_items` (`code`, `label`, `required`, `status` `MISSING|ATTACHED|NOT_APPLICABLE`, `attachment_id`, `valid_until`, `note`).
16. Prelazak u `SUBMITTED` **odbijen** (`TENDER_CHECKLIST_INCOMPLETE`) dok svaka `required` stavka nije `ATTACHED` ili `NOT_APPLICABLE` sa razlogom.
17. **Pravilo protiv duplikata:** dokument koji firma ima jednom (uvjerenje, licenca, BZR) je `obligation` **firme** (Modul 2); dokument vezan na ovaj tender (ponudbena garancija, izjava) je stavka checkliste tendera. Nikad oboje.
18. **Bankarske garancije** = poseban tip checkliste sa `guarantee_type` (`BID|PERFORMANCE|ADVANCE|WARRANTY`), `bank`, `amount_cents`, `valid_until`, `returned_at`. Podsjetnik **30 dana** prije isteka; povrat garancije se evidentira (novac i obaveza prema banci).

### 1.5 Ishod i uspješnost
19. `tender_outcomes` (UNIQUE po tenderu): `result`, `lost_reason` (`PRICE|TECHNICAL|DOCUMENTATION|RELATIONSHIP|SCOPE|OTHER`), `winner_partner_id`, `winner_value_cents`, `bidders_count`, `our_rank`, `note`, `recorded_by`, `recorded_at`.
20. Prelazak u `LOST`/`WITHDRAWN`/`CANCELLED` **zahtijeva** ishod sa razlogom. `winner_value_cents` i `our_rank` su opcioni, ali se nude kao najkorisniji podatak.
21. **Uspješnost je izračun, ne tabela:** win rate po broju i po vrijednosti, prosječna marža dobijenih vs izgubljenih, po naručiocu, po tipu radova; „vrijednost u toku“ = `Σ offered_value` za `PREPARATION|SUBMITTED|EVALUATION`.

### 1.6 Konverzija: potpuna i atomska
22. `convertTenderToProject` (isti claim obrazac, jedna `withCompany` transakcija) prenosi:
    1. `projects` sa `contract_value_cents` = **odobrena revizija ponude**, `starts_on`/`ends_on`, `note`; `manager_worker_id` iz predloženog tima ako postoji.
    2. **Predmjer** → `project_boq_items` (1:1, isti `code`/`unit`/`quantity`/`unit_price`).
    3. **Faze** → `project_phases` iz `tender_phases` ako su unesene, inače jedna faza „Izvođenje“ sa `weight 1`.
    4. **Obaveze** → samo dokumenti relevantni za izvođenje (dozvole, saglasnosti) postaju `obligations` projekta; tender-dokumenti ostaju na tenderu.
    5. **Prilozi** → nove veze u `attachment-service` na isti `object_key` (bez dupliranja bajtova).
    6. **Tim** → `project_assignments` iz `tender_team` kao **predlog** (`note='predlog iz tendera'`), potvrđuje PM.
23. Djelimična konverzija nije moguća; ponovni pokušaj → `ALREADY_CONVERTED` (postojeće ponašanje).

### 1.7 Dozvole
24. `tenders.view` (OWNER/ADMIN/PM/ACCOUNTANT), `tenders.manage` (OWNER/ADMIN/PM), `tenders.convert` (OWNER/ADMIN/PM) — ostaje.
25. Novo: `tenders.price.manage` (OWNER/ADMIN/PM), `tenders.price.approve` (OWNER/ADMIN), `tenders.outcome.manage` (OWNER/ADMIN/PM).
26. **ACCOUNTANT vidi vrijednost ponude i ishod, ali ne internu kalkulaciju ni maržu** — isto pravilo kao satnice u Modulu 4.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `tenders` | `+ deadline_at`, `+ questions_deadline_at`, `+ site_visit_at`, `+ opened_at`, `+ source`, `+ portal_name`, `+ external_ref`, `+ estimated_value_cents`, `+ price_source ('CALCULATED'\|'MANUAL')`, `+ markup_pct`, `+ current_revision`; `status` CHECK proširen na 9 vrijednosti |
| `tender_boq_items` (novo) | vidi §1.3/10 |
| `tender_resources` (novo) | vidi §1.3/11 |
| `tender_price_revisions` (novo) | vidi §1.3/13; unique `(company_id, tender_id, revision)` |
| `tender_checklist_templates` (novo) | `id, company_id, code, label, required, sort_order, is_active` |
| `tender_checklist_items` (novo) | `id, company_id, tender_id, code, label, required, status, attachment_id NULL, valid_until, note, guarantee_type NULL, bank NULL, amount_cents NULL, returned_at NULL` |
| `tender_outcomes` (novo) | vidi §1.5/19; UNIQUE `(company_id, tender_id)`; `CHECK (result IN (...))` |
| `tender_phases` (novo) | `id, company_id, tender_id, code, name, weight, planned_start, planned_end, sort_order` |
| `tender_team` (novo) | `id, company_id, tender_id, worker_id, role ('PM'\|'SUPERVISOR'\|'MEMBER')` |
| `obligation_types` | `+ TENDER_DEADLINE`, `+ TENDER_QUESTIONS` (`entity_kind='TENDER'`, `{14,7,3,1}`, `blocks_assignment=false`) |
| `companies` | `+ min_markup_pct NUMERIC(5,2) DEFAULT 0` |

Migracija statusa: `UPDATE tenders SET status='OPPORTUNITY' WHERE status='DRAFT'` + novi CHECK. `submitted_value_cents` ostaje NOT NULL (izveden ili ručan).

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/tenders` / `/:id` (proširena polja) | `tenders.view` / `tenders.manage` |
| POST | `/api/tenders/:id/decision` (`GO_NO_GO` DA/NE + razlog) | `tenders.manage` |
| GET/POST/PATCH | `/api/tenders/:id/boq` | `tenders.view` / `tenders.price.manage` |
| GET/POST/PATCH | `/api/tenders/:id/resources` | `tenders.price.manage` |
| POST | `/api/tenders/:id/price-revisions` (+`/:rev/approve`) | `tenders.price.manage` / `.approve` |
| GET | `/api/tenders/:id/calculation` (direct cost, markup, marža) | `tenders.price.manage` |
| GET/POST/PATCH | `/api/tenders/:id/checklist` | `tenders.view` / `tenders.manage` |
| GET/POST/PATCH | `/api/tender-checklist-templates` | `tenders.manage` |
| GET/POST | `/api/tenders/:id/guarantees` (+`/:id/return`) | `tenders.manage` |
| PUT | `/api/tenders/:id/outcome` | `tenders.outcome.manage` |
| GET | `/api/tenders/performance?from&to&partnerId` | `tenders.view` |
| POST | `/api/tenders/:id/copy` (`copyFromTenderId`) | `tenders.manage` |
| POST | `/api/tenders/:id/convert` (prošireno) | `tenders.convert` |

Novi kodovi: `TENDER_CHECKLIST_INCOMPLETE`, `TENDER_DEADLINE_REQUIRED`, `TENDER_DECISION_REQUIRED`, `TENDER_OUTCOME_REASON_REQUIRED`, `TENDER_PRICE_APPROVAL_REQUIRED`, `TENDER_REFERENCE_TAKEN`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/tenderi` | tabela sa **rokom dostave i brojem dana do roka**, statusom, vrijednošću, maržom (samo `price.manage`); kanban po statusu |
| `/ured/tenderi/[id]` | tabovi: **Pregled** (datumi, izvor, odluka, rokovi), **Kalkulacija** (predmjer + resursi + markup + marža + revizije), **Dokumenti** (checklista + garancije), **Prilozi**, **Ishod**, **Tim**, **Konverzija** |
| odluka o učešću | jedan dijalog: DA/NE + razlog; bez odluke nema pripreme |
| `/ured/tenderi/uspjesnost` | win rate po broju/vrijednosti, po naručiocu, marža dobijenih vs izgubljenih, „vrijednost u toku“ |
| `/ured/tenderi/novi` | sa „kopiraj iz sličnog“ |
| kalendar | rokovi dostave, pitanja, obilazak lokacije, otvaranje, garancije |
| `/pregled` | tenderski rokovi u narednih 14 dana + garancije koje ističu |

---

## 5. Testovi

1. Matrica: svaki nedozvoljen prelaz odbijen; `GO_NO_GO → PREPARATION` bez odluke odbijen; parity test zelen sa novim statusima.
2. Migracija: `DRAFT` → `OPPORTUNITY` bez gubitka; stari redovi i dalje čitljivi.
3. `SUBMITTED` bez `deadline_at` odbijen (`TENDER_DEADLINE_REQUIRED`).
4. Automatske obaveze: prelazak u `PREPARATION` pravi `TENDER_DEADLINE` + `TENDER_QUESTIONS` sa `14/7/3/1`; ne pravi duplikate pri ponovnom pozivu.
5. Kalkulacija: `direct_cost` = predmjer + resursi; markup i rezerva daju `offered_value`; `CALCULATED` vs `MANUAL` zapisan.
6. Revizija cijene: izmjena > 5% traži `price.approve`; revizija 2 ne mijenja reviziju 1; `current_revision` tačan.
7. Kopiranje: predmjer + resursi + checklista preneseni; naručilac, datumi i cijena **nisu**.
8. Checklista: `required` bez priloga blokira `SUBMITTED`; `NOT_APPLICABLE` sa razlogom pušta; garancija bez `valid_until` odbijena.
9. Garancija: podsjetnik 30 dana prije isteka; `returned_at` evidentiran; ističe u `/pregled`.
10. Ishod: `LOST` bez razloga odbijen; `winner_value_cents` i `our_rank` se čuvaju; UNIQUE po tenderu.
11. Uspješnost: win rate po broju i vrijednosti tačan na fiksnom skupu; „vrijednost u toku“ isključuje terminalne statuse.
12. Konverzija: prenosi `contract_value_cents` iz odobrene revizije, predmjer 1:1, faze, relevantne obaveze, reference priloga, predloženi tim; druga konverzija → `ALREADY_CONVERTED`; djelimična konverzija nemoguća (transakcija se rollback-uje na grešci).
13. Pristup: ACCOUNTANT vidi vrijednost i ishod, ne kalkulaciju ni maržu; PM ne odobrava cijenu iznad praga.
14. Izolacija: firma B ne vidi tendere, checkliste, garancije, ishode firme A.

Van opsega: e-tender integracije sa portalima (CJN/ARHIV), automatsko preuzimanje tendera, dražbe/licitacije, viševalutna konverzija sa kursnom listom, PDF generator ponude kao fajl (izvoz iz štampe se rješava u Modulu 12 — izvještaji).
