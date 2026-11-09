# PLAN R4 — radni dani, terenski unos i offline sinhronizacija

**Status:** revidirani predlog, čeka odobrenje vlasnika. **R4 kod se ne počinje prije odobrenja.**
**Revidirano:** 2026-11-07.
Ulaz: R3 zatvara projekte, dodjele i opsege. R4 bilježi stvarno uneseni rad sa telefona, uključujući
unos šefa grupe bez mreže. Ovo je plan i skup predloženih odluka, ne odobrenje za implementaciju.

## 1. Granice, isporuke i postojeći sync

R4 je evidencija činjenice da je rad obavljen: ko je radio, kada, na kojem projektu i u kojim
vremenskim segmentima. Ne pravi raspored, ne mijenja R3 dodjele i ne obračunava zaradu.

R4 se dijeli na dvije isporuke sa **obaveznom kapijom između**:

- **R4a — unos, offline red, sync i pregled ureda:** radnik i šef grupe mogu unositi bez mreže;
  red se čuva na telefonu, a push/pull prenose promjene i sukobe. Ured vidi primljene dane,
  audit i oznake za provjeru, ali ne odobrava niti zaključava.
- **R4b — potvrda i zatvaranje:** šef potvrđuje dan, ured odobrava sedmicu, dan se zaključava,
  ispravke postaju revizije, a ured dobija listu predugo otvorenih dana. R4b ne počinje dok vlasnik
  ne prođe i ne prihvati R4a.

Pozadinska sinhronizacija nije pouzdana ni na iOS-u ni na Androidu. Slanje se pokušava pri
otvaranju aplikacije i na izričito „Pošalji sada“; background task je dodatak, ne uslov da podaci
stignu. Prekid aplikacije ili mreže ne smije ukloniti lokalni red.

### Kompatibilnost sa sadašnjim sync-om

Repo već ima R0 sync za entitet `note`: server koristi `sync_items` i `/api/sync/push` te
`/api/sync/pull?since=<ISO>`; postojeći SQLite fajl ima `notes` i `sync_meta`, a kursor je
`lastSyncTimestamp`. To je živi format podataka i ne mijenja se tiho u R4.

**Predlog:** R4 uvodi verzionisani v2 protokol i rute (npr. `/api/sync/v2/push` i
`/api/sync/v2/pull?cursor=...`). Postojeći v1 note sync ostaje dostupan tokom dogovorenog
prijelaznog perioda, dok se novi radni dani prenose v2 protokolom. Nema promjene značenja `since`,
brisanja `sync_items` ni odbijanja starog klijenta bez perioda prelaza i odluke vlasnika. Novi
klijent mora sačuvati postojeće neposlane note zapise i kursor; ako se za stari red ne može
pouzdano utvrditi prvobitni korisnik, aplikacija ga ne smije automatski poslati pod drugim nalogom.

## 2. Model podataka

Sve nove poslovne tabele su tenant podaci. `actor_id`/`created_by` je korisnik koji je unio red;
`worker_id` je radnik na kojeg se red odnosi. Server nikad ne uzima `company_id` iz nepouzdanog
payload-a nego iz potvrđene sesije i RLS konteksta.

### `workdays` — zaglavlje dana

Jedan red predstavlja jedan lokalno nastao kandidat za radni dan.

| Polje | Svrha |
|---|---|
| `id`, `company_id` | server identitet i tenant |
| `worker_id`, `work_date` | radnik i poslovni datum u zoni firme |
| `status` | R4a: `DRAFT` → `SUBMITTED`; potvrda i zaključavanje su R4b |
| `version` | optimistic concurrency; sadržajna izmjena podiže verziju |
| `created_by`, `updated_by` | korisnik koji je unio odnosno zadnji izmijenio red |
| `created_at`, `updated_at` | serverska vremena, ne sat telefona |

Namjerno nema `UNIQUE (company_id, worker_id, work_date)`. Kompozitni `UNIQUE (id, company_id,
worker_id)` služi samo kao meta FK-a iz segmenata i ne spaja dane. Dva uređaja mogu napraviti dva
kandidata za isti dan; sistem ih ne spaja niti prepisuje tiho. Takvi kandidati dobijaju
`DUPLICATE_DAY` sukob/oznaku i ured vidi oba. Rješavanje je ljudsko i auditirano. Isti obrazac
`UNIQUE (id, company_id)` koristi se gdje treba FK koji bazom dokazuje da projekat/mašina pripada
tom tenant-u.

### `work_entries` — radni i pauza segmenti

Svaki red je jedan segment sa `id`, `company_id`, `workday_id`, `worker_id`, `kind`
(`WORK` | `BREAK`), `started_at`, `ended_at`, `project_id`, opciono `machine_id`, `note`,
autorom i verzijom. `company_id` i `worker_id` na segmentu moraju kompozitnim FK-om odgovarati
zaglavlju; projekat i mašina, ako su prisutni, moraju pripadati istoj firmi.

- `WORK` traži projekat; mašina i kratka napomena su opcionalni. `BREAK` ne nosi projekat ni
  mašinu.
- Zatvoren segment mora imati `ended_at > started_at`. Dozvoljeni su susjedni segmenti
  (npr. prvi završi tačno kad drugi počne).
- Baza zabranjuje preklapanje segmenata istog radnika kroz sve projekte, uređaje i vrste
  segmenta. Predložena zaštita je exclusion constraint nad firmom, radnikom i
  `tstzrange(started_at, ended_at, '[)')`. `ended_at IS NULL` je neograničen kraj aktivnog
  segmenta; jedan radnik ne može imati dva otvorena segmenta.
- Ako `btree_gist` nije dostupan, fallback mora biti transakcijski triger sa advisory lockom,
  istim dokazom kao R3; aplikacijska provjera sama nije dovoljna za paralelna dva telefona.
- Projekat/mašina iz druge firme se odbija kao sigurnosna greška. Projekat ili mašina koji su
  istekli/neaktivni ili za koje nema trenutne R3 dodjele ne odbijaju se kao činjenica već obavljenog
  rada — red se sačuva i označi za ured. Isto važi za istekli R3 uslov/obavezu.

Trajanje se izvodi iz segmenata. R4 ne obračunava satnicu, noćni/prekovremeni rad, zaradu ni novac.

### Sukobi i dozvole za offline unos

`sync_conflicts` čuva najmanje `id`, `company_id`, `actor_id`, `local_id`, vezu na postojeći
`workday`/`work_entry` ako postoji, vrstu sukoba, **originalni primljeni payload**, serversku
verziju, stanje `OPEN/RESOLVED`, ko/kada/zašto je razriješio. Konflikt nije zamjena za kanonski red:
ured ga vidi, a promjena se ne primjenjuje dok pravilo sukoba ne kaže drugačije. Originalni payload
se ne odbacuje zbog timeouta, promjene verzije ili exclusion greške.

`sync_receipts` bilježi `(company_id, actor_id, local_id)`, payload hash, ishod i vraćene server ID-
e/verzije. Ta kombinacija je jedinstvena; receipt ostaje dovoljno dugo da retry nakon timeouta vrati
isti rezultat. Konflikti i receipts imaju tenant RLS i nisu globalno čitljivi.

Šefov offline pristup ne može se zasnivati samo na listi koju klijent sam pošalje. Pri pull-u server
izda `foreman_scope_snapshot_id` vezan za firmu i šefa; neizmjenjivi serverski snapshot bilježi
tačan skup `(project_id, worker_id)` koji je šef u tom trenutku smio unositi, ko ga je izdao i kada.
Pri push-u server provjerava ID i par na snapshotu:

- Ako je par bio u snapshotu, ali je R3 dodjela uklonjena/promijenjena prije sync-a, stvarni rad se
  prihvata i označava `SCOPE_CHANGED_OFFLINE` za ured.
- Ako par nikad nije bio u tom šefovom snapshotu, šef ne može napraviti kanonski tuđi zapis.
  Stavka ostaje na telefonu i dobija jasan ishod za ovlaštenog korisnika/ured; ništa se tiho ne
  briše.
- Snapshot je serverski potpisan ili pohranjen i vezan za korisnika/firmu; klijent ga ne može
  izmišljati. Predloženi rok čuvanja dokaza je 90 dana. Nakon isteka dokaza, sadržaj se čuva kao
  `UNVERIFIED_FOREMAN_SCOPE` za uredsku provjeru, ne kao automatski autorizovan kanonski unos.
- Radnik može sam prijaviti vlastiti stvarni rad i na nedodijeljenom projektu. Takav red se
  prihvata i označi, ali samo za projekat u istoj firmi.

Ovo je pravilo ko smije unositi tuđi red, a ne presuda da li se rad desio. Šefov izbor u aplikaciji
koristi zadnji serverski snapshot; konačnu autorizaciju uvijek radi server.

## 3. Statusi, verzije i šta se smatra sukobom

U R4a, `DRAFT` je sadržaj koji se može popravljati uz novu verziju; `SUBMITTED` znači „poslano na
pregled ureda“, ne znači da je ured odobrio niti da je sedmica zaključana. Politika izmjene već
poslanog reda (reopen, nova verzija ili zabrana do R4b) je otvoreno pitanje vlasniku; prijedlog je
bez tihog editovanja, uz eksplicitnu verziju i audit.

- Novi offline dan šalje se sa lokalnim ID-em i `base_version = 0`; server vraća svoj `workday_id`
  i prihvaćenu verziju.
- Izmjena postojećeg dana nosi zadnji preuzeti `base_version`. Ako se verzija ne poklapa, server
  vraća `conflict`, aktuelnu verziju/kursor i čuva primljeni payload. Nema last-write-wins.
- Preklapanje radnika i šefa **nije merge**. Već prihvaćeni segmenti ostaju kanonski; preklopljeni
  segment ostaje u `sync_conflicts` sa vezom na postojeći red. Ured vidi obje tvrdnje.
- Različiti lokalni dani istog radnika/datuma i ponovljeni sadržaji su mogući; ne spajaju se tiho.
  Dobijaju oznaku duplikata i čekaju ljudsku odluku.
- Svaka stavka iz batcha ima zaseban ishod. Konflikt jedne stavke ne poništava druge ispravne
  stavke iz istog zahtjeva.

## 4. Push protokol (v2)

`POST /api/sync/v2/push` nosi verziju protokola i listu nezavisnih stavki. Tenant dolazi iz
sesije, nikad iz tijela zahtjeva. Svaka stavka sadrži najmanje:

- `local_id` — UUID napravljen na uređaju prije slanja; idempotency ključ je
  `(company_id, actor_user_id, local_id)`. `device_id` služi za audit/dijagnostiku, ne mijenja
  identitet zahtjeva;
- `workday_id` ako je server već dodijelio ID, lokalni ID zaglavlja, `base_version` i promjene
  zaglavlja/segmenata;
- `device_sent_at` — sat uređaja u trenutku slanja; vremena rada su odvojena polja događaja;
- `foreman_scope_snapshot_id` kada šef unosi za druge;
- verziju klijentskog protokola.

Server validira oblik, granice i sva polja batcha prije prvog upisa; zatim svaku stavku obrađuje
u zasebnoj transakciji. Ponovljen `local_id` sa istim payload hashom vraća isti rezultat i server
ID, bez duplikata. Ponovljen `local_id` sa drugim payloadom vraća `LOCAL_ID_REUSE`, ne prepisuje
prvi zahtjev. Receipt/rezultat idempotentnosti čuva se serverski.

`base_version` mismatch vraća sukob bez izmjene kanonskog reda. Exclusion greška se hvata tako da
se preklopljeni segment i originalni payload zapišu u `sync_conflicts` bez gubitka stavke ili
rollbacka drugih stavki. Aplikacija ostavlja konflikt lokalno dok ga korisnik/ured ne razriješi.

## 5. Pull, cursor i tombstones (v2)

`GET /api/sync/v2/pull?cursor=<opaque>&limit=<n>` vraća:

```text
{ items: [...], nextCursor: "...", hasMore: true|false }
```

Cursor nije sat telefona ni samo `updated_at`. Predloženi server model je `sync_change_log` po
firmi i interni `company_sync_cursors` red sa zadnjim brojem. Svaka prihvaćena promjena i njen log
zapis nastaju u istoj transakciji. Transakcija prvo zaključava cursor red firme (`FOR UPDATE`),
dodijeli sljedeći broj i drži zaključavanje do commita; tako kasniji broj ne može postati vidljiv
prije ranijeg commita, što izbjegava rupu koju obična sekvenca može napraviti pri konkurentnim
commitima. Cursor koji se vraća klijentu je opaque, verzionisan i vezan za firmu.

Svaki insert/update/brisanje emituje log događaj sa entitetom, ID-em, verzijom i payloadom ili
tombstoneom. Klijent primjenjuje cijelu stranicu i `nextCursor` u jednoj SQLite transakciji; cursor
pomjeri tek kad su svi redovi stranice upisani. Prekid ponavlja stranicu bez preskakanja ili
dupliranja. `hasMore` omogućava dohvat sljedeće stranice.

Tombstone sadrži entitet, ID, verziju i vrijeme brisanja; povrat cursor-a preko tombstonea nikad ne
vraća obrisani red. Predloženo zadržavanje je 90 dana. Cursor stariji od retention-a vraća
`CURSOR_EXPIRED` i traži punu obnovu serverovog cache-a, ali nikad ne briše lokalni outbox ili
nerazriješene konflikte. Brisanje radnog dana/segmenta u R4a ne smije biti fizičko brisanje bez
tombstonea; tačni statusi za poništavanje potvrđuju se prije implementacije.

Postojeći R0 `since`/timestamp protokol ostaje odvojen i kompatibilan sa note entitetom tokom
prijelaznog perioda; ne pretvara se u cursor v2 bez migracije klijenta.

## 6. Vremena, zona i otvoren dan

Vremena događaja šalju se u RFC 3339 formatu sa eksplicitnim UTC offsetom i čuvaju kao apsolutni
`TIMESTAMPTZ`. Aplikacija prikazuje lokalno vrijeme po `companies.timezone`, a ne po zoni telefona.
Ako je lokalno vrijeme nepostojeće ili dvosmisleno zbog prelaza ljetno/zimsko računanje vremena,
klijent traži izbor/razjašnjenje offseta prije slanja; server ne nagađa. Poslovni `work_date` se
određuje iz početka rada u zoni firme i ostaje zabilježen i ako firma kasnije promijeni zonu.
Prelazak ponoći ostaje jedan radni dan prema datumu početka (22:00–02:00 se ne cijepa).

Čuvaju se tri različita vremena:

1. vrijeme događaja koje je radnik unio (`started_at`/`ended_at`);
2. `device_sent_at`, sat uređaja u trenutku slanja;
3. `server_received_at`, koji postavlja server.

Sat se provjerava poređenjem `device_sent_at` i `server_received_at`, ne početka rada i prijema:
telefon može biti offline danima. Ako je apsolutna razlika veća od predloženog praga **5 minuta**,
zapis se prihvata i označi „sat uređaja odstupa“; vrijeme rada se ne prepisuje.

Dan je otvoren dok postoji segment bez `ended_at`. Ne zatvara se na ponoć. Ako je otvoren duže od
predložene granice **16 sati od početka prvog segmenta**, označi se za ured; ne izmišlja se vrijeme
završetka i ne prikazuje se nula sati. Granice 5 minuta i 16 sati su predloženi defaulti, čekaju
potvrdu vlasnika.

## 7. Sesija, SQLite migracije i privatnost

SQLite ima sopstveni `PRAGMA user_version`. Prva migracija mora prepoznati postojeću bazu bez
postavljenog `user_version` (R0 `notes`, `sync_meta`, `projects_cache`, `obligations_cache`),
sačuvati sve redove i tek onda dodati R4 outbox, radne dane, segmente, scope snapshot, konflikte i
cursor. Migracija se izvršava transakcijski, pravi/čuva backup prije promjene i podiže verziju tek
nakon uspjeha. Ako padne, rollback i jasna poruka; nema tihog resetovanja baze ni `DROP`-a postojećih
tabela. Lokalni `local_id`, neposlani redovi, cursor i konflikti moraju preživjeti sve podržane
verzije aplikacije.

- Outbox je vezan za `company_id` i `user_id` koji su ga napravili; promjena naloga ne smije ga
  poslati kao drugog čovjeka. Poslije ponovne prijave šalje ga samo prvobitni korisnik.
- Istek sesije/odjava ne briše neposlane stavke. Prije odjave aplikacija pokaže broj i traži
  izričitu potvrdu; „Odustani“ ostavlja sesiju i red netaknute. Potvrđena odjava i dalje čuva red
  lokalno i označi ga kao red koji čeka prvobitni nalog.
- Stara R0 outbox stavka bez pouzdano sačuvanog owner-a ne šalje se automatski pod novom sesijom;
  aplikacija traži potvrdu prvobitnog naloga ili ostavlja stavku na sigurnom čekanju.
- Server ima minimalnu podržanu v2 verziju protokola. Nepodržan klijent dobija `APP_UPDATE_REQUIRED`;
  lokalni podaci se ne odbacuju da bi aplikacija nastavila.
- Lozinke, hash lozinke i auth tokeni ne ulaze u SQLite; token ostaje u SecureStore. Lokalno se
  čuvaju samo polja potrebna za unos/pregled. Prije pilota se potvrđuje politika OS backup-a,
  zaključavanja i zaštite lokalnog fajla; GPS i fotografije nisu dio R4.
- Offline red ostaje na uređaju do serverove potvrde. Retry nakon timeouta koristi isti `local_id`.

## 8. RLS, privilegije i migracijski rollout

R4 nasljeđuje least-privilege model iz ADR 0013 i matrice
`packages/db/preflight-checks/privilege-matrix.tsv`:

- Svaka nova tenant tabela nosi `company_id`, ima RLS i tenant politiku; predloženo je
  `ENABLE` + `FORCE ROW LEVEL SECURITY`. To uključuje `workdays`, `work_entries`,
  `sync_conflicts`, `sync_receipts`, `foreman_scope_snapshots`, `sync_change_log`, interni
  `company_sync_cursors` i R4b `workday_revisions`.
- Prije deploya migracije, `privilege-matrix.tsv` se dopunjava sa `needed`, prethodno zatečenim
  `current_before`, razlogom za eventualni non-RLS objekat i obrazloženjem. Preflight mora proći
  na praznoj i popunjenoj bazi; nepoznat objekat, nedostajući RLS/policy, manjak ili višak prava
  zaustavlja start.
- Aplikacijska prava su samo potrebni `SELECT/INSERT/UPDATE`; fizički `DELETE` se ne daje dok
  poslovni tok i tombstone ne opravdaju tačno pravo. `company_sync_cursors` ne dobija direktni app
  ACL ako se može pisati kroz pregledani trigger; `sync_change_log` app čita samo za pull, a upis
  vrši trigger/funkcija u istoj transakciji. SECURITY DEFINER je dozvoljen samo za uski, pregledani
  interni helper, sa zatvorenim `search_path` i bez direktnog `EXECUTE` prava aplikaciji.
- V1 `sync_items` i R0 note API se ne brišu u R4a. Migracije su naprijed-samo i aditivne; migrator
  koristi `DATABASE_ADMIN_URL`, a runtime preflight isključivo `DATABASE_URL`.

**Rollout R4a:** backup → aditivna migracija i grants → preflight kao app rola → server sa v1 i v2
putanjama (v2 feature flag ugašen) → test na staging telefonu → uključenje R4a za pilot. R4b ima
zasebnu kasniju migraciju i zasebno odobrenje.

**Rollback R4a:** isključiti feature flag i vratiti prethodni web/mobile image ako treba; ne brisati
nove tabele, ne prazniti lokalne outboxe i ne vraćati stari široki `GRANT ALL`. V1 note sync ostaje
netaknut. R4 redovi ostaju sačuvani za nastavak nakon popravke. Povratni kod ne smije pozivati R4
rute; schema rollback nije uslov za image rollback.

## 9. R4a — unos, sync i pregled ureda

R4a isporučuje:

- `workdays`, `work_entries`, scope snapshot, v2 idempotency receipt, conflict store i change log;
- radnik unosi svoj rad offline; šef grupe bira radnike iz zadnjeg serverskog scope snapshot-a i
  može unijeti grupu offline;
- SQLite outbox, `local_id`, `base_version`, push rezultat po stavci, pull cursor/tombstones i
  migraciju iz trenutne R0 baze;
- uredski pregled primljenih dana, segmenata, autora, verzija, sukoba i oznaka za provjeru
  (nedodijeljen/neaktivan projekat, istekla obaveza, promijenjen scope, odstupanje sata, otvoren
  predugo). U R4a nema odobravanja ni zaključavanja;
- audit ko je šta unio/izmijenio/razriješio. UI ne predstavlja problematičan rad kao odbijen niti
  tiho skriva sukob.

**Kapija R4a:** CI simulator i DB/API/SQLite testovi su zeleni; preflight i privilege matrica
prolaze; vlasnik prođe dogovorene tokove na stvarnom telefonu i izričito prihvati R4a. Tek tada se
odobrava plan i početak R4b.

## 10. R4b — potvrda, sedmično odobrenje i ispravke

Predloženi tok, čeka odobrenje vlasnika:

`SUBMITTED` → `FOREMAN_CONFIRMED` → `WEEK_APPROVED` → `LOCKED`.

- Šef potvrđuje dan; ured odobrava sedmicu. Predložena sedmica je ponedjeljak–nedjelja po zoni
  firme; sedmica, odgovorna uredska rola i trenutak automatskog zaključavanja moraju se potvrditi.
- R4b dodaje potvrdu/odbijanje sa razlogom, sedmični pregled i listu dana otvorenih duže od
  firmine granice `X` sati. Nema automatskog završetka segmenta ili izmišljenog vremena.
- Poslije `LOCKED` originalni sadržaj se ne prepisuje. Ispravka je nova `workday_revision` sa
  obaveznim razlogom, autorom, vremenom, referencom na prethodnu verziju i auditom.
- Konflikt se ne rješava last-write-wins; ovlašteni ured bira/koriguje uz razlog, a oba izvorna
  payload-a ostaju pregledljiva.
- Maestro pokriva samo nekoliko završnih tokova na uređaju; nije glavni dokaz CI ispravnosti.

## 11. Dokaz ispravnosti u CI-ju

Glavna poslovna logika sync-a je čist modul, odvojen od Reacta i stvarne mreže. Deterministički
simulator sa fiksnim seed-om ubacuje prekide prije/poslije slanja, duplikate, promjenu redoslijeda,
zakašnjele odgovore, paralelne uređaje i radnika/šefa. Obavezni dokazi:

1. Retry istog `(company_id, actor_id, local_id, payload_hash)` daje tačno jedan rezultat; promjena
   payloada uz isti ID se odbija.
2. `base_version` mismatch je sukob, bez last-write-wins i bez tihog mergea.
3. Preklop radnika/šefa i dupli dan ostaju vidljivi kao sukobi; ništa ne nestaje.
4. Prekid pull-a ne preskače niti duplira stranice; cursor se pomjera tek sa atomskim SQLite upisom;
   tombstone ne oživljava obrisani red.
5. Foreman snapshot koji je bio važeći prihvata se nakon naknadne promjene R3 dodjele uz oznaku;
   par koji nikad nije bio u snapshotu ne postaje kanonski zapis.
6. Rad na nedodijeljenom/neaktivnom projektu ili uz istekli R3 uslov čuva se i označava, ne odbija
   se kao poslovna činjenica.
7. Pogrešan sat se označi po `device_sent_at`/`server_received_at`; vrijeme događaja se ne prepravlja.
8. Odjava, istek sesije, ponovna prijava drugog korisnika i SQLite migracija ne brišu red i ne šalju
   ga pod pogrešnim identitetom.
9. DST proljeće/jesen, prelazak ponoći, otvoren segment i prag od 16 sati imaju testove.
10. PostgreSQL testovi provjeravaju RLS i direktne upite za čitanje/pisanje iz dvije firme, prava
    iz matrice, tombstone, exclusion (i fallback ako je podržan), te normalne poslovne tokove.
11. Postojeći login, pozivnica, reset lozinke i promjena lozinke ostaju zeleni; R4 ne širi pristup
    `schema_migrations`, `platform_users` ni `password_hash` izvan odluke ADR 0013.

Maestro na stvarnom telefonu pokriva radnik offline → slanje nakon povratka mreže, šef grupno unese
offline, app se zatvori/otvori, i prikaz konflikta. Glavni deterministički dokaz ostaje simulator.

## 12. Izričito van R4

| Šta | Zašto |
|---|---|
| **Faze projekta** | R4 koristi projekat iz R3; ne pravi novi model faza. |
| **Šifrarnik zadataka** | slobodna napomena je dovoljna za pilot. |
| **Fotografije i prilozi uz dan** | van pilotnog opsega; nema upload reda. |
| **Obračun zarade, satnice i novac** | zahtijeva zasebna pravila i odobrenje. |
| **GPS/geofencing** | privatnost i van dogovorenog pilota. |
| **Ture, gorivo, dnevni pregled mašine** | zaseban budući rez. |
| **Automatsko zatvaranje otvorenog dana** | izmišljalo bi činjenicu; dan ostaje otvoren i ide na pregled. |
| **Pozadinska sinhronizacija kao garancija** | OS može odgoditi/ukinuti posao; foreground sync je obavezan fallback. |

## 13. Pitanja vlasniku — odgovor i odobrenje prije koda

1. **Ko unosi dan?** Radnik svoj, šef grupu ili oboje? Predlog: oboje; šef samo za parove iz
   serverskog R3 snapshot-a. Koliko radnika/šefova je u pilotu?
2. **Ko potvrđuje/odobrava?** Predlog: šef potvrđuje dan, ured odobrava sedmicu. Koja je tačno
   uredska rola i je li sedmica ponedjeljak–nedjelja?
3. **Šta znači `SUBMITTED` u R4a?** Predlog: ured vidi poslano, ali nema odobrenja; vlasnik bira da
   li autor smije otvoriti novu verziju prije R4b.
4. **Dupli dan:** prihvatiti odvojene zapise uz obaveznu oznaku i ljudsko razrješenje (predlog), ili
   zahtijevati jedan kanonski dan?
5. **Offline dokaz šefa:** potvrditi serverski snapshot, predloženo čuvanje 90 dana, i ponašanje kad
   dokaz istekne (uredska provjera, bez gubitka lokalnog unosa).
6. **Pragovi:** potvrditi sat `5 min`, otvoren dan `16 h`, tombstone/cursor retention `90 dana`.
7. **Vrijeme i privatnost:** potvrditi izbor offseta za dvosmislen DST sat, politiku lokalne baze/
   OS backup-a i koliko dugo ured čuva konfliktni payload.
8. **Postojeći note sync:** potvrditi da v1 `/api/sync/*` ostaje tokom prijelaza i odrediti minimalnu
   podržanu mobilnu verziju prije eventualne deprecijacije.

Dok vlasnik ne odgovori i izričito ne odobri ovaj plan, R4 ostaje dokumentacija. Nema R4 migracije,
API-ja, SQLite izmjene, UI-ja, seed-a ni implementacijskog koda.
