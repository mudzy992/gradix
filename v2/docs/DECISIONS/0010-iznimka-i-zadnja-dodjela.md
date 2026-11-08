# ADR 0010 — Iznimka od blokade: odvojeno pravo, zahtjev, i zadnja dodjela

**Status:** prihvaćeno (2026-11-09, pregled R3)
**Kontekst:** R3 §5 (blokada dodjele), B5.4 (dokumentacija prije rada), odluka vlasnika u pregledu R3

## Odluke

1. **Iznimku odobrava `projects.override`, ne `projects.assign`.** Samo OWNER i ADMIN.
2. **PM sa `projects.assign` može ZATRAŽITI iznimku** — to je zahtjev, ne odobrenje.
3. **Odobrenje traži rok.** Iznimka bez roka je trajno gašenje pravila pod drugim imenom.
4. **Skidanje zadnje dodjele osobi sa opsegom `PROJECTS` spušta opseg na `SELF`** i to se vidi u UI.
5. **Preklapanje dodjela brani jedan mehanizam** — `EXCLUDE USING gist` ako je `btree_gist` dostupan,
   inače triger sa `pg_advisory_xact_lock`.

## Zašto iznimka nije dio dodjele

Blokada iz B5.4 kaže: čovjek sa isteklom dokumentacijom ne ide na gradilište. Ako iznimku odobrava
onaj ko dodjeljuje, pravilo važi samo protiv onoga ko **ne može** dodijeliti — a to nije niko u uredu.
Rukovodilac projekta dodjeljuje ljude svaki dan i najviše je pod pritiskom da posao krene; ako mu
iznimka ide s dodjelom, iznimka postaje pravilo.

Zato je odobrenje **posebno pravo** (vlasnik/admin) i **drugi korak** (zahtjev → odobrenje). Cijena:
jedan klik više kad iznimka stvarno treba. Korist: iznimka je odluka, a ne posljedica žurbe.

Provjera je na serveru (`approveOverride`, `createAssignment`) — UI samo ne nudi ono što bi bilo
odbijeno. Test tvrdi oboje: PM prolazi sa zahtjevom, pada sa odobrenjem i sa direktnom iznimkom.

## Zašto `scopeNotice`, a ne tiho gašenje

Do R3 je bilo moguće da osoba sa opsegom „dodijeljeni projekti“ ostane bez ijedne dodjele. Tada vidi
**ništa**: prazna lista, bez objašnjenja. To je gore od greške, jer greška se prijavi.

Zato skidanje zadnje dodjele:

- **spušta opseg na `SELF`** — najuži, nikad širi; nikad `COMPANY`,
- **piše audit** `user.membership_changed` sa `reason: last_project_assignment_removed`,
- **vraća `scopeNotice`** u odgovoru, koji ekran prikazuje umjesto obične poruke.

Alternativa koju smo odbili: blokirati skidanje zadnje dodjele. To bi značilo da ured ne može
prestati dodjeljivati čovjeka bez prethodne promjene opsega — pravilo bi tjeralo ljude da rade
zaobilaznicu. Automatsko spuštanje je reverzibilno jednim klikom i ostavlja trag.

## Preklapanje: `EXCLUDE` kad može, triger kad ne može

`EXCLUDE USING gist (… daterange(…) WITH &&)` je deklarativno rješenje: baza ga ne može zaobići, ni
kroz drugu aplikaciju, ni kroz `psql`. Traži `btree_gist` za `text` kolone.

`btree_gist` je na PostgreSQL 16 **trusted** — vlasnik baze ga smije kreirati bez superusera **ako je
contrib instaliran**. U `postgres:16-alpine` (CI) jeste; u minimalnim slikama nije. Zato migracija
`20261109160000_r3_preklapanje_gist` pokušava u `BEGIN/EXCEPTION` bloku:

- uspije → dvije parcijalne `EXCLUDE` constraint-e, triger i funkcija se **brišu**;
- ne uspije → **vraća** funkciju sa `pg_advisory_xact_lock` i triger ostaje.

Oba puta baza ima **tačno jedan** mehanizam, a test to tvrdi (`constraints !== triggers`). Tiho
„nemamo ni jedno ni drugo“ ne prolazi. Razlog za fallback je dokazan mjerenjem — vidi dolje.

### Dokaz da bez brave ne valja

Triger **bez** `pg_advisory_xact_lock` je bio propušten u prvoj verziji. Test sa dvije paralelne
konekcije (jedna drži nepotvrđen `INSERT`) pokazao je: sa bravom **tačno jedna** transakcija pada;
bez brave **obje prolaze** i baza dobije dva preklapajuća reda. Zaključak: provjera-pa-upis bez brave
nije zaštita, nego takmičenje. Zato fallback NIKAD nije goli triger.

## Posljedice

- Dvije nove rute (`override-requests`), `project_id`/`requested_by`/`approved_at` na
  `project_assignment_overrides`, `assignment_id` i `valid_until` postaju opcioni (zahtjev ih nema).
- `CHECK` traži rok **samo za odobrenu** iznimku — zahtjev roka nema jer ga još niko nije odredio.
- Skidanje dodjele mijenja **tuđe** članstvo. To je jedina radnja u R3 koja to radi; zato audit i
  vidljiva poruka, i zato odluka stoji ovdje, a ne u kodu servisa.
