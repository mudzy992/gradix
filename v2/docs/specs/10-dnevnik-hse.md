# 10 — Dnevnik građenja i HSE

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.10, B15.7, B15.16 · **Modul:** 10 od 11
**Zavisi od:** Modul 1 (`attachment-service`, notifikacije, audit, postavke), Modul 2 (obaveze — `HSE_REPORT`, `HSE_PLAN`, certifikati), Modul 3 (`workdays`/`work_entries`, sync obrazac), Modul 4 (radnici), Modul 5 (`machine_work_logs`, `hauls`, `machine_faults`), Modul 6 (`project_boq_items`, `project_amendments`)

Postojeće stanje: **ništa od B5.10 ne postoji.** `grep dnevnik` → samo `/ured/dnevni-pregled` (pregled mašine, Modul 5). `grep incident|ltifr|toolbox` → 3 pogotka, svi `HSE_PLAN` kao **obaveza s rokom** (Modul 2). Obuke (`SAFETY_TRAINING`, `WORK_AT_HEIGHT`, `FIRST_AID`) postoje kao obaveze koje prate **važenje**, ne kao evidencija **održanih obuka**. Sync pokriva 7 entiteta (Modul 3); HSE nije među njima.

**Dijagnoza:** modul sa najvećim pravnim rizikom u cijelom sistemu je neimplementiran. Dnevnik građenja je zakonski dokument izvođača sa propisanim sadržajem; prijava incidenta je dokaz savesnog postupanja. Oba moraju raditi offline, kod čovjeka sa rukavicama, u nekoliko dodira.

---

## 1. Poslovna pravila

### 1.1 Dnevnik građenja: jedan dan, jedan zapis
1. `site_diaries` sa statusima `DRAFT → SIGNED → LOCKED`. **Unique `(company_id, project_id, diary_date)`** — jedan dan po projektu, bez duplikata po šefu.
2. **Automatsko punjenje** (sistem, ne prepisivanje): radnici i sati iz `workdays`/`work_entries` (Modul 3), mašine i sati iz `machine_work_logs`, ture i količine iz `hauls`, kvarovi i zastoji iz `machine_faults`. **Ručno se unosi samo ono što sistem ne zna:** vrijeme, opis izvedenih radova, posjetioci, posebni događaji, zastoji.
3. Vremenski uslovi: `weather` (`CLEAR|CLOUDY|RAIN|SNOW|WIND|FROST|HEAT`), `temperature_c`, `worked_hours`. Ručni unos u MVP-u; polje za izvor ostaje za kasniju integraciju.
4. **Zastoji (`delays`):** `kind` (`RAIN|SNOW|WIND|FROST|SUBCONTRACTOR|MATERIAL|PERMIT|OTHER`), `from`, `to`, `hours`, `note`. Zbir po periodu je **dokaz za produženje roka** i može se vezati na `TIME` aneks (Modul 6 `project_amendments.extension_days`).
5. `SIGNED`: potpis šefa — `signed_by_worker_id`, `signed_name`, `signed_at`, audit. `LOCKED`: nema izmjene; ispravka ide kroz `site_diary_revisions` sa razlogom (≥10 znakova), isti obrazac kao `workday_revisions`.
6. Prilozi (fotografije, zapisnici, vremenska stanica) preko `attachment-service`.

### 1.2 Količine: jedan izvor završenosti
7. `site_diary_items` (`boq_item_id NULL`, `description`, `unit`, `quantity`, `source ('MANUAL'|'HAUL'|'BOQ')`).
8. `source='BOQ'` → unos **direktno ažurira `project_boq_items.quantity_executed`** (Modul 6). Dnevnik je mjesto gdje se količina stvarno zna; % završenosti projekta ne dolazi iz dva mjesta.
9. `source='HAUL'` → količina je izvedena iz tura (Modul 5), samo se potvrđuje — bez dvostrukog unosa.
10. Zbir dnevnih količina po stavci predmjera = `quantity_executed`; ručna korekcija traži razlog i piše reviziju.

### 1.3 HSE: prijava → istraga → mjere → zatvaranje
11. `hse_incidents`: `kind` (`ACCIDENT|NEAR_MISS|PROPERTY_DAMAGE|ENVIRONMENTAL|OCCUPATIONAL_ILLNESS`), `severity` (`MINOR|MODERATE|SEVERE|FATAL`), `occurred_at`, `location_text`, `lat`/`lng` NULL, `description`, `immediate_action`, `reporter_worker_id`, `injured_worker_id NULL`, `lost_days`, `reportable_to_authority`, `authority_reported_at`, `status` (`REPORTED|INVESTIGATING|ACTIONS_OPEN|CLOSED`).
12. **`NEAR_MISS` je ravnopravna kategorija**, ne „manji incident“ — najkorisniji preventivni signal i ne smije se izgubiti u statistici.
13. **Prijava je offline-first** (mobilno): tekst + fotografije + lokacija; sync kad se vrati veza, upload fotografija se nastavlja (isti obrazac kao `machine_daily_checks`).
14. `hse_investigation` (`incident_id`, `root_cause`, `method` `FIVE_WHY|FISHBONE|OTHER`, `findings`, `investigator_user_id`, `completed_at`).
15. **Jedna tabela mjera:** `hse_actions` (`incident_id NULL`, `inspection_id NULL`, `description`, `responsible_worker_id`, `due_on`, `status` `OPEN|DONE|CANCELLED`, `done_at`, `evidence_attachment_id`). `OVERDUE` se **računa** (`due_on < danas AND status='OPEN'`), ne čuva. Mjera bez roka ili bez odgovornog se odbija.
16. `reportable_to_authority=true` **automatski stvara obavezu s rokom** (Modul 2, `entity_kind='COMPANY'`, tip `HSE_REPORT`, podsjetnici `3,1`) — nema paralelnog rok-mehanizma.
17. **Incident ne blokira ništa** — evidentira. Blokada mašine/radnika ide kroz postojeće mehanizme (Modul 5 kvar, Modul 2 obaveze).

### 1.4 Obuke i toolbox razgovori
18. `hse_trainings`: `kind` (`INDUCTION|TOOLBOX|TASK_INSTRUCTION|CERTIFICATION|DRILL`), `title`, `held_at`, `held_by_worker_id`, `location`, `duration_minutes`, `project_id`, `topic`, `notes`.
19. `hse_training_attendees`: `worker_id`, `signed_at`, `signature_name`. **Prisustvo je potpis, ne checkbox.**
20. **Brzi unos toolbox razgovora** (30 sekundi na telefonu): tema (bira se sa liste ili 3 riječi), prisutni (označavanje ekipe jednim dodirom), trajanje. Bez tipkanja eseja.
21. **Razlika prema Modulu 2/4:** `obligation` prati **važenje** certifikata; `hse_trainings` evidentira **održanu obuku**. Certifikacijska obuka može jednim klikom obnoviti/zatvoriti obavezu (uz prilog potvrde).
22. Potpis u MVP-u = `ime + signed_at + audit` (bez kvalifikovanog elektronskog potpisa — B15.16, van opsega).

### 1.5 Inspekcije
23. `hse_inspections`: `kind` (`INTERNAL|EXTERNAL|AUTHORITY`), `authority_name`, `inspected_at`, `inspector_name`, `summary`, `result` (`PASS|MINOR_FINDINGS|MAJOR_FINDINGS|PROHIBITION`), `report_attachment_id`.
24. Nalazi inspekcije su `hse_actions` sa `inspection_id` (jedna tabela, §15) — isti rok i odgovornost kao mjere iz incidenta.
25. **`PROHIBITION`** (zabrana rada) → odmah notifikacija OWNER-u + vidljivo na Pregledu do zatvaranja.

### 1.6 Statistika (izračun, ne tabela)
26. Broj incidenata po težini/projektu/mjesecu; `NEAR_MISS` prikazan odvojeno.
27. **LTIFR** = `(ozljede sa izgubljenim danima × 1 000 000) / odrađeni sati` — sati iz Modula 3, formula i jedinica u domeni sa testom.
28. **Izgubljeni dani** (`lost_days`) po incidentu i ukupno; **stopa mjera na vrijeme** = `DONE` prije `due_on` / ukupno mjera.
29. Treninzi: toolbox razgovora po projektu mjesec, % radnika sa važećim obukama (veza na Modul 2).
30. Sve na `/ured/hse` i u PDF mjesečnom HSE izvještaju.

### 1.7 PDF dnevnik građenja
31. `site_diary_templates` **po firmi**: zaglavlje, obavezna polja, redoslijed sekcija, potpisne linije. Početni šablon odgovara uobičajenoj praksi (projekt, vrijeme, radnici, mašine, izvedeni radovi, događaji, zastoji, potpisi izvođača i nadzora).
32. Brief ostavlja šablon **otvorenim** (`[OTVORENO: potvrditi šablon]`). Zato: platforma daje konfigurabilan šablon, a konačni tekst potvrđuje vlasnik/pravnik prije puste. Do tada je izvoz označen **`DRAFT_FORMAT`** i ne tvrdi da je zakonski obrazac.
33. PDF sadrži: zaglavlje firme, projekt, datum, vrijeme, radnike sa satima, mašine sa satima, količine, događaje, zastoje, umanjene fotografije, potpis šefa, mjesto za potpis nadzora.

### 1.8 Offline i sukobi
34. Novi `entity_type` u `sync_conflicts` (obrazac Modula 3 §29): `site_diary`, `site_diary_item`, `hse_incident`, `hse_action`, `hse_training`.
35. **Konflikt na dnevniku** (dva šefa, isti dan): **spajanje po sekcijama** gdje su nezavisne (vrijeme, radovi, posjetioci), uz obavještenje obojici.
36. **Konflikt na incidentu je zabranjen:** incident je činjenica — drugi zapis se dodaje kao **dopuna** (`hse_incident_updates`), nikad prepisivanje.

---

## 2. Promjene na bazi

| Objekat | Promjena |
|---|---|
| `site_diaries` (novo) | vidi §1.1; unique `(company_id, project_id, diary_date)` |
| `site_diary_items` (novo) | vidi §1.2/7 |
| `site_diary_revisions` (novo) | `id, company_id, diary_id, base_version, reason, author_id, payload JSONB, created_at` |
| `site_diary_templates` (novo) | `id, company_id, name, header JSONB, sections JSONB, is_default, is_active` |
| `hse_incidents` (novo) | vidi §1.3/11 |
| `hse_incident_updates` (novo) | `id, company_id, incident_id, author_id, body, created_at` (dopuna, nikad prepisivanje) |
| `hse_investigation` (novo) | vidi §1.3/14; unique po incidentu |
| `hse_actions` (novo) | vidi §1.3/15; `CHECK ((incident_id IS NOT NULL) <> (inspection_id IS NOT NULL) OR (incident_id IS NOT NULL AND inspection_id IS NOT NULL))` → najmanje jedan izvor |
| `hse_trainings` (novo) | vidi §1.4/18 |
| `hse_training_attendees` (novo) | vidi §1.4/19; unique `(company_id, training_id, worker_id)` |
| `hse_inspections` (novo) | vidi §1.5/23 |
| `site_diary_attachments` (novo) | mirror `machine_daily_check_attachments` (`pending`/`confirmed`) |
| `hse_attachments` (novo) | isto, za incidente/inspekcije/treninze |
| `obligation_types` | `+ HSE_REPORT` (`entity_kind='COMPANY'`, `{3,1}`, `requires_attachment=false`) |
| `project_boq_items` | `quantity_executed` se ažurira iz `site_diary_items` (bez promjene kolone) |
| `sync_conflicts` | `entity_type` proširen na 5 novih vrijednosti |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + preflight. Nijedan `DELETE` grant.

---

## 3. API ugovor

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST/PATCH | `/api/site-diaries` (+`?project&date`) | `diary.view` / `diary.manage` |
| POST | `/api/site-diaries/:id/sign` / `/lock` | `diary.sign` |
| GET | `/api/site-diaries/:id/pdf` | `diary.view` |
| GET/POST/PATCH | `/api/site-diary-templates` | `diary.manage` |
| GET/POST/PATCH | `/api/hse/incidents` (+`/:id/updates`) | `hse.view` / `hse.report` |
| PUT | `/api/hse/incidents/:id/investigation` | `hse.investigate` |
| POST | `/api/hse/incidents/:id/close` | `hse.investigate` |
| GET/POST/PATCH | `/api/hse/actions` | `hse.view` / `hse.investigate` |
| GET/POST | `/api/hse/trainings` (+`/:id/attendees`) | `hse.training.view` / `.manage` |
| GET/POST/PATCH | `/api/hse/inspections` | `hse.view` / `hse.investigate` |
| GET | `/api/hse/stats?from&to&project` | `hse.view` |
| GET | `/api/hse/report/pdf?from&to` | `hse.view` |

Nove dozvole: `diary.view` (OWNER/ADMIN/PM/SITE_SUPERVISOR), `diary.manage` (SITE_SUPERVISOR/PM/ADMIN), `diary.sign` (SITE_SUPERVISOR), `hse.view` (svi osim WORKER-a za tuđe; radnik vidi svoje prijave), `hse.report` (svi — prijava je pravo, ne privilegija), `hse.investigate` (OWNER/ADMIN/PM/SITE_SUPERVISOR), `hse.training.view` (OWNER/ADMIN/PM/SITE_SUPERVISOR), `hse.training.manage` (SITE_SUPERVISOR/ADMIN).
Novi kodovi: `DIARY_ALREADY_LOCKED`, `DIARY_SIGNATURE_REQUIRED`, `HSE_ACTION_RESPONSIBLE_REQUIRED`, `HSE_ACTION_DUE_REQUIRED`, `HSE_INCIDENT_IMMUTABLE`, `HSE_REPORT_OBLIGATION_REQUIRED`.

---

## 4. UI / UX

| Ekran | Sadržaj |
|---|---|
| `/ured/dnevnik` | kalendar/mjesec po projektu; dan sa statusom, vremenom, brojem radnika i mašina; „nepotpuni dani“ |
| `/ured/dnevnik/[id]` | formular: automatski popunjene sekcije (radnici, mašine, ture) + ručne (vrijeme, opis, količine, posjetioci, događaji, zastoji), prilozi, potpis, PDF |
| `/ured/hse` | incidenti (po težini/statusu), mjere koje kasne, inspekcije, treninzi, statistika (LTIFR, izgubljeni dani, % na vrijeme) |
| `/ured/hse/[id]` | incident: opis, fotografije, istraga, mjere sa rokovima, dopune, zatvaranje |
| `/ured/hse/inspekcije` | inspekcije + nalazi; `PROHIBITION` istaknut |
| `/ured/hse/obuke` | treninzi + prisustvo; obnova certifikata jednim klikom |
| mobilno `/dnevnik` | šef: današnji zapis, automatski podaci, unos zastoja i količina, potpis |
| mobilno `/hse/prijava` | **offline** prijava incidenta: tip, težina, opis, fotografije, lokacija |
| mobilno `/hse/toolbox` | 30-sekundni unos: tema + prisutni + trajanje |
| `/pregled` | mjere koje kasne, incidenti otvoreni, `PROHIBITION`, dnevnik bez potpisa stariji od 2 dana |

---

## 5. Testovi

1. Dnevnik: unique po projektu i danu; automatski popunjen radnicima/satima/mašinama/turama iz Modula 3/5; ručni unos ne prepisuje automatske sekcije.
2. Zaključavanje: `LOCKED` odbija izmjenu; ispravka kroz reviziju sa razlogom; `SIGNED` bez potpisa odbijen.
3. Zastoji: zbir sati po periodu tačan; veza na `TIME` aneks nosi `extension_days`.
4. Količine: `BOQ` stavka ažurira `quantity_executed` jednom; `HAUL` ne duplira; % završenosti u Modulu 6 odgovara zbiru.
5. Incident: `NEAR_MISS` se broji odvojeno; `reportable_to_authority` stvara `HSE_REPORT` obavezu sa `{3,1}`; dupli poziv ne stvara drugu obavezu.
6. Mjere: bez odgovornog ili roka odbijeno; `OVERDUE` se računa, ne čuva; mjera iz inspekcije i iz incidenta žive u istoj tabeli.
7. `PROHIBITION` → notifikacija OWNER-u i istaknuto na Pregledu.
8. Treninzi: prisustvo je potpis; dupli radnik u istom treningu odbijen; certifikacijska obuka obnavlja obavezu iz Modula 2.
9. Offline: prijava incidenta nastaje bez mreže, sinhronizuje se, fotografije se dovrše; dupli sync ne duplira incident.
10. Konflikt: dva šefa na istom dnevniku → spajanje po sekcijama; dva zapisa o istom incidentu → dopuna, nikad prepisivanje (`HSE_INCIDENT_IMMUTABLE`).
11. Statistika: LTIFR tačan na fiksnom skupu (ozljede × 1 000 000 / sati); % mjera na vrijeme tačan.
12. PDF: `DRAFT_FORMAT` oznaka prisutna dok šablon nije potvrđen; sadrži sve sekcije iz šablona firme.
13. Izolacija: firma B ne vidi dnevnike, incidente, mjere, treninge firme A.

Van opsega: kvalifikovani elektronski potpis (B15.16), integracija sa vremenskom stanicom/API-jem, automatska prijava inspekciji, OCR glasovne bilješke (B15.18).
