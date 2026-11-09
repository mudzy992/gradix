# PLAN R4 — radni dani, terenski unos i offline sinhronizacija

**Status:** revidirani predlog, čeka odobrenje vlasnika. **Nema R4 koda prije odobrenja.**
Ulaz: R3 zatvara projekte, dodjele i opsege. R4 uvodi dnevnu evidenciju rada sa telefona, uključujući
unos šefa grupe bez mreže. Ovaj dokument je plan, ne odluka o početku implementacije.

## 1. Granice i podjela

R4 je samo evidencija stvarno unesenog rada: ko, kad, na kojem projektu i u kojem vremenskom
segmentu. Ne pravi raspored i ne prepravlja R3 dodjele.

Rad se dijeli na dvije isporuke, sa **kapijom između**:

- **R4a — unos i prenos:** radnik i šef grupe unose offline; red ostaje na telefonu; push/pull
  sinhronizuju podatke i sukobe; ured vidi unesene dane i oznake za provjeru.
- **R4b — potvrda i zatvaranje:** šef potvrđuje dan; ured odobrava sedmicu; zaključavanje,
  ispravke kao revizije i lista dana koji su predugo otvoreni. R4b ne počinje dok vlasnik ne prođe
  i ne prihvati R4a.

Pozadinska sinhronizacija nije pouzdana ni na iOS-u ni na Androidu. Red se šalje kad se aplikacija
otvori i na „Pošalji sada“; background job je dodatak, ne uslov da podaci stignu.

## 2. Model podataka

### `workdays` — zaglavlje

Jedan zapis nosi radnika, poslovni datum i stanje dana. Identitet je `id`; **nema**
`UNIQUE (company_id, worker_id, work_date)` ni kolone `source`. Različiti klijenti mogu imati
zasebne lokalne zapise za isti radnik/datum; sistem ih ne spaja tiho, nego koristi verzije i
evidenciju sukoba.

| polje | svrha |
|---|---|
| `id`, `company_id` | identitet i tenant |
| `worker_id`, `work_date` | osoba i poslovni datum po zoni firme |
| `status` | R4a: `DRAFT` → `SUBMITTED`; R4b dodaje potvrdu, sedmično odobrenje i zaključavanje |
| `version` | optimistic concurrency; svaki prihvaćeni sadržajni upis podiže verziju |
| `created_by`, `updated_at` | ko je unio/izmijenio i kad je server obradio promjenu |

### `work_entries` — vremenski segmenti

Svaki red je jedan **radni** ili **pauza** segment: `id`, `workday_id`, `worker_id`, `kind`
(`WORK` | `BREAK`), `started_at`, `ended_at`, `project_id`, opciono `machine_id` i slobodna
`note`. Projekat je obavezan za `WORK`; `BREAK` pripada istom danu i ne nosi mašinu. Kraj može
privremeno biti prazan dok segment traje.

Baza zabranjuje preklapanje vremenskih segmenata istog radnika, bez obzira na projekat ili izvor
unosa. Predložena zaštita je exclusion constraint nad `worker_id` i `tstzrange(started_at, ended_at,
'[)')`; susjedni segmenti (kraj u 10:00, početak u 10:00) su dozvoljeni. Aplikacijska provjera
nije dovoljna za istovremene telefone.

Prelazak ponoći ostaje **jedan `workday`** pod datumom početka. Primjer 22:00–02:00 ne cijepa se
u dva datuma. Vrijeme se tumači po `companies.timezone`, ne po zoni telefona. Trajanja se izvode iz
segmenata; R4 ne obračunava zaradu, noćni/prekovremeni rad niti novac.

## 3. Ko smije unositi i kako se čuva istina

- **Radnik** unosi svoj dan i svoje segmente offline.
- **Šef grupe** unosi grupu offline, ali samo za radnike koji su dodijeljeni projektu/projektima
  unutar njegovog R3 opsega. Lista izbora i serverska autorizacija koriste postojeće R3 dodjele;
  šefov unos nikad ne pravi niti mijenja R3 dodjelu. Ovo pravilo mora imati eksplicitan test:
  šef može unositi dodijeljene radnike na svom projektu, a ne može unositi za radnika van tog
  skupa ili za projekat van svog opsega.
- Granica iznad je **ovlaštenje ko smije unositi tuđi red**, a ne provjera da li je rad „dozvoljen“.
  Radnik može evidentirati stvarni rad na projektu kojem trenutno nije dodijeljen; zapis se
  **prihvata** i dobija oznaku za ured. Ako ljekarski ili druga R3 obaveza istekne, evidentirani
  rad se takođe **prihvata** i označava. R3 blokira novu dodjelu, ne briše niti odbija činjenicu da
  se rad desio. Oznake idu u pregled ureda, ne u odbijanje sinhronizacije.
- Šefov lokalni izbor dolazi iz posljednje povučene R3 liste dodjela. Ako je radnik bio u toj listi
  kad je unos napravljen offline, pa je dodjela istekla/uklonjena prije sync-a, server **prihvata
  činjenicu rada i označava je za ured**; ne gubi red zbog promijenjenog statusa dodjele. Ako radnik
  nikad nije bio u šefovom R3 opsegu, šef nema ovlaštenje da šalje tuđi zapis; radnik i dalje može
  sam prijaviti stvarni rad, koji se prihvata i označava. Tačan dokaz je dio
  simulatora u §9.
- Preklapanje unosa radnika i šefa **nije merge**: drugi segment ne ulazi u kanonski `work_entries`
  jer bi prekršio zabranu preklapanja. Njegov izvorni payload i `local_id` ostaju sačuvani u
  `sync_conflicts`, vezani za postojeći segment; ured vidi oba zapisa i čeka ljudsku odluku. Nijedan
  pokušaj ne nestaje i nijedna novija verzija ne prepisuje tiho stariju.

**Online-only su samo:** izmjena već poslanog tuđeg dana i odobravanje. Grupni unos šefa nije
online-only; mora se moći napraviti i sa ugašenom mrežom.

## 4. Push protokol

`POST /api/sync/push` prima listu nezavisnih stavki. Svaka stavka nosi najmanje:

- `local_id` — UUID napravljen na uređaju prije slanja, jedinstven po `(company_id, user_id)`;
- `workday_id` / privremeni lokalni ID zaglavlja i promjene `work_entries`;
- `base_version` — verzija koju je klijent posljednju preuzeo;
- `device_sent_at` — sat uređaja u trenutku slanja (nije vrijeme kad je čovjek radio);
- sadržaj unosa i njegova vremena događaja.

Server procesuira stavke zasebno i vraća ishod po stavci. Isti `local_id` ponovljen nakon timeouta
vraća isti serverski ishod i ne pravi duplikat. Ako `base_version` ne odgovara trenutnoj verziji,
server odbija izmjenu kao `conflict`, vrati aktuelnu verziju/kursor i ne prepisuje podatak. Klijent
ostavlja stavku u redu dok korisnik ne razriješi sukob ili ne povuče novije stanje.

Za dvije stavke koje se vremenski preklapaju, čak i kad su iz različitih telefona ili jedan unosi
radnik a drugi šef, server ne spaja redove. Konflikt se čuva kao zaseban ishod za ured; nijedna
ispravna stavka iz batcha ne smije nestati zato što je druga u sukobu.

## 5. Pull protokol i brisanja

`GET /api/sync/pull?cursor=<opaque>&limit=<n>` vraća promjene poslije kursora:

```text
{ items: [...], nextCursor: "...", hasMore: true|false }
```

Kursor je opaque i monotoni redoslijed serverskog change-loga po firmi, ne klijentski sat niti samo
`updated_at` (timestampi se mogu poklopiti, a sat klijenta može biti pogrešan). Svaki insert/update
ima promjenu u logu; brisanje emituje **tombstone** sa entitetom, ID-em, verzijom i vremenom
brisanja. Tombstone se čuva dok ga svi aktivni uređaji ne potvrde ili dok ne istekne definisani
retention period; povrat kursora preko tombstonea nikad ne oživljava obrisani red.

Klijent primjenjuje cijelu stranicu i `nextCursor` u jednoj SQLite transakciji. Kursor se pomjeri
tek nakon uspješnog upisa svih stavki; prekid usred pull-a ponavlja stranicu bez dupliranja.

## 6. Sat telefona i server

Čuvamo vrijeme događaja koje je čovjek unio, vrijeme uređaja pri slanju (`device_sent_at`) i
`server_received_at` koje postavlja server. Sat se provjerava poređenjem `device_sent_at` i
`server_received_at`, **ne** vremena početka rada: uređaj može biti offline danima pa bi poređenje
početka rada pogrešno protumačilo normalan offline red kao pokvaren sat.

Ako je razlika preko praga, zapis se čuva i označava „sat uređaja odstupa“ za ured; vrijeme se ne
prepisuje i unos se ne odbija. Prag je konfiguracija po firmi; **predloženo početno podešenje je
5 minuta**, potvrđuje se odobrenjem ovog plana.

## 7. Sesija, odjava i lokalna SQLite baza

- Istek sesije ili odjava **ne briše** neposlane redove. Prije odjave aplikacija jasno prikaže broj
  neposlanih stavki i traži izričitu potvrdu; „Odustani“ ostavlja sesiju i red netaknute.
- Redovi su vezani za firmu i korisnika koji ih je napravio. Nakon ponovne prijave mogu se poslati
  samo pod tim identitetom; promjena naloga ne smije ih poslati kao drugu osobu niti ih izbrisati.
- SQLite ima svoj `user_version`. Svaka verzija aplikacije nosi uzastopnu migraciju šeme koja se
  izvršava transakcijski. Migracija prvo čuva/backupira postojeći outbox, pa mijenja strukturu; ne
  briše `local_id`, čeka-redove ni konflikte. Ako migracija ne uspije, rollback i jasna poruka —
  nema tihog resetovanja baze.
- Protokol klijenta ima minimalnu podržanu verziju. Server odbija nepodržan protokol porukom
  „Ažurirajte aplikaciju“; aplikacija ne odbacuje lokalne podatke da bi nastavila.

## 8. Otvoren radni dan — bez pravila ponoći

Dan se smatra otvorenim dok postoji aktivan segment bez `ended_at`. Nije vezan za ponoć: noćna
smjena koja pređe datum ostaje normalna. Ako je dan otvoren duže od `X` sati od početka prvog
segmenta, označi se za provjeru i pojavi se u listi ureda; nema izmišljenog vremena završetka i dan
se ne prikazuje kao nula sati.

`X` je podesiv po firmi, **zadano 16 sati**. R4b jutarnji tok pita radnika/šefa kad je posao završen
ili označi „ne sjećam se“; bez odgovora ured vidi otvoreni dan. Ne zatvara se automatski.

## 9. Podjela i dokaz

### R4a — unos + offline + sync + pregled ureda

- Zaglavlje `workdays` i segmenti `work_entries`; radnik i šef unose bez mreže.
- SQLite outbox, `local_id`, `base_version`, push rezultati po stavci, pull kursor i tombstones.
- Ured vidi primljene dane, audit ko je šta unio, konflikte i oznake za provjeru (nedodijeljeni
  projekat, istekla obaveza, odstupanje sata). Nema odobravanja/zaključavanja u R4a.
- Kapija: simulator u CI-ju zelen; vlasnik prođe nekoliko dogovorenih tokova na telefonu i odobri
  R4a. Tek onda se planira/počinje R4b.

### R4b — potvrda, odobrenje, zaključavanje i ispravke

- Predloženi tok (zadano vlasnika): šef potvrđuje svaki dan; ured odobrava sedmicu.
- `SUBMITTED` → `FOREMAN_CONFIRMED` → `WEEK_APPROVED` → `LOCKED`.
- Poslije zaključavanja se originalni red ne mijenja: nova revizija sa obaveznim razlogom, autorom,
  vremenom i vezom na prethodnu verziju. Lista dana otvorenih duže od firmine granice `X` sati.
- Maestro je samo pomoć za nekoliko tokova koje vlasnik prođe na svom uređaju; nije glavni CI dokaz.

### Glavni dokaz u CI-ju — čist sync modul + simulator mreže

Poslovna logika sinhronizacije je čist modul bez baze, Reacta i mreže. CI simulator koristi
reproducibilno sjeme i nasumično ubacuje prekide prije/poslije slanja, duplikate `local_id`,
promjenu redoslijeda, zakašnjele odgovore, dva klijenta i dva korisnika (radnik/šef). Tvrdi:

1. retry istog `local_id` pravi tačno jedan zapis;
2. `base_version` mismatch je konflikt, bez last-write-wins i bez tihog mergea;
3. overlap radnik/šef ostaje vidljiv sukob;
4. pull cursor nakon prekida ne preskače ni ne duplira; tombstone briše lokalni red;
5. unos nedodijeljenog rada/istekle obaveze se prihvata i nosi oznaku za ured;
6. lokalni outbox preživljava logout/istek sesije i migraciju SQLite šeme;
7. pogrešan sat se označi, ali se vremenski podatak ne prepravlja.

Maestro na uređaju pokriva samo nekoliko završnih tokova: radnik unosi offline, šef unosi grupu
offline, vraćena mreža sinhronizuje jednom, i korisniku se pokaže sukob. Glavni dokaz ispravnosti
ostaje simulator u CI-ju.

## 10. Izričito van R4

| Šta | Zašto |
|---|---|
| **Faze projekta** | nisu dio R4 modela; samo projekat iz R3. |
| **Šifrarnik zadataka** | slobodna napomena je dovoljna za pilot. |
| **Fotografije i prilozi uz radni dan** | van opsega R4; nema upload reda za ove zapise. |
| **Obračun zarade, satnice i novac** | van evidencije R4; traži posebna pravila i odobrenje. |
| **GPS/geofencing** | privatnost i van dogovorenog pilota. |
| **Ture, gorivo, dnevni pregled mašine** | zaseban budući rez. |
| **Automatsko zatvaranje otvorenog dana** | izmišljalo bi činjenicu; dan ostaje otvoren i ide na pregled. |

## 11. Pitanja vlasniku — odgovori čekaju, kod ne počinje

1. **Ko upisuje radni dan?** Radnik sam, šef grupe za sve ili oboje (i ko je vlasnik zapisa)?
   **Zadano u ovom predlogu: oboje** — radnik svoj dan, šef grupu samo u R3 dodijeljenom opsegu.
2. **Ko odobrava?** Šef gradilišta, rukovodilac projekta ili ured; po danu ili sedmici?
   **Zadano u ovom predlogu: šef potvrđuje dan, ured odobrava sedmicu.**
3. **Koliko radnika ima telefon u pilotu?** To mijenja koji unos je najčešći; grupni unos šefa ipak
   mora raditi offline. **Broj čeka tvoj odgovor.**

Dok ne odobriš ovaj plan i ne odgovoriš na tri pitanja, R4 ostaje dokumentacija — nema R4 migracije,
API-ja, SQLite promjene ni ekrana.
