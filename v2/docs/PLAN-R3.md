# PLAN R3 — projekti i dodjele (+ opseg „dodijeljeni projekti")

**Datum:** 2026-11-09 · **Status:** plan odobren (*„možeš nastaviti dalje“*), kod i testovi gotovi,
čeka **kapiju uživo**
**Odakle:** `MASTER_BRIEF.md` B11 — R3 je „projekti i dodjele“.

## Odluke vlasnika (2026-11-09)

1. **Blokada dodjele** zbog istekle obaveze: dodjela se **odbija**, uz **evidentiranu iznimku** sa
   obaveznim razlogom i rokom. Iznimka ide u audit trag. Firma odlučuje koji tipovi blokiraju
   (`obligation_types.blocks_assignment`) — podatak, ne enum.
2. **Faze projekta ne u R3.** Fazu traži radni dan („projekat/faza/zadatak“), a to je R4.
3. **Mobilni u R3 je read-only**: „Moji projekti“ sa kešom, isti obrazac kao „Moji rokovi“.
4. **Projekte prave i mijenjaju OWNER i ADMIN** (`projects.manage`); PROJECT_MANAGER **dodjeljuje**
   (`projects.assign`).

## Ispravka u odnosu na raniju skicu

Skica je tražila `memberships.project_ids` (niz + FK na `projects`). To je **odbačeno**: niz ne
može nositi FK, period važenja ni historiju, a dodjela mašine se u njega ne može upisati nikako.
Umjesto toga je jedna tabela — `project_assignments(company_id, project_id, worker_id | machine_id,
from_date, to_date)`. Iz nje izlazi i opseg (`PROJECTS` = preko radnika vezanog za nalog) i tim
projekta, bez drugog izvora istine.

## Šta je urađeno

### Model (migracija `20261109120000_r3_projekti`)

- `projects` — tenant, RLS, jedinstvena šifra **po firmi**, status kao podatak sa `CHECK`-om
  (`PLANNED/ACTIVE/PAUSED/FINISHED/CANCELLED`), lokacija, period, rukovodilac (radnik iste firme).
- `project_assignments` — radnik **ili** mašina (`CHECK`, tačno jedno), period, `CHECK` da kraj nije
  prije početka. **Preklapanje** istog entiteta na istom projektu brani **triger** sa
  `pg_advisory_xact_lock` — namjerno, a ne `EXCLUDE USING gist`: to traži `btree_gist`, ekstenziju
  koju instalira nadzornik baze, pa bi migracija pala na produkciji, a ne u testu.
- `project_assignment_overrides` — iznimka sa razlogom (≥ 10 znakova) i rokom; FK na dodjelu i na
  obavezu.
- `obligations.project_id` — skida se `obligations_project_not_before_r3`, dodaje pravi FK i
  jedinstveni indeks „jedan aktivan tip po projektu“ (kao za radnika i mašinu).
- `memberships.scope` vraća `PROJECTS` u `CHECK`.
- `obligation_types.blocks_assignment` + **9 novih zadanih tipova za projekat** (građevinska
  dozvola 90/60/30/15, saglasnost, obustava saobraćaja, zauzeće površine, okolišna saglasnost,
  HSE elaborat, plan organizacije gradilišta, vanredni prijevoz, tehnički prijem). Postojeće firme
  ih dobijaju kroz `ON CONFLICT DO NOTHING`.

### Opseg

`resolveScope` u `@gradix/domain` ima treći slučaj, uz `visibleProjectIds` kao ulaz za `WHERE`:

| opseg | vidi | mijenja |
|---|---|---|
| `COMPANY` | sve u firmi | sve u firmi |
| `PROJECTS` | samo dodijeljene projekte i zapise vezane za njih | samo njih |
| `SELF` | samo svoje | samo svoje |

- **Tuđi projekat u istoj firmi = 403** („Nisi dodijeljen ovom projektu.“), **tuđa firma = 404**.
- **Opseg `PROJECTS` bez ijedne dodjele se odbija** pri snimanju članstva — opseg koji ne vidi
  ništa je zamka, ne podešavanje.
- **Skidanje ZADNJE dodjele takvoj osobi** ne smije je ostaviti sa opsegom koji ne vidi ništa.
  Opseg se zato **automatski spušta na `SELF`** (najuži, nikad širi), radnja ide u audit sa
  razlogom `last_project_assignment_removed`, a odgovor nosi `scopeNotice` koji ekran **obavezno**
  prikaže. Tiho gašenje vidnog polja je greška, ne detalj: čovjek bi se prijavio u prazan sistem i
  mislio da je pokvaren, a niko ne bi znao zašto od sutra vidi manje.
- Nepoznat opseg u bazi pada na `SELF` (najuži), nikad na `COMPANY` — nema tiho podignute dozvole.
- **Završetak G3:** `memberships.scope` novi red podrazumijevano dobija `SELF`; migracija mijenja samo DEFAULT i ne prepravlja postojeće opsege. Pozivnica i izmjena/dodjela role moraju poslati `scope` izričito (nema API ni DB podrazumijevanja na `COMPANY`). Dokaz: migracijski test sa postojećim `COMPANY` i `SELF` članom.

### Dozvole

| dozvola | OWNER | ADMIN | PROJECT_MANAGER | SITE_SUPERVISOR | ostali |
|---|---|---|---|---|---|
| `projects.view` | ✅ | ✅ | ✅ | ✅ | ✅ (radnik mora znati gdje je) |
| `projects.manage` | ✅ | ✅ | — | — | — |
| `projects.assign` | ✅ | ✅ | ✅ | — | — |
| `projects.override` | ✅ | ✅ | — | — | — |

| `obligations.view` | ✅ | ✅ | ✅ | ✅ | ✅ **samo `SELF`** za radnika i vozača (G3) |
| `obligations.attachments.view` | ✅ | ✅ | ✅ | ✅ | — (radnik NE vidi skenove) |

`projects.assign` je **odvojena** dozvola, ne dio `users.manage` — odluka vlasnika iz R1b.

**Radnik i rokovi (G3).** `WORKER`/`DRIVER` dobijaju `obligations.view`, ali opseg `SELF` drži
granicu na serveru: vidi obaveze vezane za svoj nalog, tuđe ne vidi ni uz `?workerId=`. Prilozi
(skenovi, ljekarski nalazi) su **posebna** dozvola `obligations.attachments.view` — radnik vidi tip,
rok i stanje, ne i dokument. Tuđi rok je 404, a ne 403. Detalji: ADR 0011.

**`projects.override` (dodato u pregledu R3).** Odobrenje iznimke je posebno pravo, samo vlasnik i
admin. Rukovodilac projekta (PM) ima `projects.assign`: dodjeljuje ljude svaki dan, ali iznimku —
„ovaj čovjek radi sa isteklom dokumentacijom" — **samo traži**. Bez te podjele bi pravilo iz B5.4
važilo samo protiv onoga ko se sam ne može izuzeti; ko dodjeljuje, taj bi ga gasio.

Tok je zato dvokoračan: PM pošalje **zahtjev** (razlog, entitet, period) na
`POST /api/projects/{id}/override-requests`; vlasnik/admin ga odobri na
`POST /api/projects/{id}/override-requests/{requestId}` uz **rok** koji određuje odobravalac.
Odobrenje u ISTOJ transakciji upisuje dodjelu i pretvara zahtjev u iznimku — nema stanja u kojem
iznimka postoji bez dodjele. Server provjerava dozvolu; UI je samo prikaz (bez prava se polja
iznimke ne nude, nudi se zahtjev). Test to tvrdi sa obje strane.

### API (9 novih ruta, OpenAPI 44 putanje)

`GET/POST /api/projects`, `GET/PATCH /api/projects/{id}`,
`GET/POST /api/projects/{id}/assignments`, `DELETE …/assignments/{assignmentId}`,
`GET/POST /api/projects/{id}/override-requests`, `POST …/override-requests/{requestId}`.
Obaveze: `projectId` u unosu i `?projectId=` u listi.

### Ekrani

- **`/ured/projekti`** — lista (šifra, stanje riječima, lokacija, tim, rokovi), filter po stanju,
  dijalog za novi/izmjenu, detalj sa dva taba: **Tim i mašine** (dodjele, skidanje, blokada PRIJE
  upisa sa poljem za razlog iznimke, ako osoba ima `projects.override`; bez njega dugme je
  „Pošalji zahtjev") i **Rokovi na projektu**.
- **`/ured/rokovi`** — projekat kao treći entitet u formi (uz radnika, mašinu, firmu).
- **`/pregled`** — kartica rokova (iz R2b) ostaje; projekti se vide kroz meni.
- **Mobilni `/projekti`** — „Moji projekti“, read-only, lokalni keš, „od prije X“, put nazad.

## Kapija R3 (uživo)

### R3a — projekti, dodjele, opseg

1. Otvoriti projekat, dodijeliti 3 radnika i mašinu; sve se vidi u detalju.
2. Pokušati dodijeliti istog radnika dvaput u istom periodu → odbijeno čitljivom porukom
   („… u periodu koji se preklapa“), ne SQL greškom.
3. Dati osobi opseg „dodijeljeni projekti“ sa jednim projektom; prijaviti se kao ona: vidi **samo**
   taj projekat, tuđi u istoj firmi daje **403**, firma B daje **404**.
4. Pokušati snimiti opseg `PROJECTS` osobi bez ijedne dodjele → **odbijeno**.
5. PROJECT_MANAGER dodjeljuje, ali ne mijenja role; SITE_SUPERVISOR vidi projekat, ne dodjeljuje.
6. Mašina sa isteklom registracijom ne može na projekat; **iznimka sa razlogom prolazi** i vidi se u
   auditu (`project.assignment_overridden`).
7. **Iznimku traži PM, odobrava vlasnik.** Kao PROJECT_MANAGER: pokušaj dodjele sa iznimkom →
   odbijeno (403); pošalji zahtjev → prolazi. Kao vlasnik: odobri uz rok → dodjela nastaje, a
   `project.assignment_overridden` je u auditu. PM koji pokuša odobriti svoj zahtjev → 403.
8. **Skidanje zadnje dodjele:** osobi sa opsegom „dodijeljeni projekti“ skini njen jedini projekat →
   ekran javlja da je opseg spušten na „samo svoje“, a u auditu stoji
   `last_project_assignment_removed`. Lista projekata za tu osobu je **prazna, ne greška**.

### R3b — projekti u rokovima

1. Građevinska dozvola na projektu: rok za 100 dana → „Važeće“, za 5 dana → „Uskoro istječe“,
   juče → „Isteklo“.
2. Rokovi filtrirani po projektu; broj na redu projekta se poklapa sa listom.
3. Mobilni: „Moji projekti“ u avionskom režimu prikazuje zadnje preuzeto.

**Zeleni CI nije dokaz** — kapija je prolaz uživo.

## Izričito van R3

| Šta | Zašto |
|---|---|
| **Budžet i troškovi projekta** | R6 — novac traži obračun sati; struktura bez iznosa je prazna forma. |
| **Faze projekta** | R4 — fazu traži radni dan, ne projekat (odluka vlasnika). |
| **Blokade tura i radnih sati** | R4/R5 — R3 blokira samo dodjelu. |
| **Kalendar zauzetosti mašina, Gantt** | R5/R6. |
| **Lokacije i dionice (stacionaža)** | R5. |
| **Dokumenti projekta kao zaseban modul** | Prilozi u R3 postoje samo uz obavezu; dokument bez roka je R9. |
