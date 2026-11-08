# PLAN R4 — radni dan, evidencija sa terena i sinhronizacija

**Status:** predlog, čeka odobrenje vlasnika. **Bez koda dok plan nije odobren.**
Ulazi: R3 zatvara dodjele i opseg. R4 uvodi prvi podatak koji **nastaje na telefonu**, pa uz njega
ide offline red i pravilo šta kad se dva telefona ne slažu.

## 1. Model radnog dana

`workdays` — jedan red po **osobi, danu i izvoru** (`source`: `WORKER` | `FOREMAN`).

| polje | napomena |
|---|---|
| `worker_id`, `work_date` | `UNIQUE (company_id, worker_id, work_date)` — jedan dan = jedan red |
| `started_at`, `ended_at` | stvarno vrijeme rada; `TIMESTAMPTZ` |
| `breaks` | pauze kao zasebni redovi (`workday_breaks`) — ukupno trajanje se **računa**, ne upisuje |
| `project_id`, `phase_id` | faza dolazi u R4 jer je traži dan, ne projekat (odluka iz R3) |
| `task_id`/`task_note` | zadatak kao šifrarnik po projektu + slobodan opis |
| `machine_id` | mašina kojom se radilo; `NULL` za ručni rad |
| `status` | `DRAFT` → `SUBMITTED` → `APPROVED` → `LOCKED` |
| `note` | kratak opis posla |
| `local_id` | ID koji telefon dodijeli **prije** slanja (idempotencija) |
| `version` | za detekciju sukoba pri sinhronizaciji |

**Sati se NE računaju u R4** — samo se evidentiraju početak, kraj i pauze. Obračun (normalno/noćno/
prekovremeno) je R5, jer traži pravila koja vlasnik još nije potvrdio.

**Prelazak ponoći:** jedan zapis, `work_date` = dan početka rada, `ended_at` može biti sljedeći dan.
Izvještaj ga prikazuje pod danom početka; **ne cijepa se** na dva reda — cijepanje bi stvorilo dva
dana koja niko nije radio i pokvarilo svaku sumu. (Ako vlasnik traži cijepanje, to je izmjena modela,
ne prikaza.)

## 2. Stanja i ispravke

- `DRAFT` — telefon još piše; nije poslano.
- `SUBMITTED` — poslano; vidi se u uredu.
- `APPROVED` — prihvaćeno; dalje ide u obračun (R5).
- `LOCKED` — zaključano po isteku roka za ispravke (npr. 7 dana) ili ručno.

**Ispravka poslije zaključavanja nije izmjena reda.** Nastaje nova verzija (`workday_revisions`) sa
obaveznim razlogom, autorom i vremenom; original ostaje čitljiv. Isto pravilo kao kod obaveza u R2b —
jedan mehanizam za „podatak se ne mijenja, dopunjuje se".

## 3. Offline i sinhronizacija

- Telefon piše **lokalno prvo** (SQLite), sa `local_id` (UUID na uređaju). Slanje je naknadno.
- `POST /api/sync/push` prima **listu** stavki; odgovor je **po stavci** (`ok` / `conflict` / `locked`),
  nikad jedan status za cijelu listu — jedna loša stavka ne smije blokirati deset dobrih.
- **Idempotencija po `local_id`:** ponovljeni push ne pravi duplikat. To pokriva najčešći slučaj —
  odgovor nije stigao, a zapis je upisan.
- Red slanja: najstarije prvo; stavke ostaju u redu dok ne dobiju odgovor.
- **Sukob po entitetu:** `workdays` — novija `version` pobjeđuje za `DRAFT`; za `SUBMITTED+` se ne
  prepisuje, nego se šalje u ured kao „zahtjev za ispravku". Prisustvo (`attendance`) — spaja se po
  `(worker, dan, tip)`; duplikat se odbacuje. Prilozi — isti `local_id` = isti fajl.
- **Online-only** (i zašto): promjena **tuđeg** radnog dana, odobravanje/isključivanje, izmjena
  šifrarnika (projekti, faze, zadaci), i unos sa **više radnika odjednom** iz foremanovog ekrana.
  Razlog: sve to dira podatke koje telefon ne smije odlučiti sam, i sve to traži da vidiš stanje
  koje je u međuvremenu promijenio neko drugi.

### Vrijeme

Vrijeme početka/kraja je **ono koje je čovjek upisao**, ali se čuva sa **vremenskom zonom firme** iz
`companies.timezone`, a ne sa zonom telefona: telefon u inostranstvu ne smije pomjeriti dan. Server
odlučuje o `work_date` (dan po zoni firme), telefon samo prikazuje. Ljetno/zimsko računanje vremena
rješava baza, ne aplikacija.

## 4. Nevidljivo pravilo: zaboravljen radni dan

**Nikad se ne zatvara tiho.** Ako dan nije završen do ponoći:

1. red ostaje `DRAFT` sa oznakom „nije završen" — **ne** dobija izmišljeni kraj;
2. ujutro telefon pita: „Jučerašnji dan nije završen. Kada si prestao?" — ponuda: upiši kraj, „ne
   sjećam se" (ostaje otvoreno, ide šefu), ili „radio sam i noćas" (produži);
3. ako čovjek ne odgovori u 24 h, **šef dobija obavještenje** u uredu (lista „dani bez kraja");
4. dan bez kraja **ne ulazi** u obračun i vidi se kao nezaokružen — nikad kao nula sati.

## 5. Ekrani

- **Telefon — moj dan:** veliko dugme „Počni rad", pa pauza/nastavi, pa „Završi". Ispod: projekat,
  faza, zadatak, mašina. Sve radi bez mreže; stanje slanja je vidljivo („poslano", „čeka mrežu").
- **Telefon — šef grupe:** jedan ekran, lista radnika sa stanjem dana, dodavanje cijele grupe na isti
  projekat/zadatak u nekoliko dodira. Online-only.
- **Ured — evidencija:** tabela dana sa filterima (projekat, osoba, stanje), detalj sa pauzama i
  ispravkama, odobravanje u grupi, lista „dani bez kraja".

## 6. Ograničenja koja moramo priznati (Expo)

- **Pozadinska sinhronizacija nije zagarantovana** ni na Androidu ni na iOS-u: OS gasi aplikaciju.
  Zato se red **šalje kad se aplikacija otvori** i uz „pošalji sada"; pozadina je dodatak, ne oslonac.
- **Aplikacija ubijena usred slanja:** stavka ostaje u redu sa `local_id`; ponovni push ne duplira.
- **Dugo offline (danima):** red raste; prilog se šalje tek kad je mreža, po redu, sa nastavkom
  (chunked/retry) — prekinut upload se nastavlja, ne počinje iz početka.
- **Minimalna verzija:** server odbija `local_id` protokol stariji od podržanog i vraća poruku
  „ažurirajte aplikaciju" (obavezna nadogradnja), jer stara verzija bez idempotencije pravi duplikate.
- **Prilozi:** slika se prije slanja smanjuje (max ~1600 px, JPEG ~80%), čuva se original do potvrde;
  Ograničenje je 10 MB po fajlu i 3 fajla po danu.

## 7. Kapija R4 (Maestro, na uređaju)

1. **Prekid mreže usred slanja** — uključi avionski režim poslije „Pošalji": stavka ostaje u redu, po
   vraćanju mreže odlazi tačno **jednom**.
2. **Dva telefona, isti dan** — oba upišu isti dan; drugi dobija jasan ishod (spojeno ili „zahtjev za
   ispravku"), nikad tiho prepisivanje.
3. **Ponovno slanje** — isti `local_id` dvaput: jedan red u bazi.
4. **Zaključan dan** — pokušaj izmjene poslije `LOCKED`: telefon nudi ispravku sa razlogom, ne izmjenu.
5. **Dan bez kraja** — sutradan telefon pita; bez odgovora šef vidi dan na listi „bez kraja".
6. **Prelazak ponoći** — rad 22:00–02:00 ostaje jedan zapis pod danom početka.

## 8. Izričito van R4

| Šta | Zašto |
|---|---|
| **Obračun sati, prekovremeno, noćni rad** | R5 — traži pravila koja vlasnik nije potvrdio (B5.7). |
| **Satnica i obračun zarade** | R5/R6 — novac, ne evidencija. |
| **GPS prisustvo i geofencing** | van obima pilotirane evidencije; privatnost radnika. |
| **Ture, gorivo, dnevni pregled mašine** | R5. |
| **Pisanje na mobilnom za više firmi** | ostaje jedna firma po nalogu. |

## 9. Pitanja vlasniku (bez odgovora ne počinjem)

1. **Ko upisuje radni dan** — radnik sam, šef grupe za sve, ili oboje (i ko je onda „vlasnik" dana)?
2. **Ko odobrava** — šef gradilišta, rukovodilac projekta ili ured; i da li se odobrava po danu ili
   po sedmici?
3. **Koliko radnika ima telefon** u pilotu — određuje da li je šefov ekran osnovni tok ili dodatak.
