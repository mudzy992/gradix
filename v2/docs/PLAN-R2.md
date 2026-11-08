# PLAN R2 — radnici, mašine, rokovi

**Datum:** 2026-11-08 · **Status:** nacrt za vlasnikov pregled · **Trajanje:** 2 reza (R2a, R2b)

**Ispravka redoslijeda:** po `MASTER_BRIEF.md` (B11) R2 su **radnici i mašine** (R2a) i
**univerzalna obaveza s rokom** (R2b). **Projekti i dodjele su R3** (`docs/PLAN-R3.md`) —
ranija verzija ovog plana ih je pogrešno stavljala na prvo mjesto; to je povučeno.

**Redoslijed rada:** `packages/contracts` → ovaj plan na odobrenje → dizajn samo onoga što
referenca ne pokriva → kod. **Kod R2 ne počinje prije odobrenja plana.**

## R2a — radnici i mašine + uvoz iz Excela

### Model

| Tabela | Ključna polja | Napomena |
|---|---|---|
| `workers` | `first_name`, `last_name`, `phone`, `email`, `job_title`, `engagement` (`PERMANENT`/`FIXED_TERM`/`SEASONAL`/`CONTRACT`), `hired_at`, `ended_at`, `team`, `supervisor_id`, `user_id` (nullable), `created_at`, `updated_at` | Radnik ≠ korisnik. **JMBG, adresa i bankovni račun se NE unose** (vidi § Privatnost). |
| `machines` | `code`, `name`, `category`, `make`, `model`, `year`, `serial_no`, `plate`, `ownership` (`OWN`/`RENT`), `meter` (`HOURS`/`KM`), `is_active`, `operator_worker_id` (nullable) | **Vozila i mašine su jedna tabela**, kako je odlučeno: razlika je `category` + `meter` (sati ili kilometri). Registracija i tehnički pregled **nisu kolone** — to su obaveze (R2b). |

`machines` tabela već postoji iz R0 sa `code`, `name`, `company_id`, `UNIQUE (company_id, code)`
i RLS-om; R2 je **proširuje**, ne pravi novu. `workers` je nova.

### Uvoz iz Excela (`/ured/uvoz`)

Tri koraka: **datoteka → mapiranje kolona → pregled**. Ništa se ne upisuje dok korisnik ne
potvrdi pregled; redovi sa greškom se preskaču i prijavljuju, ostali idu dalje.

- Prihvata `.xlsx` i `.csv`; samo prvi list; 5.000 redova / 5 MB; sirovi fajl se ne čuva.
- **Mašine se prepoznaju po inventarskoj oznaci (`code`).** Zadano ponašanje: **preskoči i
  prijavi** („red 42: BG-01 već postoji“). Ažuriranje postojeće mašine je **izričit izbor po
  redu** u pregledu, nikad automatski.
- **Radnici se ne spajaju automatski.** Ne postoji ključ koji je siguran (ime nije jedinstveno),
  pa se prijavljuje mogući duplikat (isto ime i prezime, ili isti telefon) i korisnik odlučuje
  po redu: uvezi kao novog / preskoči / (ako je izabrao) ažuriraj taj zapis.
- Validacija po redu i koloni: obavezno polje prazno, datum nije datum, `meter`/`category` van
  liste, dvije mašine sa istim `code` u istom fajlu, `ended_at` prije `hired_at`.
- Svaki uvoz piše **jedan** zapis u `audit_events` (ko, šta, koliko primljeno / uvezeno /
  preskočeno / odbijeno) — bez ličnih podataka u `metadata`.

### API

`GET/POST/PATCH /api/workers` · `GET/POST/PATCH /api/machines` ·
`POST /api/imports/preview` (validacija bez upisa) · `POST /api/imports/apply`.

## R2b — obaveza s rokom

### Model obaveze: izbor i obrazloženje (tačka 4)

Tražena su dva kandidata. **Biram `nullable` FK kolone uz `CHECK` da je tačno jedna popunjena.**

```
obligations
  id, company_id, type_id → obligation_types(id), number, issuer,
  issued_at, expires_at, responsible_user_id, status, replaces_id, note
  worker_id  → workers(id)   NULL
  machine_id → machines(id)  NULL
  project_id → projects(id)  NULL     -- kolona postoji, koristi se od R3
  company_scope BOOLEAN               -- obaveza same firme (registracija, licence)
  CHECK (num_nonnulls(worker_id, machine_id, project_id) + company_scope::int = 1)
```

**Zašto FK kolone, a ne `entity_type` + `entity_id`:**

1. **Baza garantuje da entitet postoji.** Sa `entity_id TEXT` nema FK, pa obaveza može pokazivati
   na radnika koji je obrisan ili nikad nije postojao — i to se otkrije tek na ekranu. Sa FK-om
   brisanje radnika sa obavezama pada (`ON DELETE RESTRICT`), a to je ispravno: radnik sa
   ljekarskim pregledom se deaktivira, ne briše.
2. **Tenant je garantovan dvostruko.** `obligations.company_id` ima RLS politiku
   `tenant_isolation` (isti obrazac kao `machines`: `USING (company_id = current_setting('app.company_id', true))`).
   FK sam po sebi ne nosi firmu, pa se ista firma garantuje **kompozitnim FK-om**:
   `FOREIGN KEY (company_id, worker_id) REFERENCES workers (company_id, id)` — za to je na
   `workers`/`machines` potreban `UNIQUE (company_id, id)`. Time je nemoguće da obaveza firme A
   pokazuje na radnika firme B, čak i ako se RLS zaobiđe (npr. `BYPASSRLS` nalog ili Definer
   funkcija); RLS ostaje druga linija, ne jedina.
3. **Tipiziranost u kodu.** `resolveScope`/servisi dobijaju `worker_id: string | null` umjesto
   `entityType: string`, pa pogrešno uparivanje ne prolazi kompajler.

**Cijena:** nova vrsta entiteta = nova kolona + izmjena `CHECK`-a (migracija), dok bi
`entity_type` tražio samo novu vrijednost u `CHECK`-u. To je jedini stvarni nedostatak i
prihvatam ga: entiteta je malo (radnik, mašina, projekat, firma), a garancija integriteta je
važnija od brzine dodavanja. **Ako se u R5/R9 pokaže da entiteta ima mnogo** (ture, gorivo,
dnevnik, tender…), prelazak na `entity_type` + particionisani `entity_id` je jedna migracija i
tada će imati smisla; sada bi bio apstrakcija bez potrebe.

**RLS pokriva:** `obligations`, `obligation_types`, `obligation_attachments`, `reminders` —
svaka dobija `ENABLE`/`FORCE ROW LEVEL SECURITY` i politiku `tenant_isolation`, i svaka se
dodaje u `TENANT_TABLES` u `rbac.integration.test.ts`, pa je izolacija pokrivena **generisanim**
testom, ne novim testom po tabeli.

### Ostalo u R2b

| Tabela | Polja |
|---|---|
| `obligation_types` | `code`, `label`, `entity_kind` (`WORKER`/`MACHINE`/`PROJECT`/`COMPANY`), `default_reminder_days[]`, `is_active` — firma proširuje sama |
| `obligation_attachments` | `obligation_id`, `object_key`, `file_name`, `content_type`, `size`, `sha256`, `uploaded_by` |
| `reminders` | `obligation_id`, `due_at`, `threshold_days`, `channel`, `sent_at`, `state` |

- **Prilozi preko potpisanih URL-ova** (upload i download), u bazi samo `object_key` + `sha256`;
  nema trajnih javnih linkova; tip se provjerava po sadržaju, ne po ekstenziji.
- **Podsjetnici samo u aplikaciji** (vlasnikova odluka). Email i push traže provajdera — nisu u R2.
- **`apps/worker` u R2b nije potreban.** „Rokovi“ se računaju **upitom**:
  `status` je izvedena vrijednost iz `expires_at` i pragova tipa, a pregled je jedan `SELECT` sa
  filterima i indeksom `(company_id, expires_at)`. Pozadinski posao treba tek kad podsjetnik
  mora da **izađe iz aplikacije** (email/push) ili kad se stanje mora poslati bez prijavljenog
  korisnika — to je R2+ ili kasnije. Ne pravim `apps/worker` za posao koji upit rješava.

### Ekrani (dizajn samo onoga što referenca ne pokriva)

Referenca **nema**: formu profila mašine, listu rokova sa filterima, uvoz sa pregledom grešaka.
Za njih se prije koda dopunjuje `reference.html` (iste primitive: ploča, polje, tabela, chip,
poruka, `table.cards` ispod 640 px) — u istom commitu, kao i do sada.

## Testovi

- Tenant izolacija: `workers`, `obligations`, `obligation_types`, `obligation_attachments`,
  `reminders` → dodaju se u `TENANT_TABLES`; pokrivenost ide s liste.
- **Kompozitni FK:** obaveza firme A sa `worker_id` radnika firme B se **odbija na nivou baze**
  (test ide mimo aplikacije, direktnim SQL-om).
- `CHECK`: obaveza bez entiteta i obaveza sa dva entiteta se odbijaju.
- Uvoz: prazno obavezno polje, tekst u datumu, duplikat `code` u fajlu, nepoznata kategorija,
  `ended_at` prije `hired_at`, prekoračen broj redova; idempotentnost ponovnog uvoza mašina
  (preskoči, ne dupliraj); radnik bez automatskog spajanja (dvije iste osobe → prijava duplikata).
- Uvoz ne ostavlja ništa ako korisnik ne potvrdi pregled (test: preview pa odustajanje).
- Blokade iz B5.4 („radnik bez ovlaštenja ne može na mašinu“) **nisu** u R2 — traže dodjele (R3)
  i radne sate (R5).

## Privatnost

- **U R2a se ne unose JMBG, adresa ni bankovni račun.** Ne postoje kao kolone, pa ne mogu ni
  slučajno ući kroz uvoz; nepoznate kolone u Excelu se prijavljuju i ignorišu.
- **Svi seed i test podaci su sintetički.** Imena su izmišljena; telefoni su iz opsega za
  fikciju (`+387 00 …`), emailovi na `@demo.ba`. U repou nema stvarnih ličnih podataka.
- **CI provjera (izvodljivo, mali posao):** skripta koja prolazi kroz `docs/`, seedove i testove
  i pada na JMBG (13 cifara koje prolaze kontrolnu cifru) i na email adrese van `@demo.ba` /
  `@primjer.test` / `example.com`. Prag je „nema pogodaka“, bez izuzetaka u kodu. Dodaje se u
  CI kao korak prije testova; ako se pokaže da lažno pogađa (npr. broj mašine od 13 cifara),
  pravilo se sužava na polja koja se zovu `jmbg`/`licni_broj`.

## Ne ulazi u R2

Projekti, dodjele, opseg „dodijeljeni projekti“, dozvola `projects.assign` → **R3**.
Radni dan, ture, gorivo → R4/R5. Obračun sati i satnica → R6/R10. Blokade → R3/R5.
Email/push podsjetnici → kad bude provajder.

## Otvoreno za vlasnika

1. **Excel primjeri** — tačne kolone (spisak u izvještaju): radnici, mašine, rokovi; da li su
   datumi pravi datumi; ima li vozila u istom listu; ima li spojenih ćelija.
2. **`category` mašina** — da li se koristi vaša lista kategorija ili predložena
   (`EXCAVATOR`, `ROLLER`, `TRUCK`, `DUMPER`, `LOADER`, `OTHER`)? Ako imate svoju, dajte je.
