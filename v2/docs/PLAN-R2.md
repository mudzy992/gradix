# PLAN R2 — radnici, mašine, rokovi (ispravka redoslijeda)

**Datum:** 2026-11-08 · **Status:** nacrt za vlasnikov pregled · **Trajanje:** 2 reza (R2a, R2b)
**Ispravka:** projekti i dodjele **nisu** R2 — po `MASTER_BRIEF.md` (B11) oni su **R3**.
Ranija verzija ovog plana je pogrešno stavljala `projects` na prvo mjesto; to je povučeno.

**Prije koda:** `packages/contracts` (OpenAPI iz koda, tipizirani klijent, CI provjera da je
ugovor ažuran) → ovaj plan na odobrenje → dizajn samo onoga što referenca ne pokriva →
implementacija. Kod R2 ne počinje prije odobrenja plana.

## R2a — radnici i mašine (osnovna evidencija) + uvoz iz Excela

**Model** (nove migracije, RLS `tenant_isolation` na svakoj):

| Tabela | Ključna polja | Napomena |
|---|---|---|
| `workers` | `first_name`, `last_name`, `phone`, `email`, `job_title`, `engagement` (`PERMANENT`/`FIXED_TERM`/`SEASONAL`/`CONTRACT`), `hired_at`, `ended_at`, `team`, `supervisor_id`, `user_id` (nullable) | Radnik ≠ korisnik. JMBG, adresa i bankovni račun **ne ulaze** u R2 — traže zasebnu dozvolu i audit (B5.5), a trebaju tek za R10 obračun. |
| `machines` | `code` (BG-01), `name`, `category` (`EXCAVATOR`/`ROLLER`/`TRUCK`/`DUMPER`/…), `make`, `model`, `year`, `serial_no`, `plate`, `ownership` (`OWN`/`RENT`), `is_active`, `worker_id` (zaduženi rukovalac, nullable) | Vozilo je mašina sa `category=TRUCK`; posebna tabela tek ako se pokaže potreba (B5.8). |

**Uvoz iz Excela** (`/ured/uvoz`, tri koraka: datoteka → mapiranje kolona → pregled):

- Prihvata `.xlsx` i `.csv`; svaki red se validira **prije** upisa, ništa se ne upisuje dok
  korisnik ne potvrdi pregled.
- Pregled grešaka po redu i koloni: obavezna kolona prazna, datum nije datum, duplikat `code`
  ili `serial_no`, nepoznata kategorija. Redovi sa greškom se **preskaču**, ostali idu dalje.
- Idempotentno: ponovni uvoz istog fajla ne pravi duplikate (ključ `code` za mašine, `email` +
  `last_name` za radnike); ponuda „ažuriraj postojeće“ je izbor, ne pretpostavka.
- Ograničenja: 5.000 redova, 5 MB, samo prvi list. Sirovi fajl se **ne čuva** (nije prilog).
- Svaki uvoz piše jedan zapis u `audit_events` (ko, koliko redova, koliko odbijeno).

**API:** `GET/POST/PATCH /api/workers`, `GET/POST/PATCH /api/machines`,
`POST /api/imports/preview` (validacija bez upisa), `POST /api/imports/apply`.

**Ekrani:** lista radnika, profil radnika, lista mašina, profil mašine, uvoz sa pregledom grešaka.

## R2b — obaveza s rokom (jedan generički model) + prilozi + podsjetnici

**Jedan model za sve, ne tabela po tipu** (B5.4):

| Tabela | Polja |
|---|---|
| `obligation_types` | `code`, `label`, `entity_scope` (`WORKER`/`MACHINE`/`COMPANY`/`PROJECT`/…), `default_reminder_days[]` — firma proširuje sama |
| `obligations` | `type_id`, `entity_type`, `entity_id`, `number`, `issuer`, `issued_at`, `expires_at`, `responsible_user_id`, `status` (`VALID`/`EXPIRING`/`EXPIRED`/`REPLACED`), `replaces_id`, `note` |
| `obligation_attachments` | `obligation_id`, `object_key`, `file_name`, `content_type`, `size`, `sha256`, `uploaded_by` |
| `reminders` | `obligation_id`, `due_at`, `threshold_days`, `channel`, `sent_at`, `state` |

- **Veza je generička:** `entity_type` + `entity_id` uz `CHECK` na dozvoljene tipove i
  indeks `(company_id, entity_type, entity_id)`. Nijedna tabela po tipu entiteta.
- **Prilozi preko potpisanih URL-ova:** upload ide direktno u S3/MinIO sa kratkotrajnim
  potpisanim URL-om; download isto. U bazi samo `object_key` + `sha256`. Nema trajnih javnih
  linkova (B5.4). Provjera tipa po sadržaju, ne po ekstenziji.
- **Podsjetnici:** pragovi po tipu (60/30/15/7), kanal za sada **samo u aplikaciji** (email i
  push traže provajdera — odluka još nije donesena, vidi „Otvoreno“). Posao koji ih pravi ide u
  `apps/worker`, koji do sada ne postoji; ako ga pravimo u R2, to je prvi pozadinski posao.
- **Pregled „Rokovi“** (`/ured/rokovi`): sve obaveze firme, filter po tipu entiteta, tipu
  obaveze, statusu i vlasniku; sortirano po `expires_at`.

**Blokade** (B5.4) — u R2 se **ne uvode**. „Radnik bez ovlaštenja ne može na mašinu“ traži
dodjele, a dodjele su R3. Zapisujem kao stavku za R3/R5, ne pravim polje koje nigdje ne važi.

**Ekrani:** lista rokova sa filterima, detalj obaveze (sa prilozima), forma obaveze.

## Testovi koji moraju postojati

- Tenant izolacija za `workers`, `machines`, `obligations`, `obligation_attachments` — kroz
  **generisani** test iz liste tenant tabela (novi red u listi, ne novi test).
- Uvoz: 10 slučajeva grešaka (prazno obavezno polje, tekst u datumu, duplikat, nepoznata
  kategorija, prekoračen broj redova), idempotentnost ponovnog uvoza, i da neuspjeli uvoz ne
  ostavlja nijedan red.
- Generička veza: obaveza vezana za radnika i za mašinu prolazi isti kod; `entity_type` van
  liste se odbija.
- Rokovi: `EXPIRING` se računa iz pragova tipa; pregled filtrira po statusu.
- Prilozi: potpisani URL ističe, tuđi `object_key` se odbija.

## Ne ulazi u R2

Projekti, dodjele, opseg „dodijeljeni projekti“, dozvola `projects.assign` → **R3**.
Radni dan, ture, gorivo → R4/R5. Obračun sati i satnica → R6/R10. Blokade → R3/R5.

## Otvoreno za vlasnika

1. **Excel:** koje kolone stvarno postoje (spisak je u izvještaju); da li su datumi pravi datumi
   ili tekst; ima li vozila u istom listu kao mašine.
2. **Podsjetnici:** samo u aplikaciji u R2, ili odmah email (traži provajdera i tanki adapter po
   ranijoj odluci)?
3. **Duplikati pri uvozu:** ako `code` mašine već postoji — preskoči, ažuriraj, ili pitaj po redu?
