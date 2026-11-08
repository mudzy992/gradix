# PLAN R2 — radnici, mašine, rokovi

**Datum:** 2026-11-08 · **Status:** nacrt za vlasnikov pregled, **čeka odobrenje** · **Rezovi:** R2a, R2b

**Redoslijed rada:** `packages/contracts` (gotovo, `1ff1cd3`) → **ovaj plan na odobrenje** → dizajn
samo onoga što referenca ne pokriva → kod R2a → kapija → kod R2b. **Kod R2 ne počinje prije
odobrenja plana.**

**Ispravka redoslijeda:** po `MASTER_BRIEF.md` (B11) R2 su **radnici i mašine** (R2a) i
**univerzalna obaveza s rokom** (R2b). **Projekti i dodjele su R3** (`docs/PLAN-R3.md`).

**Vlasnikove odluke od 2026-11-08 koje su ugrađene u ovaj tekst:** kategorije mašina su podaci po
firmi (ne `enum`), brojilo mašine je samo trenutna vrijednost, radnik može postojati bez naloga.

---

## 1. Model podataka

### 1.1 `workers` — radnici

| Kolona | Tip | Napomena |
|---|---|---|
| `id`, `company_id`, `created_at`, `updated_at` | standard | RLS `tenant_isolation` |
| `first_name`, `last_name` | `TEXT NOT NULL` | trim, prvo veliko slovo pri upisu |
| `phone`, `email` | `TEXT NULL` | kontakt, ne jedinstven — dva brata mogu dijeliti broj |
| `job_title` | `TEXT NULL` | zanimanje, slobodan tekst |
| `engagement` | `TEXT NOT NULL DEFAULT 'PERMANENT'` | `CHECK IN ('PERMANENT','FIXED_TERM','SEASONAL','CONTRACT')` |
| `hired_at` | `DATE NOT NULL` | poslovni datum u zoni firme |
| `ended_at` | `DATE NULL` | `CHECK (ended_at IS NULL OR ended_at >= hired_at)` |
| `team`, `supervisor_id` | `TEXT NULL` | `supervisor_id` → `workers(id)` iste firme (kompozitni FK) |
| `user_id` | `TEXT NULL UNIQUE` | **opciona veza na nalog** (vidi §1.5) |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | radnik se deaktivira, ne briše |

**Ne postoje kolone** za JMBG, adresu, bankovni račun, broj lične karte (vidi §8). Kad se budu
uvede (R7+, uz odluku o dozvoli i auditu), dolaze u **zasebnu tabelu** `worker_sensitive` sa
zasebnom dozvolom — nikad kao kolone koje uvoz može slučajno popuniti.

### 1.2 `equipment_categories` — kategorije mašina su podaci, ne `enum`

```
equipment_categories
  id            TEXT PK
  company_id    TEXT NOT NULL → companies(id) ON DELETE CASCADE
  code          TEXT NOT NULL              -- 'EXCAVATOR', 'TRUCK' …; kratko, stabilno
  name          TEXT NOT NULL              -- 'Bager', 'Kamion' …; mijenja se slobodno
  meter         TEXT NOT NULL              -- CHECK IN ('HOURS','KM') — zadana vrsta brojila
  is_active     BOOLEAN NOT NULL DEFAULT true
  sort_order    INT NOT NULL DEFAULT 0
  UNIQUE (company_id, code)
  UNIQUE (company_id, id)                  -- meta kompozitnih FK-ova
```

**Seed na kreiranju firme** (vlasnikova lista, 13 stavki): Bager, Utovarivač, Valjak, Buldožer,
Grejder, Finišer, Kamion, Damper, Kompresor, Agregat, Prikolica, Putničko vozilo, Ostalo — sa
zadanim brojilom (`HOURS` za mašine, `KM` za kamion/damper/prikolicu/putničko, `HOURS` za
kompresor/agregat). Seed je u migraciji (funkcija `seed_equipment_categories(company_id)`) i
poziva se i za postojeće firme, da demo firma ne ostane bez kategorija.

**Uvoz mapira tekst na `code`/`name`** (bez obzira na velika/mala slova, bez dijakritike).
Nepoznata kategorija **ne stvara se tiho** — red ide u pregled grešaka sa porukom
„nepoznata kategorija: ‚Tegljač‘; dodajte je u Postavke → Kategorije mašina ili ispravite kolonu“.
Kategorija se može dodati iz samog pregleda (jedan klik, uz potvrdu) — svjesna radnja, ne nuspojava.

### 1.3 `machines` — mašine i vozila u jednoj tabeli

Postojeća tabela iz R0 (`id`, `company_id`, `code`, `name`, `UNIQUE (company_id, code)`, RLS) se
**proširuje**:

| Kolona | Tip | Napomena |
|---|---|---|
| `category_id` | `TEXT NOT NULL` → `equipment_categories(company_id, id)` | kompozitni FK: kategorija iste firme |
| `make`, `model`, `serial_no`, `plate` | `TEXT NULL` | `plate` = registarska oznaka (vozila); nije obavezna — neregistrovana mašina postoji |
| `year` | `INT NULL` | `CHECK (year BETWEEN 1950 AND extract(year from now())+1)` |
| `ownership` | `TEXT NOT NULL DEFAULT 'OWN'` | `CHECK IN ('OWN','RENT')` |
| `meter` | `TEXT NOT NULL DEFAULT 'HOURS'` | `CHECK IN ('HOURS','KM')`; pri kreiranju se **predlaže** iz kategorije, može se promijeniti |
| `meter_value` | `NUMERIC(12,1) NULL` | **samo trenutna vrijednost** brojila (§4) |
| `meter_updated_at` | `TIMESTAMPTZ NULL` | kad je vrijednost zadnji put unesena |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `UNIQUE (company_id, id)` | | meta kompozitnih FK-ova |

**Vozila i mašine su jedna tabela** jer im je razlika samo `meter` (`KM`/`HOURS`) i kategorija;
dvije tabele bi značile duple forme, duple uvozе i dva izvora za isti pregled. Registracija i
tehnički pregled **nisu kolone** — to su obaveze (§5), pa istek ne zavisi od toga da li je neko
upisao datum u dvije tabele.

### 1.4 `obligations` i prateće tabele

Vidi §5 (model i obrazloženje izbora). Tabele: `obligation_types`, `obligations`,
`obligation_versions`, `obligation_attachments`, `reminders`.

### 1.5 Radnik i korisnički nalog — veza je opciona

- **Radnik postoji bez naloga.** Nalog nije uslov za evidenciju; većina radnika u pilotu neće
  imati nalog.
- **Nalog postoji bez radnika.** ADMIN ili računovođa nije radnik na gradilištu.
- `workers.user_id` je `NULL` do trenutka kad **administrator** (dozvola `users.manage`) veže
  radnika za nalog: `/ured/radnici/{id}` → „Poveži sa nalogom“ → bira se iz liste aktivnih osoba.
- **Jedan nalog = najviše jedan radnik** (`UNIQUE (user_id)`), jedan radnik = najviše jedan nalog.
- **Odziv nije automatski:** deaktivacija naloga **ne** deaktivira radnika (radnik može biti na
  bolovanju ili otići kod drugog poslodavca, a nalog se gasi iz drugog razloga). Deaktivacija
  radnika ne dira nalog. Veza se raskida izričito („Odveži“), uz zapis u auditu.
- **Veza ne daje dozvole.** Radnik sa nalogom vidi „Moje“ ekrane; role i opseg se dodjeljuju
  odvojeno (R1) i veza ih ne mijenja. Veza ne daje pristup platnim podacima.
- Uvoz **nikad ne kreira naloge**; kolona sa emailom ostaje kontakt, ne pozivnica.

---

## 2. Uvoz iz Excela (`/ured/uvoz`)

### 2.1 Koraci

1. **Datoteka** — prevlačenje ili izbor. `.xlsx` (prvi list) ili `.csv` (UTF-8, `,` ili `;`).
   Ekran odmah pokazuje: koliko redova, koji list, prvih 5 redova.
2. **Mapiranje kolona** — sistem predlaže mapiranje po zaglavlju (srpski/bosanski nazivi,
   bez dijakritike), korisnik potvrđuje i mijenja po koloni. Obavezno polje koje nije mapirano
   blokira „Dalje“ sa imenom polja.
3. **Pregled** — tabela **po redu** sa ishodom: `uvezi` / `preskoči` (već postoji) / `greška`
   (razlog) / `mogući duplikat` (razlog). Filter „samo problemi“. Red sa greškom **ne blokira**
   ostale; korisnik može isključiti pojedini red ili cijeli uvoz odustati.
4. **Potvrda** — jedan `POST` koji piše sve prihvaćene redove (§2.3) i vraća izvještaj.

### 2.2 Ograničenja i pravila po tipu

| Pravilo | Vrijednost |
|---|---|
| Veličina fajla | 5 MB |
| Broj redova | 5.000 po uvozu; preko toga se traži da se razdvoji |
| Listovi | samo prvi; ostali se ignorišu i **prijave** („ignorisano 2 lista“) |
| Zaglavlje | prvi red; prazno zaglavlje = greška cijelog fajla |
| Trajanje | 10 s budžet za pregled 5.000 redova; preko toga se uvoz odbija sa uputom |
| Sirovi fajl | **ne čuva se** — parsira se u memoriji, ne ostaje ni u MinIO ni na disku |
| Datumi | pravi `Date` (Excel serijski broj se konvertuje); `dd.mm.yyyy`, `yyyy-mm-dd`; tekst koji nije datum = greška reda |
| Brojevi | `1.234,5` i `1234.5` se prihvataju za brojilo; `,` i `.` kao decimalni znak se rješavaju po lokalu zaglavlja |
| Nepoznate kolone | ignorišu se **uz prijavu** („kolona ‚JMBG‘ nije podržana i nije uvezena“) — ne prave grešku reda |

**Mašine — ključ je inventarska oznaka (`code`)**

- `code` obavezan, normalize se (trim, velika slova, bez razmaka na krajevima).
- Postoji u firmi → zadano **preskoči i prijavi** („red 42: BG-01 već postoji“).
- Ažuriranje postojeće mašine je **izričit izbor po redu** u pregledu (padajući izbor
  „preskoči / ažuriraj“), nikad automatski i nikad „za sve redove“ jednim klikom.
- Dvije iste oznake **u istom fajlu** → drugi red je greška („BG-01 se pojavljuje i u redu 42“).

**Radnici — bez automatskog spajanja**

- Ne postoji siguran ključ (ime nije jedinstveno, telefon se dijeli). Zato se **ne spaja ništa**.
- **Mogući duplikat** se prijavljuje kad se poklopi ime i prezime (bez obzira na velika/mala
  slova i dijakritiku) **ili** telefon (normalizovan na cifre). Korisnik po redu bira:
  „uvezi kao novog“ (zadano) / „preskoči“ / „ažuriraj taj zapis“ (tek ako je izabrao).
- Isto ime bez drugih poklapanja **nije** duplikat — prijavljuje se samo kao informacija.

**Rokovi (obaveze)** — isti tok; `code` tipa obaveze iz šifarnika, entitet po oznaci mašine ili
imenu radnika; nerazriješen entitet = greška reda (ne tiho preskakanje).

### 2.3 Transakcija i idempotentnost

- **Pregled ne piše ništa** (`POST /api/imports/preview` je čist: parsira, validira, vraća redove
  i `importToken` — potpisan, kratkotrajan, nosi hash fajla i izabrano mapiranje).
- **Potvrda piše u jednoj transakciji** (`withCompany`): svi prihvaćeni redovi ili nijedan.
  Ako bilo koji red padne na bazi (npr. `UNIQUE` zbog istovremenog unosa), cijela transakcija se
  poništava i korisnik dobija „nijedan red nije uvezen; red 17 je u međuvremenu dodat“.
- **Ponovni uvoz istog fajla je bezopasan:** mašine se preskaču po `code`, radnici se prijavljuju
  kao mogući duplikati (i zadano preskaču ako korisnik tako izabere). Nijedan red se ne udvostručuje
  tiho.
- **Audit:** jedan zapis `import.applied` po uvozu sa `{ kind, fileName, rows, imported, skipped,
  failed, token }` — **bez imena, telefona i emailova** u `metadata`.
- Limit: 5.000 redova × 1 transakcija je prihvatljivo; ako mjerenje pokaže preko 3 s, uvoz se
  dijeli na serije po 500 unutar iste transakcije (ne mijenja ugovor prema korisniku).

### 2.4 Izvještaj o uvozu

Ekran poslije potvrde i stavka u auditu:

```
Uvezeno 87 · Preskočeno 12 · Greške 3 · Mogući duplikati 4
  red 12  greška     datum početka nije datum: "31.02.2025."
  red 42  preskočeno BG-01 već postoji (ažuriranje nije izabrano)
  red 51  duplikat   "Amina Karić" — isti telefon kao red 8
Preuzmi izvještaj (.csv)   Novi uvoz
```

### 2.5 API

`POST /api/imports/preview` · `POST /api/imports/apply` · `GET /api/workers` ·
`POST/PATCH /api/workers` · `GET /api/equipment` · `POST/PATCH /api/equipment` ·
`GET/POST/PATCH /api/equipment-categories` · `POST /api/workers/{id}/link-user` (veza sa nalogom).

---

## 3. Obaveze — model

### 3.1 Zašto `nullable` FK kolone, a ne `entity_type` + `entity_id`

```
obligations
  id, company_id, type_id → obligation_types(company_id, id),
  number, issuer, issued_at, expires_at, responsible_user_id,
  note, superseded_by → obligations(id), created_at, updated_at, created_by
  worker_id    → workers(company_id, id)    NULL
  machine_id   → machines(company_id, id)   NULL
  project_id   → projects(company_id, id)   NULL   -- kolona postoji, koristi se od R3
  scope_company BOOLEAN NOT NULL DEFAULT false      -- obaveza same firme
  CHECK (num_nonnulls(worker_id, machine_id, project_id) + scope_company::int = 1)
```

1. **Baza garantuje da entitet postoji.** Sa `entity_id TEXT` nema FK, pa obaveza može pokazivati
   na obrisanog radnika; greška se otkrije tek na ekranu. Sa FK-om brisanje radnika sa obavezama
   pada (`ON DELETE RESTRICT`) — i to je ispravno: radnik sa ljekarskim se deaktivira, ne briše.
2. **Ista firma je garantovana dvostruko.** `obligations.company_id` ima RLS `tenant_isolation`
   (isti obrazac kao `machines`). FK sam ne nosi firmu, pa je veza **kompozitni FK** na
   `(company_id, id)`; za to `workers`, `machines`, `projects` i `equipment_categories` imaju
   `UNIQUE (company_id, id)`. Time obaveza firme A **ne može** pokazivati na radnika firme B, čak
   i ako se RLS zaobiđe (BYPASSRLS nalog, Definer funkcija). RLS ostaje druga linija, ne jedina.
3. **Tipiziranost u kodu.** Servis dobija `worker_id: string | null`, ne `entityType: string`;
   pogrešno uparivanje ne prolazi kompajler.

**Cijena:** nova vrsta entiteta = nova kolona + `CHECK` (migracija). Prihvatam: entiteta je malo
(radnik, mašina, projekat, firma). Ako u R5/R9 entiteta postane mnogo (ture, gorivo, dnevnik),
prelazak na `entity_type` je jedna migracija — tada će imati smisla, sada bi bila apstrakcija
bez potrebe.

### 3.2 Verzije obaveze

**Obaveza se ne prepisuje.** Obnova stvara **novu verziju**, stara ostaje u historiji (B5.4).

```
obligation_versions
  id, company_id, obligation_id → obligations(company_id, id) ON DELETE CASCADE
  version        INT NOT NULL
  number, issuer TEXT
  issued_at      DATE
  expires_at     DATE
  attachment_id  TEXT NULL → obligation_attachments(id)
  created_at     TIMESTAMPTZ, created_by TEXT
  UNIQUE (obligation_id, version)
```

- `obligations.expires_at` je **keš trenutne verzije** (da pregled rokova i indeks ne rade `JOIN`
  po svakom redu). Mijenja se **isključivo** triggerom kad se doda verzija — ruta ga ne može
  postaviti drugačije.
- „Obnovi“ = `POST /api/obligations/{id}/renew` sa novim datumima i prilogom → `version + 1`,
  stara verzija ostaje; audit `obligation.renewed` sa `from`, `to`, `version`.
- „Ispravi grešku u unosu“ (npr. pogrešan datum, ista verzija) je **dozvoljeno u prvih 24 h** i
  bilježi se kao `obligation.corrected` sa starom i novom vrijednošću; poslije toga samo nova
  verzija. Bez ovoga bi svaka greška u kucanju pravila novu verziju i historija bi bila šum.

### 3.3 Tipovi obaveza su podaci

```
obligation_types
  id, company_id, code TEXT, label TEXT,
  entity_kind TEXT CHECK IN ('WORKER','MACHINE','PROJECT','COMPANY'),
  default_reminder_days INT[] NOT NULL DEFAULT '{60,30,15,7}',
  requires_attachment BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  UNIQUE (company_id, code), UNIQUE (company_id, id)
```

- Seed po firmi (iz B5.4): radnik — ljekarski, obuka ZNR, rad na visini, iskop, skučen prostor,
  ovlaštenje za mašinu, vozačka dozvola, prva pomoć; mašina/vozilo — registracija, tehnički
  pregled, osiguranje, tahograf/kalibracija, atest dizalice, vatrogasni aparat, garancija; firma —
  registracija, licence, certifikati, osiguranja, potvrde; projekat — dozvole (koristi se od R3).
- **Firma dodaje i mijenja tipove** bez migracije (naziv, pragovi, obavezan prilog). Ne može
  obrisati tip koji ima obaveze — može ga deaktivirati.
- Pragovi su **po tipu**, ne globalni: ljekarski 60/30/15/7, registracija 30/15/7.

### 3.4 Računanje isteka

**Stanje se ne čuva kao kolona** — izvedeno je iz `expires_at` i pragova tipa, u jednom mjestu:

```
stanje = 'expired'      ako expires_at < danas
       = 'expiring'     ako expires_at - najveći prag ≤ danas    (uskoro istječe)
       = 'valid'        inače
       = 'superseded'   ako postoji novija verzija (stara)
       = 'no_expiry'    ako expires_at IS NULL  (npr. garancija bez roka)
```

- Računa se **SQL funkcijom** `obligation_state(expires_at, thresholds, today)` da baza i
  aplikacija daju isti odgovor, i u jednoj TS funkciji `obligationState()` za ekrane i testove.
  Test poređenja: isti ulazi → isti izlaz u obje (jedan test, tabela slučajeva).
- **„Danas“ je poslovni datum firme** (`companies.timezone`, npr. `Europe/Sarajevo`), ne UTC —
  inače obaveza koja istječe danas izgleda istekla u 22 h. Računa se na granici dana u zoni firme.
- **Indeks** za pregled: `(company_id, expires_at)` na `obligations`; filter po stanju ide preko
  izraza, pa se za „uskoro istječe“ koristi `expires_at <= danas + max_prag` (indeks radi).
- Verzija se ne računa kao „najnovija po `created_at`“ nego po `version` — dva unosa u istoj
  sekundi ne mijenjaju red.

### 3.5 Pragovi i podsjetnici

| Kanal | R2 | Napomena |
|---|---|---|
| U aplikaciji | **da** | traka „Rokovi“, broj na početnoj, oznaka na kartici entiteta |
| Email | **ne** | traži provajdera i šablone; nije u R2 |
| Push | **ne** | isto |

- `reminders` je tabela **stanja podsjetnika u aplikaciji**: `obligation_id`, `version`,
  `threshold_days`, `due_at` (poslovni datum), `acknowledged_at`, `acknowledged_by`.
  Red se stvara kad obaveza uđe u prag (izračunato pri čitanju), a **ne** cron poslom.
- **`apps/worker` nije potreban u R2.** „Rokovi“ su `SELECT` sa indeksom; stanje se računa
  upitom. Pozadinski posao treba tek kad podsjetnik mora **izaći iz aplikacije** (email/push) ili
  kad neko mora dobiti obavještenje bez prijave — to je kasniji rez, ne R2.
- Ako se u R2b pokaže da je upit preko 200 ms na realnom broju obaveza, rješenje je
  **materialized view osvježen pri upisu**, ne worker.

---

## 4. Brojilo mašine — samo trenutna vrijednost

- `machines.meter_value` + `meter_updated_at`: zadnja poznata vrijednost, unosi se ručno (ured)
  ili pri uvozu. **Historija očitanja je R5** (radni sati, ture, gorivo) — R2 ne pravi tabelu
  očitanja i ne računa razliku između dva stanja.
- Unos je **jednosmjeran u R2**: nova vrijednost mora biti ≥ postojeće, osim izričitog
  „ispravka“ (dozvola `equipment.manage`) koji se bilježi u auditu sa starom i novom vrijednošću.
  Bez ovoga bi greška u kucanju (12345 umjesto 1234) trajno pokvarila brojilo.
- Promjena `meter` (HOURS↔KM) je dozvoljena samo dok `meter_value IS NULL`; poslije toga traži
  potvrdu i bilježi se u auditu. Miješanje sati i kilometara u istoj koloni nema smisla.
- Uvoz **ne dira** `meter_value` osim ako je kolona mapirana i red je nov (ili je izabrano
  ažuriranje). Nikad ne prepisuje vrijednost tiho.

---

## 5. Prilozi

### 5.1 Provjera tipa po sadržaju, ne po ekstenziji

| Dozvoljeno | Kako se prepoznaje |
|---|---|
| PDF | `%PDF-` na početku |
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| WebP | `RIFF….WEBP` |
| HEIC/HEIF | `ftypheic`/`ftypmif1` u prvih 32 B |

- Ekstenzija se **ne vjeruje**; `content_type` iz zahtjeva se **ne vjeruje**. Stvarni tip se
  određuje iz prvih 32 bajta i upisuje u bazu; ako se ne poklapa sa dozvoljenim, upload se odbija
  sa „datoteka nije PDF ni slika“.
- **Veličina:** najviše **10 MB** po prilogu, najviše **5 priloga** po obavezi.
- Ime fajla se čisti (bez putanje, bez kontrolnih znakova, najviše 200 znakova) i služi samo za
  prikaz; u objektu je UUID.
- `sha256` se računa pri uploadu i čuva; isti fajl dvaput na istoj obavezi se odbija
  („taj prilog je već dodan“).

### 5.2 Potpisani URL-ovi, bez javnog pristupa

- Upload: klijent traži `POST /api/obligations/{id}/attachments` → server vrati **potpisan PUT**
  (traje 5 min) i **id** priloga u stanju `pending`. Poslije uploada `POST …/attachments/{aid}/confirm`
  provjerava da objekat postoji, da mu veličina i tip odgovaraju prijavljenim, i tek tada prilog
  postaje `ready` (i vidljiv u obavezama).
- Download: `GET …/attachments/{aid}/url` → potpisan GET na **60 s**, uz provjeru da je prilog iz
  **iste firme** i da korisnik ima dozvolu. Nema trajnih javnih linkova, nema listing bucketa.
- Neuspjeli upload (prekinut) se čisti: objekti u `pending` stariji od 1 h se brišu pri sljedećem
  uploadu (bez workera — čisti se u istom zahtjevu, ograničeno na 20 objekata).

### 5.3 Bucket i prefiks za v2

- **Bucket `gradix-v2`**, prefiks unutar njega **`gx2/`** — po ADR 0006. v1 zadržava `gradix`.
- Putanja objekta: **`gx2/{companyId}/obligations/{obligationId}/{attachmentId}`** — tenant je u
  putanji, pa se politika bucketa i životni ciklus mogu vezati po firmi. Datum u putanji
  (`yyyy/mm`) iz ADR-a se **ne koristi** ovdje: prilog pripada obavezi, a ne mjesecu, i lakše se
  briše kad se obaveza briše.
- **Bucket `gradix-v2` još ne postoji na serveru.** ADR 0006 kaže: dok ne postoji, v2 ne piše
  priloge. Zato je R2b kapija sa dva uslova: (1) bucket i politika postoje, (2) `MINIO_*`
  varijable su postavljene. Do tada prilozi rade **lokalno** (MinIO iz compose) i QA prolazi, a
  produkcijski upload je isključen sa jasnom porukom — a ne tihom greškom.
- Prilozi su u R2b; R2a ih ne koristi.

---

## 6. Mobilni dio — preporuka: čitanje

**R2 na mobilnom je „Moji rokovi“ + popis mašina, samo čitanje.** Razlog: R2 nema radne sate ni
ture, pa mobilni ne bi imao šta da **upiše** osim podataka koje ured već unosi. Pisanje na terenu
dolazi u R4/R5 (radni dan, brojilo, dnevni pregled) — tada se gradi offline red i sinhronizacija,
koja već postoji kao `sync_items` u R0.

| Ekran | Sadržaj | Offline |
|---|---|---|
| **Moji rokovi** | obaveze gdje je `responsible_user_id = ja` **ili** je radnik vezan za moj nalog; sortirano po `expires_at`; oznaka stanja (isteklo / uskoro / važeće) | zadnji preuzet spisak + „od prije X sati“ |
| **Detalj obaveze** | broj, izdavalac, datum isteka, stanje, prilog (PDF u sistemskom pregledniku preko potpisanog URL-a) | bez priloga offline |
| **Mašine** | popis sa oznakom, kategorijom, brojilom; detalj mašine sa njenim obavezama i stanjem | zadnji preuzet spisak |
| **Mašina — detalj** | samo čitanje; unos brojila **nije** u R2 | — |

- Mete ≥ 56 dp, jedna velika primarna akcija („Osvježi“), mono vrijeme, iste boje i teme.
- Bez uploada priloga s telefona u R2 (kamera i offline upload su R5).
- Ako vlasnik želi unos brojila na terenu već u R2, to je **dodatak plana** i traži offline red;
  ne ulazi bez izričite odluke.

---

## 7. Kapije R2a i R2b

### Kapija R2a — radnici i mašine

Vlasnik prolazi uživo, na demo firmi:

1. Uveze svoj stvarni Excel sa radnicima (≥ 20 redova) — vidi greške po redu, ispravi fajl i uveze.
2. Ponovi isti uvoz — nijedan red se ne udvostruči; izvještaj pokaže preskočeno.
3. Uveze mašine sa ponovljenom oznakom — vidi preskočeno, ne duplikat.
4. Doda mašinu ručno, promijeni kategoriju, upiše brojilo; pokuša manju vrijednost — dobije
   „ispravka?“ umjesto tihog prepisivanja.
5. Poveže radnika sa nalogom i odveže ga; provjeri da nalog nije dobio nikakve dozvole time.
6. Druga firma ne vidi nijednog radnika ni mašinu (provjera izolacije na živom sistemu).

### Kapija R2b — rokovi

1. Unese obavezu radniku (ljekarski) sa rokom za 20 dana i pragovima 60/30/15/7 — stanje „važeće“;
   sa rokom za 5 dana — „uskoro istječe“; sa rokom juče — „isteklo“.
2. Obnovi obavezu — stara verzija ostaje vidljiva, nova nosi novi rok; broj verzija se vidi.
3. Otvori „Rokove“, filtrira po stanju i tipu, broj na početnoj se poklapa sa listom.
4. Doda PDF prilog, pa proba `.exe` preimenovan u `.pdf` — odbijeno; potpisani link istekne.
5. Vidi svoje rokove na telefonu (osvježi, pa avionski režim — spisak ostaje).
6. Vlasnik potvrdi da se stanje računa po **danu u zoni firme** (obaveza koja istječe danas nije
   „istekla“ u 22 h).

**Zeleni CI nije dokaz** — kapija je prolaz uživo.

---

## 8. Izričito van R2

| Šta | Zašto ne sada |
|---|---|
| **Blokade dodjele** („radnik bez ovlaštenja ne može na mašinu“) | traže dodjele radnika mašinama i projekte — **R3**, pa radne sate — R5. U R2 se samo prikazuje stanje obaveze. |
| **Satnica, koeficijent, obračun** | R6/R7; traži istoriju važenja i računovođu. |
| **Historija brojila** (očitanja, razlika, prosjek) | **R5** — radni sati i ture. R2 ima samo trenutnu vrijednost. |
| **JMBG, bankovni račun, adresa radnika** | vlasnička odluka: ne u R2a. Dolaze s dozvolom i auditom, u zasebnoj tabeli. |
| **Email i push podsjetnici** | traže provajdera, šablone i `apps/worker`. |
| **Projekti, dodjele, opseg `PROJECTS`, `projects.assign`** | **R3** (`docs/PLAN-R3.md`). |
| **Radni dan, ture, gorivo, kvarovi, dnevni pregled** | R4/R5. |
| **Prilozi kao dokumenti projekta** | R3 — R2 prilog postoji samo uz obavezu. |
| **Uvoz sa više listova, mapiranje pamćenjem po firmi** | prvi rez; ako vlasnik traži, dodaje se kao jedno polje (`import_profiles`). |

---

## 9. Privatnost

- **U R2a se ne unose JMBG, adresa ni bankovni račun.** Ne postoje kao kolone, pa ne mogu ni
  slučajno ući kroz uvoz; nepodržane kolone se prijavljuju i ignorišu (§2.2).
- **Svi seed i test podaci su sintetički**, u rezervisanim domenima (`*.test`, `example.*`,
  `@demo.ba`); telefoni iz opsega za fikciju. U repou nema stvarnih ličnih podataka.
- **CI provjera postoji** (`infra/scripts/check-privacy.mjs`, korak prije testova): JMBG po
  kontrolnoj cifri, polja ličnih podataka u kodu, strani emailovi — sa samoprovjerom da pravilo
  pada na stvarni podatak.
- Prilozi obaveza mogu sadržati lične podatke (ljekarski nalaz!). Zato: potpisani URL-ovi,
  dozvola `obligations.view`, audit svakog **pregleda** priloga (ne samo uploada), i poruka na
  ekranu da je nalaz osjetljiv. Auditu pristupa treba jedan zapis po downloadu.

---

## 10. Testovi (spisak onoga što mora pasti ako se pokvari)

- Izolacija: `workers`, `equipment_categories`, `machines`, `obligation_types`, `obligations`,
  `obligation_versions`, `obligation_attachments`, `reminders` → `TENANT_TABLES`.
- Kompozitni FK: obaveza firme A sa radnikom firme B → **odbijeno na nivou baze** (direktan SQL,
  mimo aplikacije).
- `CHECK`: obaveza bez entiteta i sa dva entiteta → odbijeno. `ended_at < hired_at` → odbijeno.
- `UNIQUE (user_id)`: dva radnika vezana za isti nalog → odbijeno.
- Kategorija iz druge firme → odbijena kompozitnim FK-om.
- Stanje obaveze: tabela slučajeva (danas, prag, istek, bez roka, zamijenjena) — SQL funkcija i TS
  funkcija daju isto; provjera na granici dana u zoni `Europe/Sarajevo`.
- Verzije: obnova diže `version`, stara ostaje, `expires_at` na obavezi prati trigger; ispravka
  poslije 24 h je odbijena.
- Uvoz: prazno obavezno polje, tekst u datumu, duplikat `code` u fajlu, nepoznata kategorija
  (prijavljena, **ne** kreirana), `ended_at < hired_at`, preko 5.000 redova, preko 5 MB, drugi
  list prijavljen; preview ne piše ništa (broj redova u bazi nepromijenjen); ponovni uvoz ne
  duplira; greška na bazi ruši cijelu transakciju.
- Prilozi: `.exe` preimenovan u `.pdf` odbijen; 10 MB + 1 bajt odbijen; 6. prilog odbijen; istekli
  potpisani URL odbijen; prilog druge firme odbijen; `pending` stariji od 1 h očišćen.
- Brojilo: manja vrijednost odbijena osim ispravke; promjena `meter` poslije unosa traži potvrdu.

---

## 11. Otvoreno za vlasnika

1. **Excel primjeri** — radnici, mašine, rokovi. Kolone koje očekujem:
   - Radnici: ime, prezime, telefon, email, zanimanje, angažman, datum početka, datum kraja,
     ekipa, nadređeni.
   - Mašine/vozila: inventarska oznaka, naziv, kategorija (tekst), marka, model, godina, serijski
     broj, registarska oznaka, vlasništvo, brojilo (sati/km), trenutna vrijednost brojila.
   - Rokovi: tip obaveze, entitet (radnik/mašina), broj isprave, izdavalac, datum izdavanja, datum
     isteka.
2. **Bucket `gradix-v2`** — treba li ga kreirati prije R2b (kapija §5.3) ili prilozi ostaju
   lokalni do R5?
3. **Unos brojila na telefonu** — ostaje van R2 (§6) ili želite već sada?
