# PLAN R4 — radni dani, terenski unos i offline sinhronizacija

**Status:** odobreno; **dizajn R4a-1 izričito odobren „ovako“** · **Revidirano:** 2026-11-07.
Vlasnik je potvrdio: oko 30 radnika, jednog vlasnika i dva administratora; radnik unosi svoj dan,
šef unosi grupu za radnike dodijeljene projektu na `work_date`; šef potvrđuje dan, ured odobrava
sedmicu ponedjeljak–nedjelja. R4 bilježi stvarno obavljeni rad, ne raspored i ne obračun zarade.
R4a-1 dizajn je odobren bez izmjena: radnik vlastiti unos je glavni tok, uredski pregled je
read-only; šefov grupni unos ostaje u R4a-2.

## 1. Granice, R4a kapije i jedan sync protokol

R4 se isporučuje u dva veća reza, sa obaveznom kapijom između R4a i R4b. R4a se dodatno dijeli na
dvije kapije:

- **R4a-1 — jezgro sync-a, unos radnika i pregled ureda:** najčešći unos je radnikov vlastiti dan
  (oko 30 radnika naspram 1 vlasnika i 2 administratora). Uključuje lokalni outbox, push/pull,
  cursor, idempotentnost, verzije segmenata, prikaz vlastitog dana i uredski pregled primljenih
  dana. Ured u ovom rezu samo vidi dane; ne potvrđuje i ne razrješava sukobe.
- **Kapija R4a-1:** vlasnik pregleda dizajn na 360/1440 px i u obje teme, zatim na stvarnom
  telefonu provjeri unos radnika, rad bez mreže, slanje nakon povratka mreže i uredski pregled.
  R4a-2 ne počinje dok vlasnik izričito ne prihvati R4a-1.
- **R4a-2 — drugi unos i ljudsko razrješenje:** dodaje grupni unos šefa i ekran ureda za
  razrješenje konfliktnih segmenata. Šef unosi samo radnike koji na izabranom projektu imaju R3
  dodjelu važeću na `work_date`.
- **Kapija R4a-2:** vlasnik provjerava grupni offline unos, R3 autorizaciju po datumu, konfliktni
  tok i audit. Tek poslije prihvatanja R4a-2 može se odobriti početak R4b.
- **R4b — potvrda i zatvaranje:** šef potvrđuje dan, ured odobrava sedmicu (ponedjeljak–nedjelja),
  zaključavanje i ispravke kao revizije. Uredsku rolu za sedmično odobrenje vlasnik bira u R4b.

Pozadinska sinhronizacija nije pouzdana ni na iOS-u ni na Androidu. Slanje se pokušava pri
otvaranju aplikacije i na izričito „Pošalji sada“; background task je dodatak, ne uslov da podaci
stignu. Prekid aplikacije ili mreže ne smije ukloniti neposlani red.

### Jedan protokol; uklanjanje R0 notes sync-a

Vlasnik potvrđuje da u `sync_items` i R0 bilješkama nema stvarnih podataka. R4 zato koristi jedan
protokol: `POST /api/sync/push` i `GET /api/sync/pull?cursor=<opaque>&limit=<n>`. Nema
podrške staroj semantici `since`. R4 migracija uklanja serverovu tabelu `sync_items` i stare note
sync rute; SQLite migracija uklanja legacy `notes` i `sync_meta.last_sync` bez kopiranja podataka.
Nema API kompatibilnosti ni prijelaznog perioda za note klijente.

## 2. Model podataka

Sve nove poslovne tabele su tenant podaci. `actor_id`/`created_by` je korisnik koji je unio red;
`worker_id` je radnik na kojeg se red odnosi. Server uzima `company_id` iz potvrđene sesije,
provjerava R3 opseg i postavlja RLS kontekst; nikad ne vjeruje tenant ID-u iz tijela zahtjeva.

### `workdays` — jedan kanonski dan po radniku i datumu

| Polje | Svrha |
|---|---|
| `id`, `company_id` | ID i tenant; klijent napravi UUID prije prvog sync-a |
| `worker_id`, `work_date` | radnik i poslovni datum po zoni firme |
| `status` | R4a: `DRAFT` → `SUBMITTED`; šefova potvrda i sedmično odobrenje su R4b |
| `header_version` | optimistic concurrency samo za polja zaglavlja i stanje |
| `created_by`, `updated_by` | autor i zadnji izmjenjivač zaglavlja |
| `created_at`, `updated_at` | serverska vremena, ne sat telefona |

Postoji `UNIQUE (company_id, worker_id, work_date)`: tačno jedan kanonski dan. Zaglavlje se radi
get-or-create upsertom: klijent šalje svoj UUID, server pokuša insert, a ako drugi uređaj već
napravio taj par, vrati postojeći kanonski zaglavlje-ID i mapira lokalni UUID na njega. Race između
dva uređaja završava jednim redom, ne duplikatom. Ne postoji `DUPLICATE_DAY`; konflikt je samo na
segmentu, ne na danu.

**Napomena o ranijem odstupanju:** prethodna revizija je uklonila ovu jedinstvenost i dodala
`DUPLICATE_DAY`, jer sam pretpostavio da treba čuvati zasebne kandidate sa više uređaja da bi se
izbjegao tihi merge. To je bilo moje neodobreno proširenje dizajna; raniju instrukciju sam odbacio
bez napomene umjesto da je označim kao prijedlog i pitam vlasnika. Time sam pogrešno izabrao više
zaglavlja umjesto jednog kanonskog dana. Ova revizija vraća `UNIQUE` i get-or-create po izričitoj
odluci vlasnika.

`work_date` se računa na serveru iz početka rada u `companies.timezone` i čuva se kao poslovni
podatak; kasnija promjena zone firme ne prepisuje ranije datume. Za isti `work_date` se ne može
napraviti drugo zaglavlje ni sa drugim klijentskim UUID-em.

### `work_entries` — segmenti sa nezavisnim verzijama

Svaki red ima `id`, `company_id`, `workday_id`, `worker_id`, `kind` (`WORK` | `BREAK`),
`started_at`, `ended_at`, `end_state`, `project_id`, opciono `machine_id`, `note`, `version`,
`created_by` i audit vremena. `company_id`/`worker_id` kompozitnim FK-om odgovaraju zaglavlju;
projekat i mašina, kad postoje, moraju pripadati istoj firmi.

- `WORK` traži projekat; mašina i kratka napomena su opcionalni. `BREAK` ne nosi projekat ni
  mašinu.
- Vremena događaja su apsolutni `TIMESTAMPTZ` sa eksplicitnim offsetom. Zatvoren, poznat segment
  mora imati `ended_at > started_at`; susjedni segmenti su dozvoljeni.
- `end_state` je `OPEN`, `KNOWN_END` ili `UNKNOWN_END`. Za `KNOWN_END` kraj je poznat i segment
  ulazi u izračun sati i overlap provjeru. `OPEN` ima `ended_at IS NULL`; najviše jedan `OPEN`
  segment po `(company_id, worker_id)` dozvoljen je parcijalnim unique indeksom. Otvoren segment
  učestvuje u overlap zaštiti kao interval bez gornje granice.
- `UNKNOWN_END` ima početak, ali nema izmišljeni `ended_at`; segment se izuzima iz overlap
  provjere, ne uračunava sate i automatski ide u uredski pregled. To nije isto što i trenutno
  aktivan `OPEN` segment.
- Ako već postoji `OPEN` segment, novi segment se ne može sačuvati dok korisnik izričito ne
  izabere jedno: **Završi segment** (upiše kraj kao događaj koji je korisnik sada potvrdio, uz
  autora/vrijeme/audit) ili **Kraj nepoznat** (`UNKNOWN_END`, bez sata). Sistem nikad sam ne
  izmišlja kraj. Tek nakon jednog od tih izbora dopušta se novi segment.
- Baza zabranjuje preklapanje `KNOWN_END` i `OPEN` intervala istog radnika preko svih projekata.
  Predložena zaštita je exclusion constraint nad firmom, radnikom i
  `tstzrange(started_at, ended_at, '[)')`; ako `btree_gist` nije dostupan, fallback je
  transakcijski triger sa advisory lockom, kao R3. `UNKNOWN_END` je izuzet iz range provjere.
- Projekat/mašina iz druge firme se odbija kao sigurnosna greška. Neaktivan/nevažeći projekat,
  mašina ili R3 uslov se ne koristi da se odbije činjenica rada koju radnik sam prijavljuje;
  segment se sačuva i označi uredu.

### `sync_conflicts` i `sync_receipts`

`sync_conflicts` postoji samo za sukob konkretnog segmenta: isti `work_entry` je izmijenjen na
serveru od zadnjeg preuzimanja, ili novi segment ne prolazi overlap/validaciju. Čuva `company_id`,
`actor_id`, `local_id`, `work_entry_id` ako postoji, primljeni payload, serverovu verziju,
`OPEN/RESOLVED`, autora/vrijeme/razlog razrješenja. Ne postoje zaglavlja sukoba za dupli dan.

Neriješeni konfliktni payload ostaje dostupan do razrješenja. Nakon razrješenja puni payload se
čuva još onoliko dana koliko je podešeno za konkretnu firmu; privremena podrazumijevana vrijednost
je **90 dana**, nakon čega se briše puni payload, uz zadržavanje minimalnog audita/hash-a. Retencija
je podesiva po firmi. Pravna potvrda ostaje otvoreno pitanje, ali nije blocker za R4a-1.

`sync_receipts` bilježi `(company_id, actor_id, local_id)`, hash zahtjeva, ishod i vraćene ID-e/
verzije da retry istog zahtjeva ne pravi duplikat. Detaljni receipt se čuva 90 dana, isto kao
cursor/change-log prozor; kompaktni idempotency ključ uz kanonski segment ostaje dok segment
postoji. Retry izvan receipt prozora se ne primjenjuje naslijepo: klijent prvo mora povući stanje,
a nepoznat ishod ide na provjeru.

## 3. Autor, R3 opseg i historija dodjela

- **Radnik** unosi samo svoj radni dan i svoje segmente. Stvarni rad na projektu na koji nije bio
  dodijeljen ili uz istekli R3 uslov se prihvata i označava, ali samo za projekat iste firme.
- **Šef grupe** unosi za radnika samo ako postoji R3 dodjela tom radniku na izabranom projektu na
  `work_date`, uključujući početni i završni datum:
  `from_date <= work_date AND (to_date IS NULL OR work_date <= to_date)`. Provjera je serverska,
  per segment/projekat; klijentova lista nije dokaz ovlaštenja. Pull šefa vraća samo segmente za
  radnike/projekte koji su mu vidljivi tim pravilom na `work_date`.
- **Uredski pregled R4a-1:** odobren je read-only pristup postojećim `OWNER` i `ADMIN` nalozima;
  nova/tačna uredska rola bira se u R4b.

### R3 historija — odobrena zaštita (prvi implementacijski korak)

U početnom stanju prije R3 history-guard promjene, kod je dopuštao hard-delete kroz
`DELETE /api/projects/:id/assignments/:assignmentId`, `project_assignments` je imao DELETE grant,
a FK-ovi prema projektu/radniku/mašini kaskadno su brisali red. Korak 1 uvodi zabranu u aplikaciji
i bazi; njegova migracija još zahtijeva staging preflight/deploy prije nego što zaštita važi za
staging bazu. Migracija ne prepravlja niti briše postojeće dodjele.

1. Aplikacija i baza zabranjuju hard-delete `project_assignments`. Identitet dodjele, cilj, projekat,
   `from_date` i početni podaci ostaju nepromjenjivi; `to_date` se postavlja samo na današnji ili
   budući poslovni datum po zoni firme, a postojeći kraj se može samo produžiti, nikad skratiti.
2. Normalni „Završi dodjelu“ postavlja auditan `to_date`; projekat/radnik/mašina se deaktivira, ne
   fizički briše. FK-ovi prema njima postaju `RESTRICT`/`NO ACTION`.
3. Pogrešnu dodjelu moguće je jednom označiti nevažećom uz razlog, autora i vrijeme. Baza odbija
   void ako postoji `workday` tog radnika unutar perioda dodjele, odnosno upotreba mašine u nekom
   `work_entry` u tom periodu. Void ne prepravlja originalne datume i ne briše trag; postojeći
   redovi pri migraciji ostaju netaknuti.
4. Privilege-matrix uklanja `DELETE`, dopušta samo potreban `UPDATE`; trigger, preflight i testovi
   dokazuju zabranu DELETE-a, izmjene identiteta/`from_date` i retroaktivnog skraćenja.
5. PostgreSQL regresija provjerava inkluzivni R3 period-uslov: završetak dodjele ne mijenja
   ovlaštenost ranijeg `work_date`, a datum poslije `to_date` nije obuhvaćen. Ovo je test uslova,
   ne end-to-end dokaz šefove autorizacijske rute: grupni push/pull još nije implementiran i mora
   dobiti route-level test u R4a-2 prije isporuke grupnog unosa.

Ranije hard-deleted dodjele se ne mogu rekonstruisati automatski; pregled postojećih redova ostaje
DBA zadatak, ali ne blokira početak implementacije.

## 4. Verzije, push i ograničenja zahtjeva

Zaglavlje i svaki segment imaju odvojene verzije:

- `header_version` se povećava samo kad se mijenjaju polja zaglavlja ili stanje dana. Promjena
  segmenta ne povećava `header_version`.
- Svaki `work_entry.version` se povećava samo kad se mijenja taj segment. Različiti segmenti istog
  dana su nezavisni i mogu se slati paralelno; optimistic-concurrency konflikt nastaje samo ako
  dva zahtjeva izmijene isti `work_entry` na osnovu iste stare verzije.
- Overlap/validacija novog segmenta je zaseban ishod vezan za taj segment, ne konflikt zaglavlja.
  Nevažeći ili preklopljeni payload ostaje u segmentnom konfliktu za ured; drugi segmenti iz
  batcha se ne poništavaju.
- Promjena autora na `SUBMITTED` danu dozvoljena je do šefove potvrde: autor otvara novu verziju,
  svaka izmjena je auditirana i nosi `base_version`. Nakon `FOREMAN_CONFIRMED` ide samo R4b
  revizijski tok.

`POST /api/sync/push` nosi listu nezavisnih stavki. Svaka stavka ima klijentski UUID `local_id`,
kanonski `workday_id` ili lokalni UUID za get-or-create, `base_version` zaglavlja ako se mijenja,
`work_entry_id` i `base_version` konkretnog segmenta ako se mijenja, `device_sent_at` i payload.
Tenant dolazi iz sesije, ne iz tijela.

**Predloženi tvrdi limiti:** najviše 100 stavki i 1 MiB ukupnog JSON tijela po push zahtjevu; najviše
16 KiB po stavci. Validacija veličine/oblika cijelog zahtjeva prolazi prije upisa. Klijent dijeli
veće redove u batcheve; svaki item i svaki retry imaju svoj stabilni `local_id`. Limit je predlog
za pilot i mora se provjeriti na grupnom unosu 30 radnika.

## 5. Pull, cursor, retencija i uklanjanje starog sync-a

`GET /api/sync/pull?cursor=<opaque>&limit=<n>` vraća promjene poslije cursora. Jedan cursor i
jedan protokol se koriste za radne dane; nema starog note sync protokola ni prelaznog perioda.

Cursor ne smije biti samo `max(change_seq)` jer obična sekvenca može napraviti rupu: A dobije manji
broj, B veći, B se potvrdi prije A, pa klijent pređe preko A. Predloženi model koristi
`sync_cursor_allocators` (po firmi), trajni `sync_cursor_slots` po firmi sa stanjima `PENDING`,
`COMMITTED`, `SKIPPED`, te `sync_change_log`:

1. Alokator daje `cursor_seq` tako što zaključava svoj red **samo u kratkoj rezervacionoj
   transakciji**, povećava `next_seq`, upisuje PENDING slot s jedinstvenim reservation tokenom i
   lease-om od 5 minuta, pa commit-a. Broj i slot su u istoj transakciji: njen rollback ne ostavlja
   rupu. Taj lock se nikad ne drži tokom poslovnog upisa; poslovna transakcija ima gornju granicu
   od 60 sekundi.
2. Poslovna transakcija provjeri token, zaključava svoj postojeći PENDING slot, upisuje promjenu i
   change-log događaj te označi slot `COMMITTED` u istoj transakciji. Lock slota traje samo do tog
   commit-a; zato A može imati niži slot dok B sa višim slotom commit-a prvi.
3. Pull može isporučiti kasnije `COMMITTED` događaje i dok niži slot čeka, ali `nextCursor` ostaje
   prije prvog `PENDING` slota. Klijent deduplikuje ponovljene događaje po slot/event ID-u. Kad A
   postane vidljiv, pull vrati i A i B prije pomjeranja cursora preko oba.
4. Ako se poslovni upis abortira, rezervisani slot ostaje `PENDING`. Sweeper ga označi `SKIPPED`
   samo po isteku reservation lease-a i nakon što stekne row lock (dokazuje da writer više ne drži
   lock); kasni writer mora provjeriti status/token i ne može oživjeti `SKIPPED` slot, nego
   rezerviše novi. Allocation rollback nema slot ni broj; business rollback ostavlja vidljiv,
   dokazivo preskočiv slot. Nikad se ne preskače samo zato što događaj još nije vidljiv.

Svaki insert/update/brisanje emituje događaj sa firmom, entitetom, ID-em, verzijom i payloadom ili
Tombstone-om. Klijent primjenjuje stranicu i `nextCursor` u jednoj SQLite transakciji; cursor se
pomjeri tek kad je cijela stranica sigurno upisana. Ako postoji niži `PENDING` slot, pull može
ponoviti već viđen viši događaj; klijent ga prepoznaje i ne primjenjuje dvaput.

**Retencija:** tombstones i puni `sync_change_log` payload čuvaju se 90 dana; `cursor floor` je
najniži još važeći slot, a cursor ispod floor-a vraća `CURSOR_EXPIRED` i traži punu obnovu
serverovog cache-a. Slotovi `COMMITTED`/`SKIPPED` i floor čuvaju se kroz isti 90-dnevni prozor;
kompaktiranje je dozvoljeno tek kad je slot
ispod floor-a i nijedan važeći cursor ne zavisi od njega. `PENDING` se nikad ne briše dok lease i
lock provjera nisu prošli. `next_seq` se nikad ne smanjuje niti ponovo koristi. Puni `sync_receipts`
se čuvaju 90 dana; kompaktni idempotency ključ uz kanonski segment ostaje dok taj segment postoji.
Konfliktni payload se čuva do razrješenja + podešeni per-company rok (privremeni default 90 dana);
pravna potvrda je otvoreno pitanje, nije blocker. Istek cursora ne briše lokalni outbox ni konflikt.

R0 `sync_items`, note rute i legacy cursor se uklanjaju; vlasnik potvrđuje da nema stvarnih
podataka za backfill.

## 6. Vrijeme, `UNKNOWN_END` i otvoren dan

Vremena događaja se šalju u RFC 3339 formatu sa eksplicitnim UTC offsetom i čuvaju kao apsolutni
`TIMESTAMPTZ`. Aplikacija prikazuje lokalno vrijeme po `companies.timezone`, ne po zoni telefona.
Ako je lokalno vrijeme nepostojeće ili dvosmisleno zbog DST prelaza, klijent traži izbor offseta
prije slanja; server ne nagađa. `work_date` se računa iz početka rada u zoni firme i ostaje
zabilježen i ako firma kasnije promijeni zonu. Smjena 22:00–02:00 ostaje jedan dan pod datumom
početka.

`KNOWN_END` sati se izvode iz `started_at`/`ended_at`; pauze se ne računaju kao rad. `UNKNOWN_END`
se ne računa ni kao poznato trajanje ni u overlap constraintu, iako se njegov poznati početak
čuva za ured. Ured vidi oznaku „Kraj nepoznat“; sistem ne upisuje ponoć, vrijeme prijema ni drugo
izmišljeno vrijeme kao kraj.

Ako `OPEN` segment postoji, unos narednog segmenta zahtijeva eksplicitno zatvaranje sa auditom ili
`UNKNOWN_END`. Najviše je jedan `OPEN` po radniku. Ako je dan otvoren duže od **16 sati** od početka
prvog otvorenog segmenta, označava se za ured; nema automatskog zatvaranja.

Sat telefona se poredi između `device_sent_at` i `server_received_at`, ne između početka rada i
prijema. Ako apsolutna razlika pređe **5 minuta**, zapis se čuva i označi; vrijeme događaja se ne
prepisuje. Ovi pragovi su potvrđeni za plan.

## 7. Pull opseg, logout i izgubljen telefon

- **Radnik:** pull vraća samo njegove `workdays`/segmente. Lokalno se za listu tima ne preuzima
  ništa mimo potrebe za vlastitim unosom.
- **Šef:** pull vraća samo ID i ime radnika iz svog R3 opsega i samo segmente čiji je projekat
  dodijeljen tom radniku na `work_date`. Ako isti dan ima segmente na drugim projektima, oni se
  filtriraju; ne vraćaju se ni ukupni sati koji bi otkrili skrivene segmente.
- **Ured R4a-1:** read-only pregled dana za postojeće `OWNER`/`ADMIN` naloge, kao privremeni
  prijedlog; tačna uredska rola bira se u R4b.
- Mobilni uređaj dobija samo `worker_id` i ime radnika potrebno za unos/prikaz. Ne preuzima
  telefon, email ni druga lična polja.
- Pri odjavi se brišu auth tokeni, keš tuđih workdays/segmenata, keš opsega/tima i serverov cursor.
  **Neposlani redovi i konfliktni payloadi se ne brišu**; ostaju lokalno vezani za prvobitni
  `company_id`/`user_id` i mogu se slati tek nakon prijave istog korisnika.
- Kod izgubljenog telefona server odmah opoziva refresh/access sesije i označi uređaj nevažećim.
  Server ne može garantovati brisanje podataka sa offline uređaja: lokalni outbox ostaje šifrovan
  do OS/MDM wipe-a ili dok se uređaj ponovo ne poveže. Pri sljedećem pokretanju/online provjeri
  aplikacija uklanja auth i keš; ne šalje ništa kroz opozvanu sesiju. Organizacijska procedura
  uključuje opoziv sesija i, gdje postoji, OS/MDM remote wipe. Ovaj limit se jasno objašnjava
  korisniku.

SQLite ima `PRAGMA user_version`. Migracija R4 čuva R4 redove/outbox/cursore transakcijski i ne
radi reset baze. Vlasnik potvrđuje da se legacy R0 note redovi mogu ukloniti jer nema stvarnih
podataka; neočekivani neposlani legacy red prije uklanjanja traži jasno upozorenje, ne tiho slanje
pod drugim protokolom.

Lozinke i auth tokeni ne idu u SQLite; token ostaje u SecureStore. Prije pilota se potvrđuje
politika OS backup-a i zaštite lokalnog fajla. Offline sync se pokušava pri otvaranju i ručnom
„Pošalji sada“; background sync nije garancija.

## 8. RLS, privilegije i rollout

R4 nasljeđuje ADR 0013 i `packages/db/preflight-checks/privilege-matrix.tsv`:

- Sve nove tenant tabele nose `company_id`, imaju RLS i tenant policy; predloženo je `ENABLE` +
  `FORCE ROW LEVEL SECURITY`. To uključuje `workdays`, `work_entries`, `sync_conflicts`,
  `sync_receipts`, `sync_change_log`, `sync_cursor_slots` i `sync_cursor_allocators`. Nema
  `foreman_scope_snapshots`.
- Matrica navodi needed/current rights. Aplikacijska prava su samo potrebni `SELECT/INSERT/UPDATE`;
  fizički `DELETE` se ne daje ako poslovni tok ne traži baš to pravo. `sync_cursor_slots` i
  `sync_cursor_allocators` su interni objekti bez direktnog tabelnog ACL-a; ograničene,
  `SECURITY DEFINER` funkcije za reserve/publish/sweep/pull su jedini app pozivni put, sa zatvorenim
  `search_path`, provjerom tenant konteksta i eksplicitnim EXECUTE preflightom. `sync_change_log` je
  read-only za aplikaciju; upis ide kroz publish funkciju.
- R3 historija iz §3 je odobrena i implementira se kao prvi korak; preflight/matrica provjeravaju
  immutable guard. R0 `sync_items` i note sync se uklanjaju u scoped push/pull koraku; ne ostaje
  kompatibilnost starog protokola.

**Rollout i mini-kapije (tačan R4a-1 redoslijed):**

1. R3 assignment-history guard: migracija, preflight/privilege-matrix i testovi.
2. Change log + cursor: allocator/slots i dvije stvarne DB konekcije koje potvrđuju reverse commit
   bez preskoka.
3. `workdays`, `work_entries`, `sync_receipts`, `sync_conflicts` i firma-postavke retencije:
   FORCE RLS, privilegijska matrica, generisani tenant-isolation testovi, EXCLUDE ili trigger
   fallback, `UNKNOWN_END`. **Zaustaviti se i izvijestiti nakon koraka 3.** Izvršiti/reportovati
   staging preflight i očekivati da vlasnik zalijepi izlaz iz loga prije nastavka.
4. Čist sync modul i deterministički mrežni simulator u CI-ju.
5. Scoped push/pull API; ukloniti stari R0 notes sync.
6. SQLite migracija koja čuva postojeće podatke i dodaje outbox. **Zaustaviti se i izvijestiti nakon
   koraka 6.**
7. UI po već odobrenom R4a-1 dizajnu, svijetla i tamna tema.

Staging rollout je nakon koraka 3, uz preflight izlaz vlasnika, i prije koraka 7. Svaka migracija je
naprijed-samo i prolazi na praznoj/popunjenoj bazi i runtime preflightu. R4a-2 i R4b imaju zasebne
kapije.

**Rollback:** isključiti R4 feature za nove zahtjeve i vratiti kompatibilan server build bez
brisanja R4 podataka, outboxa, slotova i konflikata. Ne vraćati stari široki `GRANT ALL`, ne vraćati
R0 notes endpoint i ne dropati R4 tabele. Klijent čuva red dok se server ne vrati; rollback šeme
nije uslov za image rollback.

## 9. R4a-1 — jezgro, unos radnika i pregled dana

R4a-1 uključuje:

- jedan canonical `workday` po firmi/radniku/datumu, client UUID + server get-or-create;
- `work_entries` verziju po segmentu, `OPEN`/`KNOWN_END`/`UNKNOWN_END`, push/pull, cursor,
  idempotency i sync receipt/change log;
- worker self-entry kao glavni mobilni tok za oko 30 radnika; postojeći owner/admin mogu vidjeti
  uredski read-only pregled dana;
- worker pull ograničen na vlastite dane; ured vidi samo neophodna polja i ime/ID tima;
- lokalni outbox, atomic pull pages, tombstones, logout privacy i R3 historical-assignment
  prerequisite;
- uredski pregled: period ponedjeljak–nedjelja, radnik, projekat, segmenti, sati samo iz poznatih
  krajeva, state `OPEN`/`UNKNOWN_END`/`SUBMITTED`, sync stanje i oznake za provjeru. Nema ekrana
  za razrješenje konflikta u ovom rezu.

**R4a-1 gate:** dizajn je već izričito odobren bez izmjena. Preostali gate-ovi su implementacijski:
korak 3 i korak 6 imaju obavezni stop/report; rollout na staging je nakon koraka 3 i prije UI
koraka 7; stvarni telefon/UAT i preflight su prije pilot-uključenja. Grupni unos ostaje R4a-2.

## 10. R4a-2 — grupni unos šefa i razrješenje

R4a-2 dodaje:

- šef bira projekat i radnike koji su mu dodijeljeni na `work_date`, zatim offline pravi segmente
  za grupu; server svaku stavku autorizuje po neizmjenjivoj R3 historiji;
- uredski ekran prikazuje konflikt na konkretnom `work_entry`: stara server verzija, dolazni
  payload, vrijeme, autor i razlog; ured može odabrati/urediti rješenje uz obavezni audit;
- konfliktnom payloadu ne mijenja se sadržaj ni retencija: čuva se do razrješenja + per-company
  rok (privremeni default 90 dana); pravna potvrda je otvoreno pitanje, nije blocker;
- R4a-2 ne uvodi šefovu potvrdu dana niti uredsko sedmično odobrenje — to je R4b.

**R4a-2 gate:** CI simulator, dvije realne DB konekcije, offline grupni tok i konfliktni UI prolaze;
vlasnik prihvata tok na stvarnom telefonu. Tek tada se planira/počinje R4b.

## 11. R4b — potvrda, sedmično odobrenje i ispravke

Potvrđeni poslovni tok:

`SUBMITTED` → `FOREMAN_CONFIRMED` → `WEEK_APPROVED` → `LOCKED`.

- Šef potvrđuje dan. Ured odobrava sedmicu ponedjeljak–nedjelja. Vlasnik bira tačnu uredsku rolu
  u R4b.
- Autor može otvoriti novu verziju do šefove potvrde; svaka izmjena je auditirana. Nakon
  `FOREMAN_CONFIRMED`, ispravka ide kao nova revizija sa razlogom, autorom, vremenom i vezom na
  prethodnu verziju.
- Nakon `LOCKED` original se ne prepisuje. Ured vidi listu dana otvorenih preko granice 16h;
  nema auto-zatvaranja i izmišljenog vremena.
- Sedmično odobrenje ima audit i eksplicitno odbijanje sa razlogom; detalj ko može „vratiti“ sedmicu
  potvrđuje se pri dizajnu R4b.

## 12. Dokaz ispravnosti u CI-ju

Glavna sync logika je deterministički modul odvojen od Reacta i mreže. Simulator sa fiksnim seed-om
ubacuje prekide, duplikate, promjenu redoslijeda, zakašnjele odgovore, paralelne uređaje, radnika i
šefa. Obavezni dokazi:

1. Isti `(company_id, actor_id, local_id, payload_hash)` daje jedan rezultat; drugi payload uz isti
   ID se odbija.
2. Isti header UUID/radnik/datum radi get-or-create na jedan jedini `workday`; konkurentni klijenti
   dobiju isti canonical ID. Nema `DUPLICATE_DAY`.
3. Izmjene različitih segmenata istog dana prolaze nezavisno; stale update istog segmenta je sukob;
   header version se ne mijenja od segment edit-a.
4. Samo jedan `OPEN` segment po radniku. Novi segment blokiran je do eksplicitnog kraja uz audit
   ili `UNKNOWN_END`; `UNKNOWN_END` ne broji sate, ne blokira overlap i ide uredu.
5. Overlap constraint štiti poznate/otvorene segmente pod paralelnim upisima; konflikt je vezan za
   segment, ne zaglavlje.
6. Worker pull ne vraća tuđe workdays. Foreman pull/push vraća/smije samo R3 assignment projekte
   po `work_date`, a payload nema phone/email. Owner/admin office read ima tenant scope.
7. Logout briše tuđi cache/token, ali ne neposlani outbox/conflict payload; izgubljen telefon
   opoziva sesiju, ne pretvara lokalni red u drugog korisnika.
8. Oznaka `UNKNOWN_END` ne dopisuje `ended_at`; DST i ponoć koriste explicit offset/firm timezone.
9. Cursor concurrency test na **dvije prave konekcije na pravoj PostgreSQL bazi**: A završi svoju
   kratku rezervacionu transakciju i dobije niži slot, pa poslovnu transakciju ostavi necommitovanu;
   B rezerviše viši slot i poslovnu transakciju commit-a prvu. Pull može vratiti B, ali cursor ne
   prelazi A. Nakon A commit-a klijent mora dobiti A i B bez preskočenog zapisa (B može stići ponovo
   i deduplikovati se). Ako A abortira, samo slot sa isteklim lease-om i dokazano oslobođenim lockom
   postaje `SKIPPED`, pa cursor napreduje.
10. Pull stranica i cursor se primjenjuju atomarno u SQLite-u; tombstone ne oživljava red; expired
    cursor traži resync, ali ne briše outbox.
11. Retencija: sync change log/tombstone 90 dana; receipt 90 dana + compact idempotency key uz
    canonical segment; konfliktni payload do razrješenja + per-company rok (default 90 dana).
    Ograničenja push-a 100 stavki,
    1 MiB ukupno, 16 KiB po stavci odbijaju zahtjev prije upisa.
12. PostgreSQL testovi provjeravaju RLS, B privilege matrix, R3 no-delete/no-retroactive-shortening
    zaštitu i normalne login/invitation/reset/password-change tokove.

Maestro/real-device UAT pokriva worker offline unos, zatvaranje ili `UNKNOWN_END`, povrat mreže,
logout, i sync poslanog reda. Grupni unos i ekran razrješenja su R4a-2 UAT. Simulator ostaje glavni
CI dokaz; Maestro nije zamjena za concurrency test na pravoj bazi.

## 13. Izričito van R4

| Šta | Zašto |
|---|---|
| **Faze projekta** | koristi se projekat iz R3; nema novog modela faza. |
| **Šifrarnik zadataka** | slobodna napomena je dovoljna za pilot. |
| **Fotografije/prilozi uz radni dan** | van pilotnog opsega. |
| **Obračun zarade, satnice i novac** | zasebna pravila i odobrenje. |
| **GPS/geofencing** | privatnost i van dogovorenog pilota. |
| **Ture, gorivo, dnevni pregled mašine** | zaseban budući rez. |
| **Automatsko zatvaranje segmenta** | nikad se ne izmišlja vrijeme; korisnik zatvara ili označi `UNKNOWN_END`. |
| **R0 notes kompatibilnost** | vlasnik potvrđuje da nema stvarnih podataka; jedan protokol, bez tranzicije. |

## 14. Odgovori vlasnika i preostale kapije

Potvrđeno:

- Pilot ima oko 30 radnika, jednog vlasnika i dva administratora.
- Unose oboje: radnik svoj dan; šef grupu za R3-dodijeljene radnike.
- Šef potvrđuje dan; ured odobrava sedmicu ponedjeljak–nedjelja; tačna uredska rola se bira u R4b.
- `SUBMITTED` autor može otvoriti novu verziju do šefove potvrde; sve uz audit.
- Jedan kanonski dan po firmi/radniku/datumu; get-or-create; nema `DUPLICATE_DAY`.
- Pragovi: 5 minuta za sat, 16 sati za otvoren dan, 90 dana za tombstone/cursor; DST offset bira se prije slanja.
- R0 notes sync se uklanja jer nema stvarnih podataka; jedan protokol bez prijelaza.
- Konfliktni payload se čuva do razrješenja + podesivi per-company rok (privremeni default 90 dana);
  pravna potvrda je otvoreno pitanje, nije blocker.

Otvoreno, ali nije blocker za odobrenu implementaciju:

1. Pravna potvrda trajanja konflikt-payload retencije; privremeni per-company default je 90 dana.
2. DBA pregled historijskih hard-delete tragova; postojeći podaci se ne mijenjaju i izbrisana historija
   se ne može automatski vratiti.
3. Staging preflight/rollout nakon koraka 3, prije UI koraka 7; vlasnik dostavlja preflight izlaz.
4. Stvarni telefon/UAT i pilot-uključenje nakon implementacije; nisu zamjena za CI/concurrency testove.

Dizajn R4a-1 je odobren „ovako“: worker self-entry glavni tok, ured read-only, svijetla/tamna tema
na 360/1440; grupni unos šefa nije dio ovog reza. Samo R4a-1 je u opsegu.
