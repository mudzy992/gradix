# 06 — Projekti, faze, budžet i knjiženje troškova

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.2, B15.2, B15.13 · **Modul:** 6 od 11
**Zavisi od:** Modul 1 (postavke firme, notifikacije, `attachment-service`, audit), Modul 3 (radni dani + `day_kind`), Modul 4 (satnice radnika), Modul 5 (trošak mašine, ture, gorivo, servis), Modul 7 (obračun sati — isti izvor sati)

Postojeće stanje (ostaje): `projects` (`code`, `name`, `status` `PLANNED|ACTIVE|PAUSED|FINISHED|CANCELLED`, `site_*`, `starts_on`/`ends_on`, `manager_worker_id`, `note`), `project_assignments` (radnik **ili** mašina, period, anti-overlap triger), `project_assignment_overrides` (iznimka/zahtjev), `project_cost_entries` (samo `MACHINE_WORK_LOG`, sati × ravna stopa), `bookProjectCosts()` (ručno pokretanje), obaveze sa `entity_kind='PROJECT'`, `dashboard-aggregates` (jedan broj troška po firmi), lista + dijalog u `/ured/projekti`.

**Dijagnoza:** projekat je kartica gradilišta, ne finansijski kontejner. Nema budžeta, faza, predmjera, aneksa, zadataka, troška rada, goriva, tura ni servisa. Cilj B1.3.4 („stvarni trošak naspram budžeta u svakom trenutku“) nije mjerljiv, a B15.2/B15.13 (predmjer, prognoza) nemaju nosilac u modelu.

---

## 1. Poslovna pravila

### 1.1 Faze i napredak
1. `project_phases`: `code`, `name`, `sort_order`, `planned_start`, `planned_end`, `actual_start`, `actual_end`, `progress_pct` (0–100), `weight` (int ≥ 1), `status` (`PLANNED|ACTIVE|DONE|CANCELLED`).
2. **Ukupni napredak projekta** = `Σ(phase.progress_pct × phase.weight) / Σ(weight)`, računa se, ne čuva. Faza bez težine nema smisla — `weight` je obavezan, default 1.
3. Dionica/stacionaža (Modul 5 `route_segments`) i predmjer (1.4) vezuju se na `phase_id` → količine po fazi.
4. `phase_dependencies` (`phase_id`, `depends_on_phase_id`, `kind` `START_AFTER_FINISH`): pomjeranje `planned_start` prije završetka zavisne faze daje **upozorenje sa razlogom**, nikad tihu blokadu. Bez Gantt motora.
5. Radni sati, mašinski sati i troškovi nose `phase_id` (nullable) — ko nema fazu, ide na projekat.

### 1.2 Budžet sa revizijama
6. `cost_categories` je **podatak po firmi**, ne enum. Početni set pri onboardingu: `RAD`, `MEHANIZACIJA`, `GORIVO`, `MATERIJAL`, `PODIZVOĐAČI`, `TRANSPORT`, `OSTALO`. Firma dodaje svoje.
7. `project_budget_lines`: `project_id`, `phase_id` (nullable = projekat), `category_id`, `amount_cents`, `currency_code`, `revision`, `valid_from`, `note`. **Budžet se nikad ne prepisuje** — promjena je nova revizija; stara ostaje čitljiva.
8. Aktivna revizija = najviša `revision` sa `valid_from <= danas`. Svaki trošak se poredi sa budžetom revizije **koja je važila na dan troška** (historijska usporedivost).
9. `projects.contract_value_cents` + odobreni aneksi (§1.5) = **vrijednost sa aneksima**. Rezerva (contingency) je vlastita kategorija, nikad skriveni dodatak na budžet.

### 1.3 Jedan ledger troškova
10. **Jedna tabela** `cost_entries` zamjenjuje `project_cost_entries`: `project_id`, `phase_id`, `category_id`, `source_type`, `source_id`, `occurred_on`, `amount_cents`, `currency_code`, `quantity`, `unit`, `rate_snapshot JSONB`, `status`, `reversed_by`, `note`, `booked_by`, `booked_at`.
11. `source_type`: `WORKDAY`, `MACHINE_WORK_LOG`, `FUEL_ENTRY`, `HAUL`, `SERVICE_ORDER`, `PURCHASE`, `SUBCONTRACTOR`, `MANUAL`.
12. **Idempotencija:** djelimični unikat `(company_id, source_type, source_id) WHERE status <> 'REVERSED'`. Jedan događaj = jedan trošak; ponovni prolaz ne duplira, a stornirani zapis dozvoljava novi.
13. **Automatsko knjiženje na promjenu statusa** (nema ručnog dugmeta):
    - `WORKDAY` — na `FOREMAN_CONFIRMED`/`LOCKED`: `sati rada (bez BREAK, bez izostanaka) × satnica radnika važeća na dan rada`;
    - `MACHINE_WORK_LOG` — na `WORK` režim: sati × snapshot stope (Modul 5 §1.1);
    - `FUEL_ENTRY` — iznos goriva, ili `PENDING` dok iznos nije poznat (D1);
    - `HAUL` — `quantity × unit_price` kad postoji, inače `PENDING` sa količinom;
    - `SERVICE_ORDER` — trošak servisa (Modul 8);
    - `PURCHASE`, `SUBCONTRACTOR` — iz nabavke/podizvođača (Modul 10), po pojavi modula.
14. **Kategorija po izvoru:** `cost_categories.default_for_source_type` (unique po firmi, nullable); firma prepisuje mapiranje, izvor bez mapiranja ide na `OSTALO`.
15. **`PENDING`** = trošak postoji, cijena još ne. Vidi se kao „nepoznato“ i **ne ulazi u zbroj** kao nula; na budžetskom pregledu se prikazuje broj i iznos `PENDING` zapisa odvojeno.
16. **Storno, ne brisanje:** korekcija = original `REVERSED` + novi `POSTED` red sa `note` (obavezan razlog). Nijedan trošak nema fizičko brisanje (`DELETE` grant ne postoji, kao i do sada).
17. `occurred_on` = datum događaja (dan rada, dan točenja), `booked_at` = kad je knjiženo. Izvještaji po periodu koriste `occurred_on`; tehnički `booked_at`.

### 1.4 Predmjer i završenost
18. `project_boq_items`: `phase_id`, `code`, `description`, `unit`, `quantity_planned`, `unit_price_cents`, `quantity_executed`, `sort_order`. Klasičan predmjer; izvedene količine dolaze iz tura/stacionaža (Modul 5) ili ručno.
19. **`progress_source` po projektu** (`MANUAL` | `BOQ`): `MANUAL` = % po fazi ručno; `BOQ` = `Σ(quantity_executed × unit_price) / Σ(quantity_planned × unit_price)` po fazi. **Nikad oba miješano** u istom projektu.
20. Predmjer je osnov **konverzije tendera** (Modul sa tenderima): ponuda → projekat nosi predmjer, ne prepisuje se ručno.

### 1.5 Aneksi
21. `project_amendments`: `code`, `title`, `kind` (`SCOPE|TIME|PRICE|OTHER`), `amount_cents`, `extension_days`, `status` (`DRAFT|SUBMITTED|APPROVED|REJECTED`), `approved_at`, `approved_by`, `document`. Samo `APPROVED` mijenja vrijednost i rok.
22. Aneks koji mijenja vrijednost **ne mijenja budžet automatski** — budžet je odluka (nova revizija), aneks je ugovor. UI nudi „predloži novu reviziju“ iz aneksa.

### 1.6 Zadaci
23. `project_tasks`: `project_id`, `phase_id`, `title`, `description`, `assignee_worker_id`, `assignee_user_id`, `due_on`, `priority` (`LOW|NORMAL|HIGH|URGENT`), `status` (`OPEN|IN_PROGRESS|BLOCKED|DONE|CANCELLED`), `created_by`, `completed_at`.
24. `task_comments` + prilozi preko `attachment-service` (Modul 1). Zadatak može imati **jednog** izvršioca-čovjeka (radnik ili nalog), bez timova.
25. Šef vidi „moji zadaci danas“ i „kasne“ na mobilnom (B5.12) i u dnevnom pregledu.

### 1.7 Upozorenja na prag
26. Pragovi `80%` i `100%` po kategoriji i ukupno, na aktivnu reviziju budžeta. Kad se pređe → notifikacija `PROJECT_MANAGER` + `OWNER` (Modul 1, in-app obavezno).
27. **`budget_alert_events` sa `dedupe_key`** (`project:revision:scope:threshold`) — jedno upozorenje po pragu po reviziji, ne na svaki novi trošak. Upozorenje ostaje vidljivo na projektu dok se ne riješi (nova revizija ili storno troška).
28. Pregled: **top 5 rizičnih projekata** (negativna marža ili prekoračen budžet) za OWNER/ADMIN; PM vidi svoj opseg.

### 1.8 Profitabilnost i zatvaranje
29. **Marža** = `vrijednost sa aneksima − Σ POSTED trošak` (po kategoriji i ukupno). `PENDING` se prikazuje kao rizik, ne u marži.
30. **EAC** = `POSTED trošak do sada / ostvareni % završenosti`; **jasno označeno kao procjena** (`kind=EAC_ESTIMATE`), nikad uknjiženo. Ako je `progress_pct = 0`, EAC se ne prikazuje (nema dijeljenja nulom).
31. **`FINISHED` pokreće kontrolnu listu:** sve dodjele zatvorene, otvoreni zastoji riješeni, otvorene obaveze arhivirane, nema `PENDING` troškova (ili eksplicitno prihvaćeni uz razlog). Rezultat se zamrzava u `project_close_snapshots` (trošak po kategoriji, marža, količine, % završenosti).
32. Nakon `FINISHED` **knjiženje je blokirano**. Ponovno otvaranje je eksplicitna akcija sa razlogom, auditom i novim `close_snapshot` pri sledećem zatvaranju.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `projects` | `+ contract_value_cents BIGINT`, `+ currency_code`, `+ progress_source ('MANUAL'\|'BOQ') DEFAULT 'MANUAL'`, `+ closed_at`, `+ closed_by` |
| `project_phases` (novo) | `id, company_id, project_id, code, name, sort_order, weight, planned_start, planned_end, actual_start, actual_end, progress_pct, status`; unique `(company_id, project_id, code)` |
| `phase_dependencies` (novo) | `id, company_id, phase_id, depends_on_phase_id, kind`; `CHECK (phase_id <> depends_on_phase_id)` |
| `cost_categories` (novo) | `id, company_id, code, name, sort_order, default_for_source_type NULL, is_active`; unique `(company_id, code)` i `(company_id, default_for_source_type) WHERE default_for_source_type IS NOT NULL` |
| `project_budget_lines` (novo) | `id, company_id, project_id, phase_id NULL, category_id, amount_cents, currency_code, revision, valid_from, note, created_by`; unique `(company_id, project_id, phase_id, category_id, revision)` |
| `cost_entries` (novo, zamjena `project_cost_entries`) | vidi §1.3; djelimični unikat `(company_id, source_type, source_id) WHERE status <> 'REVERSED'`; `machine_id` **nullable** |
| `project_boq_items` (novo) | `id, company_id, project_id, phase_id NULL, code, description, unit, quantity_planned NUMERIC(14,3), unit_price_cents, quantity_executed NUMERIC(14,3) DEFAULT 0, sort_order` |
| `project_amendments` (novo) | vidi §1.5; `CHECK (status='APPROVED') = (approved_at IS NOT NULL)` |
| `project_tasks` (novo) | vidi §1.6 |
| `task_comments` (novo) | `id, company_id, task_id, author_id, body, created_at` |
| `budget_alert_events` (novo) | `id, company_id, project_id, revision, scope ('TOTAL'\|kategorija), threshold_pct, fired_at, resolved_at`, unique `dedupe_key` |
| `project_close_snapshots` (novo) | `id, company_id, project_id, closed_at, closed_by, payload JSONB` |
| `workdays` / `machine_work_logs` / `hauls` | `+ phase_id NULL` (FK na `project_phases`) |

Migracija `project_cost_entries` → `cost_entries`: prenos redova (`source_type='MACHINE_WORK_LOG'`, `status='POSTED'`, `occurred_on` iz `booked_at` u lokalnom danu, `category_id` = `MEHANIZACIJA`), zatim drop stare tabele. `bookProjectCosts()` prestaje postojati — knjiženje je događajno.

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight (kao Moduli 1–5).

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/projects/:id/phases` | `projects.view` / `projects.manage` |
| GET/PUT | `/api/projects/:id/progress` (manual % po fazi) | `projects.manage` |
| GET/POST | `/api/cost-categories` | `projects.costs.view` / `projects.costs.manage` |
| GET/POST | `/api/projects/:id/budget` (+`?revision=`) | `projects.costs.view` / `projects.budget.manage` |
| GET | `/api/projects/:id/costs?from&to&category&phase` | `projects.costs.view` |
| POST | `/api/costs/manual` | `projects.costs.book` |
| POST | `/api/costs/:id/reverse` | `projects.costs.book` |
| GET/POST/PATCH | `/api/projects/:id/boq` | `projects.costs.view` / `projects.manage` |
| GET/POST/PATCH | `/api/projects/:id/amendments` (+`/:id/approve`) | `projects.view` / `projects.manage` |
| GET/POST/PATCH | `/api/tasks` (+`/:id/comments`) | `projects.view` / `projects.manage` |
| GET | `/api/projects/:id/profitability` (marža + EAC, označeno kao procjena) | `projects.costs.view` |
| POST | `/api/projects/:id/close` (+`/:id/reopen`) | `projects.manage` |
| GET | `/api/dashboard/risky-projects` | `dashboard.view` |

Nove dozvole: `projects.budget.manage`, `projects.costs.manage`; `projects.costs.book` ostaje za ručni unos/storno.
Novi kodovi: `BUDGET_REVISION_CONFLICT`, `PROJECT_CLOSED`, `COST_ALREADY_POSTED`, `COST_REVERSAL_REASON_REQUIRED`, `PHASE_WEIGHT_REQUIRED`, `PROJECT_CLOSE_CHECKLIST_INCOMPLETE`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/projekti` | lista sa **maržom i % završenosti** (ne samo kod/naziv), filter „rizični“ |
| `/ured/projekti/[id]` | tabovi: **Pregled** (napredak po fazama, budžet vs stvarno, marža, EAC), **Troškovi** (ledger sa filterima, `PENDING` odvojeno, storno), **Budžet** (revizije, po kategoriji/fazi), **Predmjer**, **Aneksi**, **Zadaci**, **Dodjele**, **Obaveze** |
| `/ured/projekti/[id]/troskovi` | drill-down: trošak → izvorni zapis (dan rada / sat mašine / točenje / tura) |
| `/ured/postavke/kategorije-troska` | šifarnik kategorija + mapiranje izvora |
| `/ured/zadaci` | svi zadaci: moji, kasne, po projektu; komentari i prilozi |
| `/pregled` | top 5 rizičnih projekata + broj `PENDING` troškova |
| mobilno (šef) | „moji zadaci danas“, brzi unos troška sa gradilišta (kategorija + iznos + fotografija računa) |

Zatvaranje projekta = jedan dijalog sa kontrolnom listom (zelena/crvena stavka), razlogom za ponovno otvaranje i auditom.

---

## 5. Testovi

1. Napredak: `Σ(progress × weight)/Σweight` tačan na fiksnom skupu faza; promjena težine mijenja ukupni %.
2. Zavisnost faza: pomjeranje `planned_start` prije zavisne faze daje upozorenje, ne blokadu.
3. Budžet: revizija 2 ne mijenja troškove iz perioda revizije 1; trošak se poredi sa revizijom važećom na `occurred_on`.
4. Idempotencija: dva prolaza istog `source_type+source_id` → jedan red; storno pa ponovno knjiženje → dozvoljeno.
5. Automatsko knjiženje: `FOREMAN_CONFIRMED` radni dan knjiži `sati × satnica na dan rada` bez ručne akcije; `BREAK` i izostanci ne ulaze.
6. `PENDING`: gorivo bez iznosa ne ulazi u zbroj kao 0; vidi se odvojeno; nakon unosa iznosa prelazi u `POSTED` jednom.
7. Storno: original ostaje `REVERSED`, novi `POSTED` nosi razlog; dupli storno odbijen.
8. Kategorija: izvor bez mapiranja ide na `OSTALO`; promjena mapiranja ne mijenja postojeće troškove.
9. Predmjer: `progress_source='BOQ'` računa % iz količina; `MANUAL` ignoriše količine.
10. Aneks: samo `APPROVED` mijenja vrijednost; `DRAFT` ne dira maržu.
11. Prag: prelazak 80% i 100% šalje **jedno** upozorenje po pragu po reviziji; nova revizija resetuje.
12. Zatvaranje: `FINISHED` sa otvorenom dodjelom/`PENDING` troškom odbija zatvaranje uz kod; zatvoren projekat odbija novo knjiženje; reopen uz razlog prolazi i piše audit.
13. EAC: `progress_pct=0` ne prikazuje EAC; oznaka „procjena“ prisutna u API-ju i UI-u.
14. Izolacija: firma B ne vidi budžet, troškove, predmjer, zadatke firme A.

Van opsega: situacije/avansne fakture prema naručiocu, Gantt sa resursima, viševalutno knjiženje sa kursnom listom, ugovori i fakturisanje kupca (B15), nabavka i podizvođači kao moduli (Modul 10 – trošak ulazi kroz `PURCHASE`/`SUBCONTRACTOR` kad modul postoji).
