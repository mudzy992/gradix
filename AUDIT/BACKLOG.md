# Backlog i stabilizacijski red

Izvorni dnevnik sačuvan je bez izmjena u [historiji](history/STATE-2026-11-05.md); nalazi
su u [ledgeru](CI-05-LEDGER.md) i [izvještaju](segments/CI-05.md). S-red vodi aktuelne
grupe preostalog rizika; historijski indeks je sljedivost navoda, **ne** tvrdnja da je
svaki stari navod i dalje aktuelan. Granice dashboarda slijede pravilo vlasnika 2026-11-05.

## Novac i decimalne vrijednosti

- **BL-001 — visoko, djelimično, F-CI-05-64:** zajednički `parseDecimal` sada odbija
  nenulti ulaz podliven u nulu; druge skale/opsezi i tokovi koji zaobilaze helper ostaju
  otvoreni. Dokaz: `backend/src/common/utils/decimal-input.spec.ts`, `backend/test/erp.e2e-spec.ts`
  i [BE-01](segments/BE-01.md). Radna [inventura](DECIMAL-INVENTORY.md) i 60 parser karakterizacija su dodani, ali direktni Prisma upisi i DTO/PG karakterizacija ostaju otvoreni; postojeći podaci i stari serveri nisu popravljeni. K1 A usvojen (D-058): skala inputa je stroga; rasponi, izvedene vrijednosti i dodatna HTTP/PG karakterizacija ostaju za TEST-01.

## MOB — budući jedinstveni API kontrakt (bez mobile izmjena sada)

- Trip `quantity`/`weighQty`, fuel `liters`, stock i projektne količine: skala 3, npr. `{"quantity":"12.345"}` prihvatljivo, `12.3456` nije. Fuel `unitPrice`, troškovi i satnica: skala 2, npr. `{"liters":"10.125","unitPrice":"2.50"}`; diary `tempMin`/`tempMax` skala 1, npr. `{"tempMin":"-3.5"}`; GPS `lat`/`lng` skala 7, npr. `{"lat":"43.8563000","lng":"18.4131000"}`; `accuracyM` skala 2. Decimalne vrijednosti slati kao string, završne nule dozvoljene. Sync batch s viškom skale vraća HTTP 400 prije bilo kojeg upisa; kod legacy replaya ne mijenjati ključ dok se stanje ne provjeri. D-058 / TEST-01.

## Sesije i autentifikacija

- **BL-002 — visoko, otvoreno, F-FE-06-06 / F-CI-05-29–33:** gubitak odgovora nakon
  rotacije, nepodržani Web Locks, stari tabovi ili kopirani storage mogu dovesti do reuse i
  opoziva legitimnih sesija. Dokaz: `AUDIT/segments/FE-06.md` F-FE-06-06 i CI-05 ledger.
  PG HTTP karakterizacija dvije nezavisne sesije i simuliranog izgubljenog odgovora u BE-02 potvrđuje opoziv druge refresh sesije, ali access JWT ostaje važeći. Web sada djelimično izbjegava retry poslije `fetch` greške odbacivanjem vezanog tokena; crash, kopirani/stari klijenti i storage utrke ostaju otvoreni (FE-15). Prijedlog: proširiti dokaz ograničenja klijentskog ublažavanja i dizajnirati serverski protokol bez slabljenja detekcije krađe; stvarni browser tabovi i dalje nisu dokazani.

## Tenant i prava

- **BL-003 — visoko, trijaža, F-CI-05-40/41/48/52:** prava aktera mogu ostati snapshot,
  nekooperativni pisci ne slijede protokol lockova, dio inline nacrta nije zaštićen pri
  promjeni firme. Dokaz i scenariji: odgovarajući zapisi u ledgeru i historiji. Prijedlog:
  tenant-scope zahtjeva, kontrolisana revizija konteksta i transakcijska provjera prava.

## Idempotentnost i retry

- **BL-004 — visoko, trijaža, F-CI-05-15/57–62:** izgubljen odgovor i gubitak ključa ili
  stari klijenti nisu općenito sigurni; projektni upload i povezivanje nisu atomski. Dokaz:
  ledger i historija. Prijedlog: trajni server-side identitet operacije i oporavak sa
  pohranjenim payloadom, siguran lifecycle objekata i replay/tombstone testovi.

## Konkurentnost i lockovi

- **BL-005 — visoko, trijaža, F-CI-05-65–72:** miješane verzije i vanjski pisci ne moraju
  poštovati redoslijed lockova; timeout i stari podaci ostaju. Dokaz: izvještaj CI-05.
  Prijedlog: dokumentovan protokol zaključavanja po agregatu, ograničeni retry i PG utrke.

## Vremenske zone

- **BL-006 — srednje, trijaža:** datum, lokalna poslovna zona i prelazak dana/mjeseca nisu
  globalno dokazani za sve tokove. Dokaz: F-CI-05-02/03/09 i historijski STATE. Prijedlog:
  zajednički kalendarski tip, eksplicitna zona firme i granični DST testovi.

## FE nacrti i oporavak

- **BL-007 — visoko, otvoreno, F-CI-05-52/55/62:** lokalni nacrti, browser unload, reload,
  promjena sesije i drugi tabovi nisu općenito zaštićeni; memorijski keš nije trajna pohrana.
  Dokaz: ledger i historija. Prijedlog: jedinstven scopeovan životni ciklus nacrta i pokušaja,
  sa svjesnim odbacivanjem i testovima prekida procesa.

## Post-commit efekti

- **BL-008 — visoko, trijaža, F-CI-05-37/39/61/65:** audit i zatvaranje timera mogu zakazati
  nakon primarne transakcije. Dokaz: ledger i historija. Prijedlog: transakcijski outbox,
  idempotentni radnici i monitoring; procijeniti semantiku i potrebu migracije prije primjene.

## Legacy i infrastruktura

- **BL-009 — srednje, trijaža:** ranije pogrešne veze/podaci i miješani deploymenti nisu
  automatski ispravljeni; `GET /api/files` traži auth pa običan `<img>` ne učitava logo.
  Dokaz: F-CI-05-66–72 i historija, otvorena pitanja. Prijedlog: nedestruktivna dijagnostika,
  kontrolisani plan popravke i siguran mehanizam pristupa logotipu.

## Sistemska rješenja

Prijedlozi BL-001–009 su mehanizmi, ne već izvedene izmjene: centralna decimalna validacija;
scoped tenant/prava i revizija; trajni idempotencijski protokol; standardni lock/retry;
kalendarski tip i zona; otporan protokol sesije; zajednički lifecycle FE nacrta; outbox za
post-commit efekte; inventar i nedestruktivan tretman legacy podataka. Za svaku klasu prvo
utvrditi granice i regresije; migracije ili nove zavisnosti traže odgovarajuće odobrenje.

## Audit i CI heuristike

- **BL-010 — srednje, djelimično, F-CI-05-20/21/22/42–44:** env i workflow skeneri
  provjeravaju ograničen tekstualni format; nisu semantički parseri i sami ne dokazuju
  kvalitet pregleda. Dokaz: `scripts/audit/check-audit-gate.mjs` i CI-05 ledger.
  Prijedlog: eksplicitni podržani format, fail-closed provjere i nezavisna verifikacija.

### BL-001 — historijski zapis prije K1 A

**D-058 je zamijenio prijedlog ispod:** vrijednosti s viškom skale sada se odbijaju; mobile ostaje odgođen. Ostatak raspona, historije i testova prati TEST-01.

`POST /trips` prima `quantity` kroz `parsePositiveDecimal`, dok je `Trip.quantity`
`Decimal(12,3)`; `mobile/app/trip/new.tsx` i offline red prosljeđuju unos stringa bez
ograničenja skale. Primjer `1.2345` je trenutno prihvatljiv parseru i pohranom se može
zaokružiti; odbijanje 4. decimale bi promijenilo API za postojeći mobile (i druge) klijente.
**K1:** ne uvoditi takvo odbijanje bez odluke vlasnika. Predložen nedestruktivni prelaz:
izmjeriti postojeće unose bez logovanja osjetljivih podataka, dokumentovati skale, uvesti
kompatibilno upozorenje i ažurirati klijente kada mobile ponovo bude dozvoljen; tek nakon
komunikovanog roka verzionisati/odobriti stroži ugovor. Ostala polja, seed i E2E još
treba iscrpno inventarisati i tabelarno testirati; ovaj primjer nije dokaz cjelovite inventure.

- **BL-011 — visoko, riješeno za dijagnosticirani F-CI-05-73:** instrumentirani run `42169245124`
  prijavio je četiri pada `geo.spec.ts`: testni `FakeDecimal` nema `isZero()`, koju parser
  od `8cac43d` poziva; parser pretvara TypeError u validacijsku grešku. Izolovan test
  lokalno reprodukovao 4 pada, a zamjena lažnog objekta stvarnim Prisma Decimalom i test
  nultih koordinata prolaze 10/10; `c842581` CI `42169764781` je 6/6. Raniji crveni runovi
  nemaju dostupnu dijagnostiku i ne mogu se pojedinačno pripisati ovom kvaru.


## S-red

Veličina S/M/L je gruba inženjerska procjena, ne obećani rok. „Blokira“ znači da se mora
razriješiti ili dokazati neprimjenjivost prije korištenja zahvaćene dashboard putanje;
ostalo se stabilizuje paralelno. Statusi su rizici, ne dokaz eksploatacije.

| Red | ID/grupa i visoki nalazi | Vlasnik | Procjena | Veza s dashboardom / slijed |
|---|---|---|---|---|
| S-01 | BL-002, F-FE-06-06, F-CI-05-27–33/35/36/47/50 | BE-02, FE-15 | L | **Blokira auth nove rute** dok se ne reproducira i razriješi; prvo provjeriti dva uređaja/tab. |
| S-02 | BL-001, F-CI-05-63/64/69 | BE-01, BE-10, BE-14 | L | **Blokira pogođene novčane podatke** dok se ne utvrde putanje i preciznost. |
| S-03 | BL-003, F-CI-05-40/41/48/51/66/67 | BE-03, BE-04, BE-07, BE-14, FE-15 | L | **Blokira pogođene tenant/prava putanje** dok se ne dokaže scope čitanja. |
| S-04 | BL-008, F-CI-05-37/38/39 | BE-02, BE-03, BE-04 | L | Auth/opoziv i post-commit: provjera uticaja na novu rutu paralelno sa S-01. |
| S-05 | BL-004, F-CI-05-45/46/49/57–62/68/70–72; F-CI-05-15 srednje | BE-05, BE-07, BE-14, FE-08, FE-12 | L | Idempotentni upisi i dokumentni upload; ne blokiraju samo zbog High ako nova ruta te putanje ne koristi. |
| S-06 | BL-005, F-CI-05-65 | BE-14, BE-05 | L | Zaključavanje/proračun potrošnje: provjeriti tačnost novčanih agregata dashboarda. |
| S-07 | BL-007, F-CI-05-52–56 | FE-08, FE-12, FE-13, FE-15 | L | Nacrti drugih obrazaca; paralelno, bez automatske blokade dashboarda. |
| S-08 | BL-010, F-CI-05-20–22 (izvorna težina visoko) | STD-01 | M | Ograničenja statičkih skenera; procesni posao, paralelno. |

## Sistemska rješenja — dodatne granice

- Decimalna pravila moraju biti definisana po **polju/koloni**, uključiti granice,
  kompatibilnost postojećih klijenata i siguran prelaz; ne samo zajednički parser.
- Tenant pravila obuhvataju transakcijsko provjeravanje aktera i cilja, revizije konteksta
  i mogućnost opoziva; dosadašnji guard snapshot nije zamjena za dokaz pri commit-u.
- Idempotencija mora vezati trajni identitet i canonical payload, čuvati rezultat/tombstone
  i opisati životni ciklus uploada; lock protokol mora dokumentovati poredak i retry.
- Datumi trebaju eksplicitnu poslovnu zonu i DST testove; sesije protokol koji ne
  poistovjećuje legitimni retry s krađom niti slabi stvarnu detekciju reuse-a.
- FE nacrti trebaju scope, oporavak i pravila gubitka; outbox zasebno prati isporuku
  i deduplikaciju; legacy podaci se inventarišu i popravljaju nedestruktivno.

## Historijski indeks STATE-a

Radi potpunosti, **svaki neprazan red** arhiviranog STATE-a ima ID i okvirnu klasu, uključujući historijske popravke i kontekst koji nisu ograničenja. Puni red i susjedni kontekst su u arhivi; ovo nije lista aktuelnih High nalaza. Aktuelne grupe su iznad u S-redu.

| ID | Klasa | Izvorni red |
|---|---|---|
| BL-H-0001 | post-commit efekti | [STATE red 1](history/STATE-2026-11-05.md#L1) |
| BL-H-0002 | ostalo / historijski kontekst | [STATE red 3](history/STATE-2026-11-05.md#L3) |
| BL-H-0003 | ostalo / historijski kontekst | [STATE red 5](history/STATE-2026-11-05.md#L5) |
| BL-H-0004 | ostalo / historijski kontekst | [STATE red 7](history/STATE-2026-11-05.md#L7) |
| BL-H-0005 | ostalo / historijski kontekst | [STATE red 9](history/STATE-2026-11-05.md#L9) |
| BL-H-0006 | ostalo / historijski kontekst | [STATE red 11](history/STATE-2026-11-05.md#L11) |
| BL-H-0007 | legacy/infrastruktura | [STATE red 12](history/STATE-2026-11-05.md#L12) |
| BL-H-0008 | legacy/infrastruktura | [STATE red 13](history/STATE-2026-11-05.md#L13) |
| BL-H-0009 | ostalo / historijski kontekst | [STATE red 15](history/STATE-2026-11-05.md#L15) |
| BL-H-0010 | idempotentnost/retry | [STATE red 16](history/STATE-2026-11-05.md#L16) |
| BL-H-0011 | ostalo / historijski kontekst | [STATE red 17](history/STATE-2026-11-05.md#L17) |
| BL-H-0012 | legacy/infrastruktura | [STATE red 19](history/STATE-2026-11-05.md#L19) |
| BL-H-0013 | ostalo / historijski kontekst | [STATE red 21](history/STATE-2026-11-05.md#L21) |
| BL-H-0014 | ostalo / historijski kontekst | [STATE red 22](history/STATE-2026-11-05.md#L22) |
| BL-H-0015 | novac/decimale | [STATE red 23](history/STATE-2026-11-05.md#L23) |
| BL-H-0016 | novac/decimale | [STATE red 24](history/STATE-2026-11-05.md#L24) |
| BL-H-0017 | ostalo / historijski kontekst | [STATE red 25](history/STATE-2026-11-05.md#L25) |
| BL-H-0018 | novac/decimale | [STATE red 27](history/STATE-2026-11-05.md#L27) |
| BL-H-0019 | novac/decimale | [STATE red 29](history/STATE-2026-11-05.md#L29) |
| BL-H-0020 | novac/decimale | [STATE red 31](history/STATE-2026-11-05.md#L31) |
| BL-H-0021 | novac/decimale | [STATE red 33](history/STATE-2026-11-05.md#L33) |
| BL-H-0022 | legacy/infrastruktura | [STATE red 35](history/STATE-2026-11-05.md#L35) |
| BL-H-0023 | novac/decimale | [STATE red 37](history/STATE-2026-11-05.md#L37) |
| BL-H-0024 | novac/decimale | [STATE red 39](history/STATE-2026-11-05.md#L39) |
| BL-H-0025 | novac/decimale | [STATE red 41](history/STATE-2026-11-05.md#L41) |
| BL-H-0026 | legacy/infrastruktura | [STATE red 43](history/STATE-2026-11-05.md#L43) |
| BL-H-0027 | tenant/prava | [STATE red 45](history/STATE-2026-11-05.md#L45) |
| BL-H-0028 | tenant/prava | [STATE red 47](history/STATE-2026-11-05.md#L47) |
| BL-H-0029 | tenant/prava | [STATE red 49](history/STATE-2026-11-05.md#L49) |
| BL-H-0030 | novac/decimale | [STATE red 51](history/STATE-2026-11-05.md#L51) |
| BL-H-0031 | tenant/prava | [STATE red 53](history/STATE-2026-11-05.md#L53) |
| BL-H-0032 | novac/decimale | [STATE red 55](history/STATE-2026-11-05.md#L55) |
| BL-H-0033 | novac/decimale | [STATE red 57](history/STATE-2026-11-05.md#L57) |
| BL-H-0034 | novac/decimale | [STATE red 59](history/STATE-2026-11-05.md#L59) |
| BL-H-0035 | novac/decimale | [STATE red 61](history/STATE-2026-11-05.md#L61) |
| BL-H-0036 | tenant/prava | [STATE red 62](history/STATE-2026-11-05.md#L62) |
| BL-H-0037 | idempotentnost/retry | [STATE red 63](history/STATE-2026-11-05.md#L63) |
| BL-H-0038 | novac/decimale | [STATE red 64](history/STATE-2026-11-05.md#L64) |
| BL-H-0039 | novac/decimale | [STATE red 66](history/STATE-2026-11-05.md#L66) |
| BL-H-0040 | novac/decimale | [STATE red 68](history/STATE-2026-11-05.md#L68) |
| BL-H-0041 | novac/decimale | [STATE red 69](history/STATE-2026-11-05.md#L69) |
| BL-H-0042 | idempotentnost/retry | [STATE red 70](history/STATE-2026-11-05.md#L70) |
| BL-H-0043 | novac/decimale | [STATE red 71](history/STATE-2026-11-05.md#L71) |
| BL-H-0044 | novac/decimale | [STATE red 73](history/STATE-2026-11-05.md#L73) |
| BL-H-0045 | novac/decimale | [STATE red 75](history/STATE-2026-11-05.md#L75) |
| BL-H-0046 | novac/decimale | [STATE red 76](history/STATE-2026-11-05.md#L76) |
| BL-H-0047 | novac/decimale | [STATE red 77](history/STATE-2026-11-05.md#L77) |
| BL-H-0048 | novac/decimale | [STATE red 78](history/STATE-2026-11-05.md#L78) |
| BL-H-0049 | novac/decimale | [STATE red 80](history/STATE-2026-11-05.md#L80) |
| BL-H-0050 | idempotentnost/retry | [STATE red 82](history/STATE-2026-11-05.md#L82) |
| BL-H-0051 | novac/decimale | [STATE red 84](history/STATE-2026-11-05.md#L84) |
| BL-H-0052 | novac/decimale | [STATE red 85](history/STATE-2026-11-05.md#L85) |
| BL-H-0053 | idempotentnost/retry | [STATE red 86](history/STATE-2026-11-05.md#L86) |
| BL-H-0054 | novac/decimale | [STATE red 87](history/STATE-2026-11-05.md#L87) |
| BL-H-0055 | novac/decimale | [STATE red 89](history/STATE-2026-11-05.md#L89) |
| BL-H-0056 | novac/decimale | [STATE red 91](history/STATE-2026-11-05.md#L91) |
| BL-H-0057 | novac/decimale | [STATE red 92](history/STATE-2026-11-05.md#L92) |
| BL-H-0058 | novac/decimale | [STATE red 93](history/STATE-2026-11-05.md#L93) |
| BL-H-0059 | legacy/infrastruktura | [STATE red 95](history/STATE-2026-11-05.md#L95) |
| BL-H-0060 | idempotentnost/retry | [STATE red 97](history/STATE-2026-11-05.md#L97) |
| BL-H-0061 | tenant/prava | [STATE red 98](history/STATE-2026-11-05.md#L98) |
| BL-H-0062 | novac/decimale | [STATE red 99](history/STATE-2026-11-05.md#L99) |
| BL-H-0063 | FE nacrti/oporavak | [STATE red 101](history/STATE-2026-11-05.md#L101) |
| BL-H-0064 | idempotentnost/retry | [STATE red 103](history/STATE-2026-11-05.md#L103) |
| BL-H-0065 | idempotentnost/retry | [STATE red 104](history/STATE-2026-11-05.md#L104) |
| BL-H-0066 | idempotentnost/retry | [STATE red 105](history/STATE-2026-11-05.md#L105) |
| BL-H-0067 | idempotentnost/retry | [STATE red 107](history/STATE-2026-11-05.md#L107) |
| BL-H-0068 | idempotentnost/retry | [STATE red 109](history/STATE-2026-11-05.md#L109) |
| BL-H-0069 | idempotentnost/retry | [STATE red 110](history/STATE-2026-11-05.md#L110) |
| BL-H-0070 | idempotentnost/retry | [STATE red 111](history/STATE-2026-11-05.md#L111) |
| BL-H-0071 | idempotentnost/retry | [STATE red 113](history/STATE-2026-11-05.md#L113) |
| BL-H-0072 | idempotentnost/retry | [STATE red 115](history/STATE-2026-11-05.md#L115) |
| BL-H-0073 | idempotentnost/retry | [STATE red 116](history/STATE-2026-11-05.md#L116) |
| BL-H-0074 | post-commit efekti | [STATE red 117](history/STATE-2026-11-05.md#L117) |
| BL-H-0075 | idempotentnost/retry | [STATE red 118](history/STATE-2026-11-05.md#L118) |
| BL-H-0076 | sesija/auth | [STATE red 120](history/STATE-2026-11-05.md#L120) |
| BL-H-0077 | sesija/auth | [STATE red 122](history/STATE-2026-11-05.md#L122) |
| BL-H-0078 | sesija/auth | [STATE red 123](history/STATE-2026-11-05.md#L123) |
| BL-H-0079 | legacy/infrastruktura | [STATE red 125](history/STATE-2026-11-05.md#L125) |
| BL-H-0080 | idempotentnost/retry | [STATE red 127](history/STATE-2026-11-05.md#L127) |
| BL-H-0081 | tenant/prava | [STATE red 128](history/STATE-2026-11-05.md#L128) |
| BL-H-0082 | idempotentnost/retry | [STATE red 129](history/STATE-2026-11-05.md#L129) |
| BL-H-0083 | legacy/infrastruktura | [STATE red 131](history/STATE-2026-11-05.md#L131) |
| BL-H-0084 | idempotentnost/retry | [STATE red 133](history/STATE-2026-11-05.md#L133) |
| BL-H-0085 | tenant/prava | [STATE red 134](history/STATE-2026-11-05.md#L134) |
| BL-H-0086 | idempotentnost/retry | [STATE red 135](history/STATE-2026-11-05.md#L135) |
| BL-H-0087 | novac/decimale | [STATE red 137](history/STATE-2026-11-05.md#L137) |
| BL-H-0088 | FE nacrti/oporavak | [STATE red 139](history/STATE-2026-11-05.md#L139) |
| BL-H-0089 | tenant/prava | [STATE red 140](history/STATE-2026-11-05.md#L140) |
| BL-H-0090 | novac/decimale | [STATE red 141](history/STATE-2026-11-05.md#L141) |
| BL-H-0091 | novac/decimale | [STATE red 143](history/STATE-2026-11-05.md#L143) |
| BL-H-0092 | novac/decimale | [STATE red 145](history/STATE-2026-11-05.md#L145) |
| BL-H-0093 | tenant/prava | [STATE red 146](history/STATE-2026-11-05.md#L146) |
| BL-H-0094 | novac/decimale | [STATE red 147](history/STATE-2026-11-05.md#L147) |
| BL-H-0095 | FE nacrti/oporavak | [STATE red 149](history/STATE-2026-11-05.md#L149) |
| BL-H-0096 | FE nacrti/oporavak | [STATE red 151](history/STATE-2026-11-05.md#L151) |
| BL-H-0097 | idempotentnost/retry | [STATE red 152](history/STATE-2026-11-05.md#L152) |
| BL-H-0098 | idempotentnost/retry | [STATE red 153](history/STATE-2026-11-05.md#L153) |
| BL-H-0099 | FE nacrti/oporavak | [STATE red 155](history/STATE-2026-11-05.md#L155) |
| BL-H-0100 | konkurentnost/lockovi | [STATE red 157](history/STATE-2026-11-05.md#L157) |
| BL-H-0101 | konkurentnost/lockovi | [STATE red 158](history/STATE-2026-11-05.md#L158) |
| BL-H-0102 | konkurentnost/lockovi | [STATE red 159](history/STATE-2026-11-05.md#L159) |
| BL-H-0103 | FE nacrti/oporavak | [STATE red 160](history/STATE-2026-11-05.md#L160) |
| BL-H-0104 | legacy/infrastruktura | [STATE red 162](history/STATE-2026-11-05.md#L162) |
| BL-H-0105 | tenant/prava | [STATE red 164](history/STATE-2026-11-05.md#L164) |
| BL-H-0106 | FE nacrti/oporavak | [STATE red 165](history/STATE-2026-11-05.md#L165) |
| BL-H-0107 | sesija/auth | [STATE red 166](history/STATE-2026-11-05.md#L166) |
| BL-H-0108 | legacy/infrastruktura | [STATE red 167](history/STATE-2026-11-05.md#L167) |
| BL-H-0109 | sesija/auth | [STATE red 169](history/STATE-2026-11-05.md#L169) |
| BL-H-0110 | idempotentnost/retry | [STATE red 171](history/STATE-2026-11-05.md#L171) |
| BL-H-0111 | sesija/auth | [STATE red 172](history/STATE-2026-11-05.md#L172) |
| BL-H-0112 | sesija/auth | [STATE red 173](history/STATE-2026-11-05.md#L173) |
| BL-H-0113 | legacy/infrastruktura | [STATE red 174](history/STATE-2026-11-05.md#L174) |
| BL-H-0114 | FE nacrti/oporavak | [STATE red 176](history/STATE-2026-11-05.md#L176) |
| BL-H-0115 | FE nacrti/oporavak | [STATE red 178](history/STATE-2026-11-05.md#L178) |
| BL-H-0116 | FE nacrti/oporavak | [STATE red 179](history/STATE-2026-11-05.md#L179) |
| BL-H-0117 | sesija/auth | [STATE red 180](history/STATE-2026-11-05.md#L180) |
| BL-H-0118 | legacy/infrastruktura | [STATE red 181](history/STATE-2026-11-05.md#L181) |
| BL-H-0119 | FE nacrti/oporavak | [STATE red 183](history/STATE-2026-11-05.md#L183) |
| BL-H-0120 | idempotentnost/retry | [STATE red 185](history/STATE-2026-11-05.md#L185) |
| BL-H-0121 | konkurentnost/lockovi | [STATE red 186](history/STATE-2026-11-05.md#L186) |
| BL-H-0122 | sesija/auth | [STATE red 187](history/STATE-2026-11-05.md#L187) |
| BL-H-0123 | legacy/infrastruktura | [STATE red 188](history/STATE-2026-11-05.md#L188) |
| BL-H-0124 | legacy/infrastruktura | [STATE red 190](history/STATE-2026-11-05.md#L190) |
| BL-H-0125 | tenant/prava | [STATE red 192](history/STATE-2026-11-05.md#L192) |
| BL-H-0126 | novac/decimale | [STATE red 193](history/STATE-2026-11-05.md#L193) |
| BL-H-0127 | FE nacrti/oporavak | [STATE red 194](history/STATE-2026-11-05.md#L194) |
| BL-H-0128 | legacy/infrastruktura | [STATE red 195](history/STATE-2026-11-05.md#L195) |
| BL-H-0129 | sesija/auth | [STATE red 197](history/STATE-2026-11-05.md#L197) |
| BL-H-0130 | novac/decimale | [STATE red 199](history/STATE-2026-11-05.md#L199) |
| BL-H-0131 | FE nacrti/oporavak | [STATE red 200](history/STATE-2026-11-05.md#L200) |
| BL-H-0132 | sesija/auth | [STATE red 201](history/STATE-2026-11-05.md#L201) |
| BL-H-0133 | legacy/infrastruktura | [STATE red 202](history/STATE-2026-11-05.md#L202) |
| BL-H-0134 | idempotentnost/retry | [STATE red 204](history/STATE-2026-11-05.md#L204) |
| BL-H-0135 | idempotentnost/retry | [STATE red 206](history/STATE-2026-11-05.md#L206) |
| BL-H-0136 | idempotentnost/retry | [STATE red 207](history/STATE-2026-11-05.md#L207) |
| BL-H-0137 | FE nacrti/oporavak | [STATE red 208](history/STATE-2026-11-05.md#L208) |
| BL-H-0138 | legacy/infrastruktura | [STATE red 209](history/STATE-2026-11-05.md#L209) |
| BL-H-0139 | legacy/infrastruktura | [STATE red 211](history/STATE-2026-11-05.md#L211) |
| BL-H-0140 | idempotentnost/retry | [STATE red 213](history/STATE-2026-11-05.md#L213) |
| BL-H-0141 | legacy/infrastruktura | [STATE red 214](history/STATE-2026-11-05.md#L214) |
| BL-H-0142 | FE nacrti/oporavak | [STATE red 215](history/STATE-2026-11-05.md#L215) |
| BL-H-0143 | sesija/auth | [STATE red 217](history/STATE-2026-11-05.md#L217) |
| BL-H-0144 | idempotentnost/retry | [STATE red 219](history/STATE-2026-11-05.md#L219) |
| BL-H-0145 | sesija/auth | [STATE red 220](history/STATE-2026-11-05.md#L220) |
| BL-H-0146 | idempotentnost/retry | [STATE red 221](history/STATE-2026-11-05.md#L221) |
| BL-H-0147 | legacy/infrastruktura | [STATE red 222](history/STATE-2026-11-05.md#L222) |
| BL-H-0148 | legacy/infrastruktura | [STATE red 224](history/STATE-2026-11-05.md#L224) |
| BL-H-0149 | sesija/auth | [STATE red 226](history/STATE-2026-11-05.md#L226) |
| BL-H-0150 | idempotentnost/retry | [STATE red 227](history/STATE-2026-11-05.md#L227) |
| BL-H-0151 | legacy/infrastruktura | [STATE red 228](history/STATE-2026-11-05.md#L228) |
| BL-H-0152 | vremenske zone | [STATE red 230](history/STATE-2026-11-05.md#L230) |
| BL-H-0153 | vremenske zone | [STATE red 232](history/STATE-2026-11-05.md#L232) |
| BL-H-0154 | idempotentnost/retry | [STATE red 233](history/STATE-2026-11-05.md#L233) |
| BL-H-0155 | idempotentnost/retry | [STATE red 234](history/STATE-2026-11-05.md#L234) |
| BL-H-0156 | legacy/infrastruktura | [STATE red 236](history/STATE-2026-11-05.md#L236) |
| BL-H-0157 | idempotentnost/retry | [STATE red 238](history/STATE-2026-11-05.md#L238) |
| BL-H-0158 | legacy/infrastruktura | [STATE red 239](history/STATE-2026-11-05.md#L239) |
| BL-H-0159 | tenant/prava | [STATE red 240](history/STATE-2026-11-05.md#L240) |
| BL-H-0160 | sesija/auth | [STATE red 242](history/STATE-2026-11-05.md#L242) |
| BL-H-0161 | tenant/prava | [STATE red 244](history/STATE-2026-11-05.md#L244) |
| BL-H-0162 | sesija/auth | [STATE red 245](history/STATE-2026-11-05.md#L245) |
| BL-H-0163 | konkurentnost/lockovi | [STATE red 246](history/STATE-2026-11-05.md#L246) |
| BL-H-0164 | legacy/infrastruktura | [STATE red 248](history/STATE-2026-11-05.md#L248) |
| BL-H-0165 | idempotentnost/retry | [STATE red 250](history/STATE-2026-11-05.md#L250) |
| BL-H-0166 | sesija/auth | [STATE red 251](history/STATE-2026-11-05.md#L251) |
| BL-H-0167 | konkurentnost/lockovi | [STATE red 252](history/STATE-2026-11-05.md#L252) |
| BL-H-0168 | legacy/infrastruktura | [STATE red 254](history/STATE-2026-11-05.md#L254) |
| BL-H-0169 | idempotentnost/retry | [STATE red 256](history/STATE-2026-11-05.md#L256) |
| BL-H-0170 | konkurentnost/lockovi | [STATE red 257](history/STATE-2026-11-05.md#L257) |
| BL-H-0171 | legacy/infrastruktura | [STATE red 259](history/STATE-2026-11-05.md#L259) |
| BL-H-0172 | tenant/prava | [STATE red 261](history/STATE-2026-11-05.md#L261) |
| BL-H-0173 | sesija/auth | [STATE red 262](history/STATE-2026-11-05.md#L262) |
| BL-H-0174 | konkurentnost/lockovi | [STATE red 263](history/STATE-2026-11-05.md#L263) |
| BL-H-0175 | sesija/auth | [STATE red 265](history/STATE-2026-11-05.md#L265) |
| BL-H-0176 | konkurentnost/lockovi | [STATE red 267](history/STATE-2026-11-05.md#L267) |
| BL-H-0177 | konkurentnost/lockovi | [STATE red 268](history/STATE-2026-11-05.md#L268) |
| BL-H-0178 | legacy/infrastruktura | [STATE red 269](history/STATE-2026-11-05.md#L269) |
| BL-H-0179 | sesija/auth | [STATE red 271](history/STATE-2026-11-05.md#L271) |
| BL-H-0180 | konkurentnost/lockovi | [STATE red 273](history/STATE-2026-11-05.md#L273) |
| BL-H-0181 | konkurentnost/lockovi | [STATE red 274](history/STATE-2026-11-05.md#L274) |
| BL-H-0182 | konkurentnost/lockovi | [STATE red 275](history/STATE-2026-11-05.md#L275) |
| BL-H-0183 | legacy/infrastruktura | [STATE red 277](history/STATE-2026-11-05.md#L277) |
| BL-H-0184 | legacy/infrastruktura | [STATE red 279](history/STATE-2026-11-05.md#L279) |
| BL-H-0185 | post-commit efekti | [STATE red 280](history/STATE-2026-11-05.md#L280) |
| BL-H-0186 | legacy/infrastruktura | [STATE red 282](history/STATE-2026-11-05.md#L282) |
| BL-H-0187 | idempotentnost/retry | [STATE red 284](history/STATE-2026-11-05.md#L284) |
| BL-H-0188 | idempotentnost/retry | [STATE red 285](history/STATE-2026-11-05.md#L285) |
| BL-H-0189 | konkurentnost/lockovi | [STATE red 286](history/STATE-2026-11-05.md#L286) |
| BL-H-0190 | sesija/auth | [STATE red 288](history/STATE-2026-11-05.md#L288) |
| BL-H-0191 | sesija/auth | [STATE red 290](history/STATE-2026-11-05.md#L290) |
| BL-H-0192 | konkurentnost/lockovi | [STATE red 291](history/STATE-2026-11-05.md#L291) |
| BL-H-0193 | konkurentnost/lockovi | [STATE red 292](history/STATE-2026-11-05.md#L292) |
| BL-H-0194 | legacy/infrastruktura | [STATE red 294](history/STATE-2026-11-05.md#L294) |
| BL-H-0195 | konkurentnost/lockovi | [STATE red 296](history/STATE-2026-11-05.md#L296) |
| BL-H-0196 | idempotentnost/retry | [STATE red 297](history/STATE-2026-11-05.md#L297) |
| BL-H-0197 | konkurentnost/lockovi | [STATE red 298](history/STATE-2026-11-05.md#L298) |
| BL-H-0198 | sesija/auth | [STATE red 300](history/STATE-2026-11-05.md#L300) |
| BL-H-0199 | konkurentnost/lockovi | [STATE red 302](history/STATE-2026-11-05.md#L302) |
| BL-H-0200 | sesija/auth | [STATE red 303](history/STATE-2026-11-05.md#L303) |
| BL-H-0201 | konkurentnost/lockovi | [STATE red 304](history/STATE-2026-11-05.md#L304) |
| BL-H-0202 | konkurentnost/lockovi | [STATE red 306](history/STATE-2026-11-05.md#L306) |
| BL-H-0203 | idempotentnost/retry | [STATE red 308](history/STATE-2026-11-05.md#L308) |
| BL-H-0204 | sesija/auth | [STATE red 309](history/STATE-2026-11-05.md#L309) |
| BL-H-0205 | FE nacrti/oporavak | [STATE red 310](history/STATE-2026-11-05.md#L310) |
| BL-H-0206 | legacy/infrastruktura | [STATE red 312](history/STATE-2026-11-05.md#L312) |
| BL-H-0207 | legacy/infrastruktura | [STATE red 314](history/STATE-2026-11-05.md#L314) |
| BL-H-0208 | legacy/infrastruktura | [STATE red 315](history/STATE-2026-11-05.md#L315) |
| BL-H-0209 | legacy/infrastruktura | [STATE red 317](history/STATE-2026-11-05.md#L317) |
| BL-H-0210 | legacy/infrastruktura | [STATE red 319](history/STATE-2026-11-05.md#L319) |
| BL-H-0211 | idempotentnost/retry | [STATE red 320](history/STATE-2026-11-05.md#L320) |
| BL-H-0212 | legacy/infrastruktura | [STATE red 322](history/STATE-2026-11-05.md#L322) |
| BL-H-0213 | tenant/prava | [STATE red 324](history/STATE-2026-11-05.md#L324) |
| BL-H-0214 | post-commit efekti | [STATE red 325](history/STATE-2026-11-05.md#L325) |
| BL-H-0215 | legacy/infrastruktura | [STATE red 327](history/STATE-2026-11-05.md#L327) |
| BL-H-0216 | idempotentnost/retry | [STATE red 329](history/STATE-2026-11-05.md#L329) |
| BL-H-0217 | legacy/infrastruktura | [STATE red 330](history/STATE-2026-11-05.md#L330) |
| BL-H-0218 | idempotentnost/retry | [STATE red 332](history/STATE-2026-11-05.md#L332) |
| BL-H-0219 | tenant/prava | [STATE red 334](history/STATE-2026-11-05.md#L334) |
| BL-H-0220 | idempotentnost/retry | [STATE red 335](history/STATE-2026-11-05.md#L335) |
| BL-H-0221 | idempotentnost/retry | [STATE red 336](history/STATE-2026-11-05.md#L336) |
| BL-H-0222 | legacy/infrastruktura | [STATE red 338](history/STATE-2026-11-05.md#L338) |
| BL-H-0223 | post-commit efekti | [STATE red 340](history/STATE-2026-11-05.md#L340) |
| BL-H-0224 | idempotentnost/retry | [STATE red 341](history/STATE-2026-11-05.md#L341) |
| BL-H-0225 | legacy/infrastruktura | [STATE red 343](history/STATE-2026-11-05.md#L343) |
| BL-H-0226 | legacy/infrastruktura | [STATE red 345](history/STATE-2026-11-05.md#L345) |
| BL-H-0227 | idempotentnost/retry | [STATE red 346](history/STATE-2026-11-05.md#L346) |
| BL-H-0228 | legacy/infrastruktura | [STATE red 348](history/STATE-2026-11-05.md#L348) |
| BL-H-0229 | konkurentnost/lockovi | [STATE red 350](history/STATE-2026-11-05.md#L350) |
| BL-H-0230 | idempotentnost/retry | [STATE red 351](history/STATE-2026-11-05.md#L351) |
| BL-H-0231 | legacy/infrastruktura | [STATE red 353](history/STATE-2026-11-05.md#L353) |
| BL-H-0232 | post-commit efekti | [STATE red 355](history/STATE-2026-11-05.md#L355) |
| BL-H-0233 | idempotentnost/retry | [STATE red 356](history/STATE-2026-11-05.md#L356) |
| BL-H-0234 | idempotentnost/retry | [STATE red 357](history/STATE-2026-11-05.md#L357) |
| BL-H-0235 | legacy/infrastruktura | [STATE red 359](history/STATE-2026-11-05.md#L359) |
| BL-H-0236 | legacy/infrastruktura | [STATE red 361](history/STATE-2026-11-05.md#L361) |
| BL-H-0237 | novac/decimale | [STATE red 362](history/STATE-2026-11-05.md#L362) |
| BL-H-0238 | idempotentnost/retry | [STATE red 363](history/STATE-2026-11-05.md#L363) |
| BL-H-0239 | legacy/infrastruktura | [STATE red 365](history/STATE-2026-11-05.md#L365) |
| BL-H-0240 | post-commit efekti | [STATE red 367](history/STATE-2026-11-05.md#L367) |
| BL-H-0241 | idempotentnost/retry | [STATE red 368](history/STATE-2026-11-05.md#L368) |
| BL-H-0242 | post-commit efekti | [STATE red 369](history/STATE-2026-11-05.md#L369) |
| BL-H-0243 | post-commit efekti | [STATE red 371](history/STATE-2026-11-05.md#L371) |
| BL-H-0244 | legacy/infrastruktura | [STATE red 373](history/STATE-2026-11-05.md#L373) |
| BL-H-0245 | legacy/infrastruktura | [STATE red 374](history/STATE-2026-11-05.md#L374) |
| BL-H-0246 | legacy/infrastruktura | [STATE red 375](history/STATE-2026-11-05.md#L375) |
| BL-H-0247 | legacy/infrastruktura | [STATE red 377](history/STATE-2026-11-05.md#L377) |
| BL-H-0248 | post-commit efekti | [STATE red 379](history/STATE-2026-11-05.md#L379) |
| BL-H-0249 | legacy/infrastruktura | [STATE red 380](history/STATE-2026-11-05.md#L380) |
| BL-H-0250 | post-commit efekti | [STATE red 381](history/STATE-2026-11-05.md#L381) |
| BL-H-0251 | legacy/infrastruktura | [STATE red 382](history/STATE-2026-11-05.md#L382) |
| BL-H-0252 | legacy/infrastruktura | [STATE red 384](history/STATE-2026-11-05.md#L384) |
| BL-H-0253 | idempotentnost/retry | [STATE red 386](history/STATE-2026-11-05.md#L386) |
| BL-H-0254 | idempotentnost/retry | [STATE red 387](history/STATE-2026-11-05.md#L387) |
| BL-H-0255 | idempotentnost/retry | [STATE red 388](history/STATE-2026-11-05.md#L388) |
| BL-H-0256 | legacy/infrastruktura | [STATE red 390](history/STATE-2026-11-05.md#L390) |
| BL-H-0257 | idempotentnost/retry | [STATE red 392](history/STATE-2026-11-05.md#L392) |
| BL-H-0258 | FE nacrti/oporavak | [STATE red 393](history/STATE-2026-11-05.md#L393) |
| BL-H-0259 | legacy/infrastruktura | [STATE red 394](history/STATE-2026-11-05.md#L394) |
| BL-H-0260 | legacy/infrastruktura | [STATE red 395](history/STATE-2026-11-05.md#L395) |
| BL-H-0261 | legacy/infrastruktura | [STATE red 397](history/STATE-2026-11-05.md#L397) |
| BL-H-0262 | legacy/infrastruktura | [STATE red 399](history/STATE-2026-11-05.md#L399) |
| BL-H-0263 | legacy/infrastruktura | [STATE red 400](history/STATE-2026-11-05.md#L400) |
| BL-H-0264 | legacy/infrastruktura | [STATE red 401](history/STATE-2026-11-05.md#L401) |
| BL-H-0265 | legacy/infrastruktura | [STATE red 403](history/STATE-2026-11-05.md#L403) |
| BL-H-0266 | idempotentnost/retry | [STATE red 405](history/STATE-2026-11-05.md#L405) |
| BL-H-0267 | legacy/infrastruktura | [STATE red 406](history/STATE-2026-11-05.md#L406) |
| BL-H-0268 | legacy/infrastruktura | [STATE red 407](history/STATE-2026-11-05.md#L407) |
| BL-H-0269 | legacy/infrastruktura | [STATE red 409](history/STATE-2026-11-05.md#L409) |
| BL-H-0270 | ostalo / historijski kontekst | [STATE red 411](history/STATE-2026-11-05.md#L411) |
| BL-H-0271 | legacy/infrastruktura | [STATE red 412](history/STATE-2026-11-05.md#L412) |
| BL-H-0272 | legacy/infrastruktura | [STATE red 413](history/STATE-2026-11-05.md#L413) |
| BL-H-0273 | legacy/infrastruktura | [STATE red 415](history/STATE-2026-11-05.md#L415) |
| BL-H-0274 | legacy/infrastruktura | [STATE red 417](history/STATE-2026-11-05.md#L417) |
| BL-H-0275 | legacy/infrastruktura | [STATE red 418](history/STATE-2026-11-05.md#L418) |
| BL-H-0276 | legacy/infrastruktura | [STATE red 419](history/STATE-2026-11-05.md#L419) |
| BL-H-0277 | legacy/infrastruktura | [STATE red 420](history/STATE-2026-11-05.md#L420) |
| BL-H-0278 | ostalo / historijski kontekst | [STATE red 422](history/STATE-2026-11-05.md#L422) |
| BL-H-0279 | post-commit efekti | [STATE red 424](history/STATE-2026-11-05.md#L424) |
| BL-H-0280 | ostalo / historijski kontekst | [STATE red 425](history/STATE-2026-11-05.md#L425) |
| BL-H-0281 | legacy/infrastruktura | [STATE red 426](history/STATE-2026-11-05.md#L426) |
| BL-H-0282 | ostalo / historijski kontekst | [STATE red 428](history/STATE-2026-11-05.md#L428) |
| BL-H-0283 | legacy/infrastruktura | [STATE red 429](history/STATE-2026-11-05.md#L429) |
| BL-H-0284 | post-commit efekti | [STATE red 430](history/STATE-2026-11-05.md#L430) |
| BL-H-0285 | ostalo / historijski kontekst | [STATE red 432](history/STATE-2026-11-05.md#L432) |
| BL-H-0286 | post-commit efekti | [STATE red 433](history/STATE-2026-11-05.md#L433) |
| BL-H-0287 | legacy/infrastruktura | [STATE red 434](history/STATE-2026-11-05.md#L434) |
| BL-H-0288 | ostalo / historijski kontekst | [STATE red 435](history/STATE-2026-11-05.md#L435) |
| BL-H-0289 | legacy/infrastruktura | [STATE red 436](history/STATE-2026-11-05.md#L436) |
| BL-H-0290 | ostalo / historijski kontekst | [STATE red 438](history/STATE-2026-11-05.md#L438) |
| BL-H-0291 | ostalo / historijski kontekst | [STATE red 439](history/STATE-2026-11-05.md#L439) |
| BL-H-0292 | ostalo / historijski kontekst | [STATE red 440](history/STATE-2026-11-05.md#L440) |
| BL-H-0293 | ostalo / historijski kontekst | [STATE red 441](history/STATE-2026-11-05.md#L441) |
| BL-H-0294 | ostalo / historijski kontekst | [STATE red 442](history/STATE-2026-11-05.md#L442) |
| BL-H-0295 | ostalo / historijski kontekst | [STATE red 443](history/STATE-2026-11-05.md#L443) |
| BL-H-0296 | ostalo / historijski kontekst | [STATE red 444](history/STATE-2026-11-05.md#L444) |
| BL-H-0297 | ostalo / historijski kontekst | [STATE red 446](history/STATE-2026-11-05.md#L446) |
| BL-H-0298 | legacy/infrastruktura | [STATE red 447](history/STATE-2026-11-05.md#L447) |
| BL-H-0299 | legacy/infrastruktura | [STATE red 448](history/STATE-2026-11-05.md#L448) |
| BL-H-0300 | legacy/infrastruktura | [STATE red 449](history/STATE-2026-11-05.md#L449) |
| BL-H-0301 | legacy/infrastruktura | [STATE red 450](history/STATE-2026-11-05.md#L450) |
| BL-H-0302 | ostalo / historijski kontekst | [STATE red 451](history/STATE-2026-11-05.md#L451) |
| BL-H-0303 | legacy/infrastruktura | [STATE red 452](history/STATE-2026-11-05.md#L452) |
| BL-H-0304 | post-commit efekti | [STATE red 453](history/STATE-2026-11-05.md#L453) |
| BL-H-0305 | ostalo / historijski kontekst | [STATE red 455](history/STATE-2026-11-05.md#L455) |
| BL-H-0306 | post-commit efekti | [STATE red 456](history/STATE-2026-11-05.md#L456) |
| BL-H-0307 | legacy/infrastruktura | [STATE red 457](history/STATE-2026-11-05.md#L457) |
| BL-H-0308 | legacy/infrastruktura | [STATE red 458](history/STATE-2026-11-05.md#L458) |
| BL-H-0309 | post-commit efekti | [STATE red 459](history/STATE-2026-11-05.md#L459) |
| BL-H-0310 | ostalo / historijski kontekst | [STATE red 460](history/STATE-2026-11-05.md#L460) |
| BL-H-0311 | ostalo / historijski kontekst | [STATE red 461](history/STATE-2026-11-05.md#L461) |
| BL-H-0312 | ostalo / historijski kontekst | [STATE red 462](history/STATE-2026-11-05.md#L462) |
| BL-H-0313 | ostalo / historijski kontekst | [STATE red 464](history/STATE-2026-11-05.md#L464) |
| BL-H-0314 | post-commit efekti | [STATE red 465](history/STATE-2026-11-05.md#L465) |
| BL-H-0315 | post-commit efekti | [STATE red 466](history/STATE-2026-11-05.md#L466) |
| BL-H-0316 | post-commit efekti | [STATE red 467](history/STATE-2026-11-05.md#L467) |
| BL-H-0317 | legacy/infrastruktura | [STATE red 468](history/STATE-2026-11-05.md#L468) |
| BL-H-0318 | ostalo / historijski kontekst | [STATE red 470](history/STATE-2026-11-05.md#L470) |
| BL-H-0319 | post-commit efekti | [STATE red 471](history/STATE-2026-11-05.md#L471) |
| BL-H-0320 | ostalo / historijski kontekst | [STATE red 472](history/STATE-2026-11-05.md#L472) |
| BL-H-0321 | legacy/infrastruktura | [STATE red 473](history/STATE-2026-11-05.md#L473) |
| BL-H-0322 | tenant/prava | [STATE red 474](history/STATE-2026-11-05.md#L474) |
| BL-H-0323 | post-commit efekti | [STATE red 475](history/STATE-2026-11-05.md#L475) |
| BL-H-0324 | legacy/infrastruktura | [STATE red 477](history/STATE-2026-11-05.md#L477) |
| BL-H-0325 | ostalo / historijski kontekst | [STATE red 478](history/STATE-2026-11-05.md#L478) |
| BL-H-0326 | legacy/infrastruktura | [STATE red 479](history/STATE-2026-11-05.md#L479) |
| BL-H-0327 | legacy/infrastruktura | [STATE red 480](history/STATE-2026-11-05.md#L480) |
| BL-H-0328 | legacy/infrastruktura | [STATE red 481](history/STATE-2026-11-05.md#L481) |
| BL-H-0329 | ostalo / historijski kontekst | [STATE red 483](history/STATE-2026-11-05.md#L483) |
| BL-H-0330 | ostalo / historijski kontekst | [STATE red 484](history/STATE-2026-11-05.md#L484) |
| BL-H-0331 | post-commit efekti | [STATE red 485](history/STATE-2026-11-05.md#L485) |
| BL-H-0332 | legacy/infrastruktura | [STATE red 486](history/STATE-2026-11-05.md#L486) |
| BL-H-0333 | ostalo / historijski kontekst | [STATE red 487](history/STATE-2026-11-05.md#L487) |
| BL-H-0334 | ostalo / historijski kontekst | [STATE red 488](history/STATE-2026-11-05.md#L488) |
| BL-H-0335 | ostalo / historijski kontekst | [STATE red 489](history/STATE-2026-11-05.md#L489) |
| BL-H-0336 | post-commit efekti | [STATE red 490](history/STATE-2026-11-05.md#L490) |
| BL-H-0337 | ostalo / historijski kontekst | [STATE red 491](history/STATE-2026-11-05.md#L491) |
| BL-H-0338 | legacy/infrastruktura | [STATE red 492](history/STATE-2026-11-05.md#L492) |
| BL-H-0339 | ostalo / historijski kontekst | [STATE red 493](history/STATE-2026-11-05.md#L493) |
| BL-H-0340 | legacy/infrastruktura | [STATE red 495](history/STATE-2026-11-05.md#L495) |
| BL-H-0341 | legacy/infrastruktura | [STATE red 496](history/STATE-2026-11-05.md#L496) |
| BL-H-0342 | ostalo / historijski kontekst | [STATE red 497](history/STATE-2026-11-05.md#L497) |
| BL-H-0343 | ostalo / historijski kontekst | [STATE red 498](history/STATE-2026-11-05.md#L498) |
| BL-H-0344 | post-commit efekti | [STATE red 499](history/STATE-2026-11-05.md#L499) |
| BL-H-0345 | legacy/infrastruktura | [STATE red 501](history/STATE-2026-11-05.md#L501) |
| BL-H-0346 | legacy/infrastruktura | [STATE red 502](history/STATE-2026-11-05.md#L502) |
| BL-H-0347 | ostalo / historijski kontekst | [STATE red 503](history/STATE-2026-11-05.md#L503) |
| BL-H-0348 | legacy/infrastruktura | [STATE red 504](history/STATE-2026-11-05.md#L504) |
| BL-H-0349 | ostalo / historijski kontekst | [STATE red 505](history/STATE-2026-11-05.md#L505) |
| BL-H-0350 | ostalo / historijski kontekst | [STATE red 506](history/STATE-2026-11-05.md#L506) |
| BL-H-0351 | ostalo / historijski kontekst | [STATE red 507](history/STATE-2026-11-05.md#L507) |
| BL-H-0352 | ostalo / historijski kontekst | [STATE red 509](history/STATE-2026-11-05.md#L509) |
| BL-H-0353 | ostalo / historijski kontekst | [STATE red 510](history/STATE-2026-11-05.md#L510) |
| BL-H-0354 | ostalo / historijski kontekst | [STATE red 511](history/STATE-2026-11-05.md#L511) |
| BL-H-0355 | legacy/infrastruktura | [STATE red 512](history/STATE-2026-11-05.md#L512) |
| BL-H-0356 | legacy/infrastruktura | [STATE red 513](history/STATE-2026-11-05.md#L513) |
| BL-H-0357 | legacy/infrastruktura | [STATE red 514](history/STATE-2026-11-05.md#L514) |
| BL-H-0358 | sesija/auth | [STATE red 515](history/STATE-2026-11-05.md#L515) |
| BL-H-0359 | legacy/infrastruktura | [STATE red 516](history/STATE-2026-11-05.md#L516) |
| BL-H-0360 | ostalo / historijski kontekst | [STATE red 517](history/STATE-2026-11-05.md#L517) |
| BL-H-0361 | ostalo / historijski kontekst | [STATE red 518](history/STATE-2026-11-05.md#L518) |
| BL-H-0362 | ostalo / historijski kontekst | [STATE red 520](history/STATE-2026-11-05.md#L520) |
| BL-H-0363 | legacy/infrastruktura | [STATE red 521](history/STATE-2026-11-05.md#L521) |
| BL-H-0364 | legacy/infrastruktura | [STATE red 522](history/STATE-2026-11-05.md#L522) |
| BL-H-0365 | ostalo / historijski kontekst | [STATE red 523](history/STATE-2026-11-05.md#L523) |
| BL-H-0366 | ostalo / historijski kontekst | [STATE red 524](history/STATE-2026-11-05.md#L524) |
| BL-H-0367 | legacy/infrastruktura | [STATE red 525](history/STATE-2026-11-05.md#L525) |
| BL-H-0368 | legacy/infrastruktura | [STATE red 526](history/STATE-2026-11-05.md#L526) |
| BL-H-0369 | legacy/infrastruktura | [STATE red 527](history/STATE-2026-11-05.md#L527) |
| BL-H-0370 | ostalo / historijski kontekst | [STATE red 528](history/STATE-2026-11-05.md#L528) |
| BL-H-0371 | ostalo / historijski kontekst | [STATE red 529](history/STATE-2026-11-05.md#L529) |
| BL-H-0372 | ostalo / historijski kontekst | [STATE red 530](history/STATE-2026-11-05.md#L530) |
| BL-H-0373 | ostalo / historijski kontekst | [STATE red 532](history/STATE-2026-11-05.md#L532) |
| BL-H-0374 | ostalo / historijski kontekst | [STATE red 533](history/STATE-2026-11-05.md#L533) |
| BL-H-0375 | ostalo / historijski kontekst | [STATE red 534](history/STATE-2026-11-05.md#L534) |
| BL-H-0376 | legacy/infrastruktura | [STATE red 535](history/STATE-2026-11-05.md#L535) |
| BL-H-0377 | sesija/auth | [STATE red 536](history/STATE-2026-11-05.md#L536) |
| BL-H-0378 | ostalo / historijski kontekst | [STATE red 537](history/STATE-2026-11-05.md#L537) |
| BL-H-0379 | ostalo / historijski kontekst | [STATE red 538](history/STATE-2026-11-05.md#L538) |
| BL-H-0380 | ostalo / historijski kontekst | [STATE red 539](history/STATE-2026-11-05.md#L539) |
| BL-H-0381 | ostalo / historijski kontekst | [STATE red 541](history/STATE-2026-11-05.md#L541) |
| BL-H-0382 | legacy/infrastruktura | [STATE red 542](history/STATE-2026-11-05.md#L542) |
| BL-H-0383 | legacy/infrastruktura | [STATE red 543](history/STATE-2026-11-05.md#L543) |
| BL-H-0384 | ostalo / historijski kontekst | [STATE red 544](history/STATE-2026-11-05.md#L544) |
| BL-H-0385 | ostalo / historijski kontekst | [STATE red 545](history/STATE-2026-11-05.md#L545) |
| BL-H-0386 | idempotentnost/retry | [STATE red 546](history/STATE-2026-11-05.md#L546) |
| BL-H-0387 | legacy/infrastruktura | [STATE red 547](history/STATE-2026-11-05.md#L547) |
| BL-H-0388 | ostalo / historijski kontekst | [STATE red 548](history/STATE-2026-11-05.md#L548) |
| BL-H-0389 | post-commit efekti | [STATE red 549](history/STATE-2026-11-05.md#L549) |
| BL-H-0390 | ostalo / historijski kontekst | [STATE red 550](history/STATE-2026-11-05.md#L550) |
| BL-H-0391 | ostalo / historijski kontekst | [STATE red 551](history/STATE-2026-11-05.md#L551) |
| BL-H-0392 | ostalo / historijski kontekst | [STATE red 552](history/STATE-2026-11-05.md#L552) |
| BL-H-0393 | ostalo / historijski kontekst | [STATE red 553](history/STATE-2026-11-05.md#L553) |
| BL-H-0394 | ostalo / historijski kontekst | [STATE red 554](history/STATE-2026-11-05.md#L554) |
| BL-H-0395 | ostalo / historijski kontekst | [STATE red 555](history/STATE-2026-11-05.md#L555) |
| BL-H-0396 | ostalo / historijski kontekst | [STATE red 557](history/STATE-2026-11-05.md#L557) |
| BL-H-0397 | ostalo / historijski kontekst | [STATE red 558](history/STATE-2026-11-05.md#L558) |
| BL-H-0398 | ostalo / historijski kontekst | [STATE red 559](history/STATE-2026-11-05.md#L559) |
| BL-H-0399 | ostalo / historijski kontekst | [STATE red 560](history/STATE-2026-11-05.md#L560) |
| BL-H-0400 | idempotentnost/retry | [STATE red 561](history/STATE-2026-11-05.md#L561) |
| BL-H-0401 | legacy/infrastruktura | [STATE red 562](history/STATE-2026-11-05.md#L562) |
| BL-H-0402 | post-commit efekti | [STATE red 563](history/STATE-2026-11-05.md#L563) |
| BL-H-0403 | idempotentnost/retry | [STATE red 564](history/STATE-2026-11-05.md#L564) |
| BL-H-0404 | ostalo / historijski kontekst | [STATE red 565](history/STATE-2026-11-05.md#L565) |
| BL-H-0405 | ostalo / historijski kontekst | [STATE red 567](history/STATE-2026-11-05.md#L567) |
| BL-H-0406 | sesija/auth | [STATE red 568](history/STATE-2026-11-05.md#L568) |
| BL-H-0407 | tenant/prava | [STATE red 569](history/STATE-2026-11-05.md#L569) |
| BL-H-0408 | sesija/auth | [STATE red 570](history/STATE-2026-11-05.md#L570) |
| BL-H-0409 | sesija/auth | [STATE red 571](history/STATE-2026-11-05.md#L571) |
| BL-H-0410 | sesija/auth | [STATE red 572](history/STATE-2026-11-05.md#L572) |
| BL-H-0411 | ostalo / historijski kontekst | [STATE red 573](history/STATE-2026-11-05.md#L573) |
| BL-H-0412 | sesija/auth | [STATE red 574](history/STATE-2026-11-05.md#L574) |
| BL-H-0413 | sesija/auth | [STATE red 575](history/STATE-2026-11-05.md#L575) |
| BL-H-0414 | sesija/auth | [STATE red 576](history/STATE-2026-11-05.md#L576) |
| BL-H-0415 | sesija/auth | [STATE red 577](history/STATE-2026-11-05.md#L577) |
| BL-H-0416 | sesija/auth | [STATE red 578](history/STATE-2026-11-05.md#L578) |
| BL-H-0417 | tenant/prava | [STATE red 579](history/STATE-2026-11-05.md#L579) |
| BL-H-0418 | ostalo / historijski kontekst | [STATE red 580](history/STATE-2026-11-05.md#L580) |
| BL-H-0419 | ostalo / historijski kontekst | [STATE red 581](history/STATE-2026-11-05.md#L581) |
| BL-H-0420 | tenant/prava | [STATE red 583](history/STATE-2026-11-05.md#L583) |
| BL-H-0421 | sesija/auth | [STATE red 584](history/STATE-2026-11-05.md#L584) |
| BL-H-0422 | legacy/infrastruktura | [STATE red 585](history/STATE-2026-11-05.md#L585) |
| BL-H-0423 | ostalo / historijski kontekst | [STATE red 586](history/STATE-2026-11-05.md#L586) |
| BL-H-0424 | tenant/prava | [STATE red 587](history/STATE-2026-11-05.md#L587) |
| BL-H-0425 | tenant/prava | [STATE red 588](history/STATE-2026-11-05.md#L588) |
| BL-H-0426 | tenant/prava | [STATE red 589](history/STATE-2026-11-05.md#L589) |
| BL-H-0427 | ostalo / historijski kontekst | [STATE red 590](history/STATE-2026-11-05.md#L590) |
| BL-H-0428 | tenant/prava | [STATE red 591](history/STATE-2026-11-05.md#L591) |
| BL-H-0429 | legacy/infrastruktura | [STATE red 592](history/STATE-2026-11-05.md#L592) |
| BL-H-0430 | ostalo / historijski kontekst | [STATE red 593](history/STATE-2026-11-05.md#L593) |
| BL-H-0431 | legacy/infrastruktura | [STATE red 594](history/STATE-2026-11-05.md#L594) |
| BL-H-0432 | legacy/infrastruktura | [STATE red 595](history/STATE-2026-11-05.md#L595) |
| BL-H-0433 | ostalo / historijski kontekst | [STATE red 596](history/STATE-2026-11-05.md#L596) |
| BL-H-0434 | ostalo / historijski kontekst | [STATE red 597](history/STATE-2026-11-05.md#L597) |
| BL-H-0435 | post-commit efekti | [STATE red 599](history/STATE-2026-11-05.md#L599) |
| BL-H-0436 | post-commit efekti | [STATE red 600](history/STATE-2026-11-05.md#L600) |
| BL-H-0437 | post-commit efekti | [STATE red 601](history/STATE-2026-11-05.md#L601) |
| BL-H-0438 | idempotentnost/retry | [STATE red 602](history/STATE-2026-11-05.md#L602) |
| BL-H-0439 | idempotentnost/retry | [STATE red 603](history/STATE-2026-11-05.md#L603) |
| BL-H-0440 | ostalo / historijski kontekst | [STATE red 604](history/STATE-2026-11-05.md#L604) |
| BL-H-0441 | tenant/prava | [STATE red 605](history/STATE-2026-11-05.md#L605) |
| BL-H-0442 | ostalo / historijski kontekst | [STATE red 606](history/STATE-2026-11-05.md#L606) |
| BL-H-0443 | legacy/infrastruktura | [STATE red 607](history/STATE-2026-11-05.md#L607) |
| BL-H-0444 | ostalo / historijski kontekst | [STATE red 608](history/STATE-2026-11-05.md#L608) |
| BL-H-0445 | ostalo / historijski kontekst | [STATE red 609](history/STATE-2026-11-05.md#L609) |
| BL-H-0446 | post-commit efekti | [STATE red 610](history/STATE-2026-11-05.md#L610) |
| BL-H-0447 | legacy/infrastruktura | [STATE red 611](history/STATE-2026-11-05.md#L611) |
| BL-H-0448 | ostalo / historijski kontekst | [STATE red 612](history/STATE-2026-11-05.md#L612) |
| BL-H-0449 | post-commit efekti | [STATE red 613](history/STATE-2026-11-05.md#L613) |
| BL-H-0450 | ostalo / historijski kontekst | [STATE red 615](history/STATE-2026-11-05.md#L615) |
| BL-H-0451 | ostalo / historijski kontekst | [STATE red 616](history/STATE-2026-11-05.md#L616) |
| BL-H-0452 | tenant/prava | [STATE red 617](history/STATE-2026-11-05.md#L617) |
| BL-H-0453 | novac/decimale | [STATE red 618](history/STATE-2026-11-05.md#L618) |
| BL-H-0454 | novac/decimale | [STATE red 619](history/STATE-2026-11-05.md#L619) |
| BL-H-0455 | ostalo / historijski kontekst | [STATE red 620](history/STATE-2026-11-05.md#L620) |
| BL-H-0456 | legacy/infrastruktura | [STATE red 621](history/STATE-2026-11-05.md#L621) |
| BL-H-0457 | ostalo / historijski kontekst | [STATE red 622](history/STATE-2026-11-05.md#L622) |
| BL-H-0458 | post-commit efekti | [STATE red 623](history/STATE-2026-11-05.md#L623) |
| BL-H-0459 | post-commit efekti | [STATE red 624](history/STATE-2026-11-05.md#L624) |
| BL-H-0460 | ostalo / historijski kontekst | [STATE red 625](history/STATE-2026-11-05.md#L625) |
| BL-H-0461 | legacy/infrastruktura | [STATE red 626](history/STATE-2026-11-05.md#L626) |
| BL-H-0462 | novac/decimale | [STATE red 627](history/STATE-2026-11-05.md#L627) |
| BL-H-0463 | novac/decimale | [STATE red 628](history/STATE-2026-11-05.md#L628) |
| BL-H-0464 | ostalo / historijski kontekst | [STATE red 629](history/STATE-2026-11-05.md#L629) |
| BL-H-0465 | ostalo / historijski kontekst | [STATE red 630](history/STATE-2026-11-05.md#L630) |
| BL-H-0466 | ostalo / historijski kontekst | [STATE red 631](history/STATE-2026-11-05.md#L631) |
| BL-H-0467 | legacy/infrastruktura | [STATE red 633](history/STATE-2026-11-05.md#L633) |
| BL-H-0468 | ostalo / historijski kontekst | [STATE red 634](history/STATE-2026-11-05.md#L634) |
| BL-H-0469 | ostalo / historijski kontekst | [STATE red 635](history/STATE-2026-11-05.md#L635) |
| BL-H-0470 | ostalo / historijski kontekst | [STATE red 636](history/STATE-2026-11-05.md#L636) |
| BL-H-0471 | legacy/infrastruktura | [STATE red 637](history/STATE-2026-11-05.md#L637) |
| BL-H-0472 | ostalo / historijski kontekst | [STATE red 638](history/STATE-2026-11-05.md#L638) |
| BL-H-0473 | ostalo / historijski kontekst | [STATE red 639](history/STATE-2026-11-05.md#L639) |
| BL-H-0474 | ostalo / historijski kontekst | [STATE red 640](history/STATE-2026-11-05.md#L640) |
| BL-H-0475 | legacy/infrastruktura | [STATE red 641](history/STATE-2026-11-05.md#L641) |
| BL-H-0476 | ostalo / historijski kontekst | [STATE red 642](history/STATE-2026-11-05.md#L642) |
| BL-H-0477 | ostalo / historijski kontekst | [STATE red 643](history/STATE-2026-11-05.md#L643) |
| BL-H-0478 | ostalo / historijski kontekst | [STATE red 644](history/STATE-2026-11-05.md#L644) |
| BL-H-0479 | post-commit efekti | [STATE red 645](history/STATE-2026-11-05.md#L645) |
| BL-H-0480 | post-commit efekti | [STATE red 647](history/STATE-2026-11-05.md#L647) |
| BL-H-0481 | sesija/auth | [STATE red 648](history/STATE-2026-11-05.md#L648) |
| BL-H-0482 | ostalo / historijski kontekst | [STATE red 649](history/STATE-2026-11-05.md#L649) |
| BL-H-0483 | idempotentnost/retry | [STATE red 650](history/STATE-2026-11-05.md#L650) |
| BL-H-0484 | legacy/infrastruktura | [STATE red 651](history/STATE-2026-11-05.md#L651) |
| BL-H-0485 | post-commit efekti | [STATE red 652](history/STATE-2026-11-05.md#L652) |
| BL-H-0486 | post-commit efekti | [STATE red 653](history/STATE-2026-11-05.md#L653) |
| BL-H-0487 | post-commit efekti | [STATE red 654](history/STATE-2026-11-05.md#L654) |
| BL-H-0488 | post-commit efekti | [STATE red 655](history/STATE-2026-11-05.md#L655) |
| BL-H-0489 | sesija/auth | [STATE red 656](history/STATE-2026-11-05.md#L656) |
| BL-H-0490 | ostalo / historijski kontekst | [STATE red 657](history/STATE-2026-11-05.md#L657) |
| BL-H-0491 | tenant/prava | [STATE red 658](history/STATE-2026-11-05.md#L658) |
| BL-H-0492 | ostalo / historijski kontekst | [STATE red 659](history/STATE-2026-11-05.md#L659) |
| BL-H-0493 | post-commit efekti | [STATE red 660](history/STATE-2026-11-05.md#L660) |
| BL-H-0494 | legacy/infrastruktura | [STATE red 662](history/STATE-2026-11-05.md#L662) |
| BL-H-0495 | idempotentnost/retry | [STATE red 663](history/STATE-2026-11-05.md#L663) |
| BL-H-0496 | post-commit efekti | [STATE red 664](history/STATE-2026-11-05.md#L664) |
| BL-H-0497 | post-commit efekti | [STATE red 665](history/STATE-2026-11-05.md#L665) |
| BL-H-0498 | post-commit efekti | [STATE red 666](history/STATE-2026-11-05.md#L666) |
| BL-H-0499 | post-commit efekti | [STATE red 667](history/STATE-2026-11-05.md#L667) |
| BL-H-0500 | legacy/infrastruktura | [STATE red 668](history/STATE-2026-11-05.md#L668) |
| BL-H-0501 | sesija/auth | [STATE red 669](history/STATE-2026-11-05.md#L669) |
| BL-H-0502 | legacy/infrastruktura | [STATE red 670](history/STATE-2026-11-05.md#L670) |
| BL-H-0503 | legacy/infrastruktura | [STATE red 671](history/STATE-2026-11-05.md#L671) |
| BL-H-0504 | legacy/infrastruktura | [STATE red 672](history/STATE-2026-11-05.md#L672) |
| BL-H-0505 | ostalo / historijski kontekst | [STATE red 673](history/STATE-2026-11-05.md#L673) |
| BL-H-0506 | ostalo / historijski kontekst | [STATE red 674](history/STATE-2026-11-05.md#L674) |
| BL-H-0507 | post-commit efekti | [STATE red 675](history/STATE-2026-11-05.md#L675) |
| BL-H-0508 | ostalo / historijski kontekst | [STATE red 676](history/STATE-2026-11-05.md#L676) |
| BL-H-0509 | ostalo / historijski kontekst | [STATE red 678](history/STATE-2026-11-05.md#L678) |
| BL-H-0510 | ostalo / historijski kontekst | [STATE red 679](history/STATE-2026-11-05.md#L679) |
| BL-H-0511 | legacy/infrastruktura | [STATE red 680](history/STATE-2026-11-05.md#L680) |
| BL-H-0512 | legacy/infrastruktura | [STATE red 681](history/STATE-2026-11-05.md#L681) |
| BL-H-0513 | ostalo / historijski kontekst | [STATE red 682](history/STATE-2026-11-05.md#L682) |
| BL-H-0514 | ostalo / historijski kontekst | [STATE red 683](history/STATE-2026-11-05.md#L683) |
| BL-H-0515 | legacy/infrastruktura | [STATE red 684](history/STATE-2026-11-05.md#L684) |
| BL-H-0516 | legacy/infrastruktura | [STATE red 685](history/STATE-2026-11-05.md#L685) |
| BL-H-0517 | ostalo / historijski kontekst | [STATE red 686](history/STATE-2026-11-05.md#L686) |
| BL-H-0518 | ostalo / historijski kontekst | [STATE red 687](history/STATE-2026-11-05.md#L687) |
| BL-H-0519 | ostalo / historijski kontekst | [STATE red 688](history/STATE-2026-11-05.md#L688) |
| BL-H-0520 | post-commit efekti | [STATE red 689](history/STATE-2026-11-05.md#L689) |
| BL-H-0521 | legacy/infrastruktura | [STATE red 690](history/STATE-2026-11-05.md#L690) |
| BL-H-0522 | post-commit efekti | [STATE red 691](history/STATE-2026-11-05.md#L691) |
| BL-H-0523 | legacy/infrastruktura | [STATE red 693](history/STATE-2026-11-05.md#L693) |
| BL-H-0524 | legacy/infrastruktura | [STATE red 694](history/STATE-2026-11-05.md#L694) |
| BL-H-0525 | legacy/infrastruktura | [STATE red 695](history/STATE-2026-11-05.md#L695) |
| BL-H-0526 | ostalo / historijski kontekst | [STATE red 696](history/STATE-2026-11-05.md#L696) |
| BL-H-0527 | novac/decimale | [STATE red 697](history/STATE-2026-11-05.md#L697) |
| BL-H-0528 | idempotentnost/retry | [STATE red 698](history/STATE-2026-11-05.md#L698) |
| BL-H-0529 | ostalo / historijski kontekst | [STATE red 699](history/STATE-2026-11-05.md#L699) |
| BL-H-0530 | ostalo / historijski kontekst | [STATE red 700](history/STATE-2026-11-05.md#L700) |
| BL-H-0531 | sesija/auth | [STATE red 701](history/STATE-2026-11-05.md#L701) |
| BL-H-0532 | ostalo / historijski kontekst | [STATE red 702](history/STATE-2026-11-05.md#L702) |
| BL-H-0533 | post-commit efekti | [STATE red 703](history/STATE-2026-11-05.md#L703) |
| BL-H-0534 | ostalo / historijski kontekst | [STATE red 704](history/STATE-2026-11-05.md#L704) |
| BL-H-0535 | post-commit efekti | [STATE red 705](history/STATE-2026-11-05.md#L705) |
| BL-H-0536 | legacy/infrastruktura | [STATE red 707](history/STATE-2026-11-05.md#L707) |
| BL-H-0537 | legacy/infrastruktura | [STATE red 708](history/STATE-2026-11-05.md#L708) |
| BL-H-0538 | ostalo / historijski kontekst | [STATE red 709](history/STATE-2026-11-05.md#L709) |
| BL-H-0539 | post-commit efekti | [STATE red 710](history/STATE-2026-11-05.md#L710) |
| BL-H-0540 | ostalo / historijski kontekst | [STATE red 711](history/STATE-2026-11-05.md#L711) |
| BL-H-0541 | ostalo / historijski kontekst | [STATE red 712](history/STATE-2026-11-05.md#L712) |
| BL-H-0542 | ostalo / historijski kontekst | [STATE red 713](history/STATE-2026-11-05.md#L713) |
| BL-H-0543 | ostalo / historijski kontekst | [STATE red 714](history/STATE-2026-11-05.md#L714) |
| BL-H-0544 | ostalo / historijski kontekst | [STATE red 715](history/STATE-2026-11-05.md#L715) |
| BL-H-0545 | post-commit efekti | [STATE red 716](history/STATE-2026-11-05.md#L716) |
| BL-H-0546 | ostalo / historijski kontekst | [STATE red 717](history/STATE-2026-11-05.md#L717) |
| BL-H-0547 | ostalo / historijski kontekst | [STATE red 718](history/STATE-2026-11-05.md#L718) |
| BL-H-0548 | post-commit efekti | [STATE red 719](history/STATE-2026-11-05.md#L719) |
| BL-H-0549 | legacy/infrastruktura | [STATE red 720](history/STATE-2026-11-05.md#L720) |
| BL-H-0550 | ostalo / historijski kontekst | [STATE red 721](history/STATE-2026-11-05.md#L721) |
| BL-H-0551 | legacy/infrastruktura | [STATE red 722](history/STATE-2026-11-05.md#L722) |
| BL-H-0552 | post-commit efekti | [STATE red 723](history/STATE-2026-11-05.md#L723) |
| BL-H-0553 | legacy/infrastruktura | [STATE red 724](history/STATE-2026-11-05.md#L724) |
| BL-H-0554 | post-commit efekti | [STATE red 725](history/STATE-2026-11-05.md#L725) |
| BL-H-0555 | post-commit efekti | [STATE red 726](history/STATE-2026-11-05.md#L726) |
| BL-H-0556 | post-commit efekti | [STATE red 727](history/STATE-2026-11-05.md#L727) |
| BL-H-0557 | ostalo / historijski kontekst | [STATE red 728](history/STATE-2026-11-05.md#L728) |
| BL-H-0558 | ostalo / historijski kontekst | [STATE red 729](history/STATE-2026-11-05.md#L729) |
| BL-H-0559 | post-commit efekti | [STATE red 730](history/STATE-2026-11-05.md#L730) |
| BL-H-0560 | ostalo / historijski kontekst | [STATE red 731](history/STATE-2026-11-05.md#L731) |
| BL-H-0561 | ostalo / historijski kontekst | [STATE red 732](history/STATE-2026-11-05.md#L732) |
| BL-H-0562 | ostalo / historijski kontekst | [STATE red 734](history/STATE-2026-11-05.md#L734) |
| BL-H-0563 | ostalo / historijski kontekst | [STATE red 735](history/STATE-2026-11-05.md#L735) |
| BL-H-0564 | ostalo / historijski kontekst | [STATE red 736](history/STATE-2026-11-05.md#L736) |
| BL-H-0565 | ostalo / historijski kontekst | [STATE red 737](history/STATE-2026-11-05.md#L737) |
| BL-H-0566 | ostalo / historijski kontekst | [STATE red 738](history/STATE-2026-11-05.md#L738) |
| BL-H-0567 | ostalo / historijski kontekst | [STATE red 739](history/STATE-2026-11-05.md#L739) |
| BL-H-0568 | tenant/prava | [STATE red 740](history/STATE-2026-11-05.md#L740) |
| BL-H-0569 | idempotentnost/retry | [STATE red 741](history/STATE-2026-11-05.md#L741) |
| BL-H-0570 | idempotentnost/retry | [STATE red 742](history/STATE-2026-11-05.md#L742) |
| BL-H-0571 | legacy/infrastruktura | [STATE red 743](history/STATE-2026-11-05.md#L743) |
| BL-H-0572 | legacy/infrastruktura | [STATE red 744](history/STATE-2026-11-05.md#L744) |
| BL-H-0573 | ostalo / historijski kontekst | [STATE red 745](history/STATE-2026-11-05.md#L745) |
| BL-H-0574 | FE nacrti/oporavak | [STATE red 746](history/STATE-2026-11-05.md#L746) |
| BL-H-0575 | ostalo / historijski kontekst | [STATE red 747](history/STATE-2026-11-05.md#L747) |
| BL-H-0576 | legacy/infrastruktura | [STATE red 748](history/STATE-2026-11-05.md#L748) |
| BL-H-0577 | idempotentnost/retry | [STATE red 749](history/STATE-2026-11-05.md#L749) |
| BL-H-0578 | ostalo / historijski kontekst | [STATE red 750](history/STATE-2026-11-05.md#L750) |
| BL-H-0579 | post-commit efekti | [STATE red 751](history/STATE-2026-11-05.md#L751) |
| BL-H-0580 | legacy/infrastruktura | [STATE red 752](history/STATE-2026-11-05.md#L752) |
| BL-H-0581 | tenant/prava | [STATE red 753](history/STATE-2026-11-05.md#L753) |
| BL-H-0582 | ostalo / historijski kontekst | [STATE red 754](history/STATE-2026-11-05.md#L754) |
| BL-H-0583 | ostalo / historijski kontekst | [STATE red 755](history/STATE-2026-11-05.md#L755) |
| BL-H-0584 | legacy/infrastruktura | [STATE red 756](history/STATE-2026-11-05.md#L756) |
| BL-H-0585 | legacy/infrastruktura | [STATE red 757](history/STATE-2026-11-05.md#L757) |
| BL-H-0586 | ostalo / historijski kontekst | [STATE red 758](history/STATE-2026-11-05.md#L758) |
| BL-H-0587 | legacy/infrastruktura | [STATE red 759](history/STATE-2026-11-05.md#L759) |
| BL-H-0588 | ostalo / historijski kontekst | [STATE red 761](history/STATE-2026-11-05.md#L761) |
| BL-H-0589 | ostalo / historijski kontekst | [STATE red 762](history/STATE-2026-11-05.md#L762) |
| BL-H-0590 | tenant/prava | [STATE red 763](history/STATE-2026-11-05.md#L763) |
| BL-H-0591 | ostalo / historijski kontekst | [STATE red 764](history/STATE-2026-11-05.md#L764) |
| BL-H-0592 | ostalo / historijski kontekst | [STATE red 765](history/STATE-2026-11-05.md#L765) |
| BL-H-0593 | ostalo / historijski kontekst | [STATE red 766](history/STATE-2026-11-05.md#L766) |
| BL-H-0594 | ostalo / historijski kontekst | [STATE red 767](history/STATE-2026-11-05.md#L767) |
| BL-H-0595 | ostalo / historijski kontekst | [STATE red 768](history/STATE-2026-11-05.md#L768) |
| BL-H-0596 | legacy/infrastruktura | [STATE red 769](history/STATE-2026-11-05.md#L769) |
| BL-H-0597 | ostalo / historijski kontekst | [STATE red 770](history/STATE-2026-11-05.md#L770) |
| BL-H-0598 | ostalo / historijski kontekst | [STATE red 771](history/STATE-2026-11-05.md#L771) |
| BL-H-0599 | ostalo / historijski kontekst | [STATE red 772](history/STATE-2026-11-05.md#L772) |
| BL-H-0600 | ostalo / historijski kontekst | [STATE red 773](history/STATE-2026-11-05.md#L773) |
| BL-H-0601 | ostalo / historijski kontekst | [STATE red 774](history/STATE-2026-11-05.md#L774) |
| BL-H-0602 | legacy/infrastruktura | [STATE red 775](history/STATE-2026-11-05.md#L775) |
| BL-H-0603 | legacy/infrastruktura | [STATE red 776](history/STATE-2026-11-05.md#L776) |
| BL-H-0604 | post-commit efekti | [STATE red 778](history/STATE-2026-11-05.md#L778) |
| BL-H-0605 | sesija/auth | [STATE red 779](history/STATE-2026-11-05.md#L779) |
| BL-H-0606 | post-commit efekti | [STATE red 780](history/STATE-2026-11-05.md#L780) |
| BL-H-0607 | ostalo / historijski kontekst | [STATE red 781](history/STATE-2026-11-05.md#L781) |
| BL-H-0608 | ostalo / historijski kontekst | [STATE red 782](history/STATE-2026-11-05.md#L782) |
| BL-H-0609 | ostalo / historijski kontekst | [STATE red 783](history/STATE-2026-11-05.md#L783) |
| BL-H-0610 | post-commit efekti | [STATE red 784](history/STATE-2026-11-05.md#L784) |
| BL-H-0611 | legacy/infrastruktura | [STATE red 785](history/STATE-2026-11-05.md#L785) |
| BL-H-0612 | ostalo / historijski kontekst | [STATE red 786](history/STATE-2026-11-05.md#L786) |
| BL-H-0613 | sesija/auth | [STATE red 787](history/STATE-2026-11-05.md#L787) |
| BL-H-0614 | ostalo / historijski kontekst | [STATE red 788](history/STATE-2026-11-05.md#L788) |
| BL-H-0615 | legacy/infrastruktura | [STATE red 789](history/STATE-2026-11-05.md#L789) |
| BL-H-0616 | ostalo / historijski kontekst | [STATE red 790](history/STATE-2026-11-05.md#L790) |
| BL-H-0617 | ostalo / historijski kontekst | [STATE red 791](history/STATE-2026-11-05.md#L791) |
| BL-H-0618 | post-commit efekti | [STATE red 792](history/STATE-2026-11-05.md#L792) |
| BL-H-0619 | post-commit efekti | [STATE red 793](history/STATE-2026-11-05.md#L793) |
| BL-H-0620 | post-commit efekti | [STATE red 794](history/STATE-2026-11-05.md#L794) |
| BL-H-0621 | ostalo / historijski kontekst | [STATE red 795](history/STATE-2026-11-05.md#L795) |
| BL-H-0622 | sesija/auth | [STATE red 796](history/STATE-2026-11-05.md#L796) |
| BL-H-0623 | ostalo / historijski kontekst | [STATE red 797](history/STATE-2026-11-05.md#L797) |
| BL-H-0624 | legacy/infrastruktura | [STATE red 798](history/STATE-2026-11-05.md#L798) |
| BL-H-0625 | legacy/infrastruktura | [STATE red 799](history/STATE-2026-11-05.md#L799) |
| BL-H-0626 | legacy/infrastruktura | [STATE red 800](history/STATE-2026-11-05.md#L800) |
| BL-H-0627 | sesija/auth | [STATE red 801](history/STATE-2026-11-05.md#L801) |
| BL-H-0628 | ostalo / historijski kontekst | [STATE red 802](history/STATE-2026-11-05.md#L802) |
| BL-H-0629 | post-commit efekti | [STATE red 803](history/STATE-2026-11-05.md#L803) |
| BL-H-0630 | ostalo / historijski kontekst | [STATE red 804](history/STATE-2026-11-05.md#L804) |
| BL-H-0631 | ostalo / historijski kontekst | [STATE red 806](history/STATE-2026-11-05.md#L806) |
| BL-H-0632 | sesija/auth | [STATE red 807](history/STATE-2026-11-05.md#L807) |
| BL-H-0633 | ostalo / historijski kontekst | [STATE red 808](history/STATE-2026-11-05.md#L808) |
| BL-H-0634 | post-commit efekti | [STATE red 809](history/STATE-2026-11-05.md#L809) |
| BL-H-0635 | novac/decimale | [STATE red 810](history/STATE-2026-11-05.md#L810) |
| BL-H-0636 | post-commit efekti | [STATE red 811](history/STATE-2026-11-05.md#L811) |
| BL-H-0637 | idempotentnost/retry | [STATE red 812](history/STATE-2026-11-05.md#L812) |
| BL-H-0638 | ostalo / historijski kontekst | [STATE red 813](history/STATE-2026-11-05.md#L813) |
| BL-H-0639 | legacy/infrastruktura | [STATE red 814](history/STATE-2026-11-05.md#L814) |
| BL-H-0640 | ostalo / historijski kontekst | [STATE red 815](history/STATE-2026-11-05.md#L815) |
| BL-H-0641 | ostalo / historijski kontekst | [STATE red 816](history/STATE-2026-11-05.md#L816) |
| BL-H-0642 | legacy/infrastruktura | [STATE red 817](history/STATE-2026-11-05.md#L817) |
| BL-H-0643 | ostalo / historijski kontekst | [STATE red 818](history/STATE-2026-11-05.md#L818) |
| BL-H-0644 | ostalo / historijski kontekst | [STATE red 819](history/STATE-2026-11-05.md#L819) |
| BL-H-0645 | ostalo / historijski kontekst | [STATE red 820](history/STATE-2026-11-05.md#L820) |
| BL-H-0646 | post-commit efekti | [STATE red 821](history/STATE-2026-11-05.md#L821) |
| BL-H-0647 | legacy/infrastruktura | [STATE red 822](history/STATE-2026-11-05.md#L822) |
| BL-H-0648 | ostalo / historijski kontekst | [STATE red 823](history/STATE-2026-11-05.md#L823) |
| BL-H-0649 | post-commit efekti | [STATE red 824](history/STATE-2026-11-05.md#L824) |
| BL-H-0650 | ostalo / historijski kontekst | [STATE red 825](history/STATE-2026-11-05.md#L825) |
| BL-H-0651 | post-commit efekti | [STATE red 826](history/STATE-2026-11-05.md#L826) |
| BL-H-0652 | legacy/infrastruktura | [STATE red 827](history/STATE-2026-11-05.md#L827) |
| BL-H-0653 | novac/decimale | [STATE red 828](history/STATE-2026-11-05.md#L828) |
| BL-H-0654 | ostalo / historijski kontekst | [STATE red 829](history/STATE-2026-11-05.md#L829) |
| BL-H-0655 | ostalo / historijski kontekst | [STATE red 830](history/STATE-2026-11-05.md#L830) |
| BL-H-0656 | legacy/infrastruktura | [STATE red 831](history/STATE-2026-11-05.md#L831) |
| BL-H-0657 | ostalo / historijski kontekst | [STATE red 833](history/STATE-2026-11-05.md#L833) |
| BL-H-0658 | legacy/infrastruktura | [STATE red 834](history/STATE-2026-11-05.md#L834) |
| BL-H-0659 | ostalo / historijski kontekst | [STATE red 835](history/STATE-2026-11-05.md#L835) |
| BL-H-0660 | ostalo / historijski kontekst | [STATE red 836](history/STATE-2026-11-05.md#L836) |
| BL-H-0661 | legacy/infrastruktura | [STATE red 837](history/STATE-2026-11-05.md#L837) |
| BL-H-0662 | ostalo / historijski kontekst | [STATE red 838](history/STATE-2026-11-05.md#L838) |
| BL-H-0663 | ostalo / historijski kontekst | [STATE red 839](history/STATE-2026-11-05.md#L839) |
| BL-H-0664 | legacy/infrastruktura | [STATE red 840](history/STATE-2026-11-05.md#L840) |
| BL-H-0665 | ostalo / historijski kontekst | [STATE red 841](history/STATE-2026-11-05.md#L841) |
| BL-H-0666 | post-commit efekti | [STATE red 842](history/STATE-2026-11-05.md#L842) |
| BL-H-0667 | post-commit efekti | [STATE red 843](history/STATE-2026-11-05.md#L843) |
| BL-H-0668 | ostalo / historijski kontekst | [STATE red 844](history/STATE-2026-11-05.md#L844) |
| BL-H-0669 | tenant/prava | [STATE red 845](history/STATE-2026-11-05.md#L845) |
| BL-H-0670 | ostalo / historijski kontekst | [STATE red 846](history/STATE-2026-11-05.md#L846) |
| BL-H-0671 | tenant/prava | [STATE red 847](history/STATE-2026-11-05.md#L847) |
| BL-H-0672 | ostalo / historijski kontekst | [STATE red 848](history/STATE-2026-11-05.md#L848) |
| BL-H-0673 | ostalo / historijski kontekst | [STATE red 849](history/STATE-2026-11-05.md#L849) |
| BL-H-0674 | ostalo / historijski kontekst | [STATE red 850](history/STATE-2026-11-05.md#L850) |
| BL-H-0675 | ostalo / historijski kontekst | [STATE red 851](history/STATE-2026-11-05.md#L851) |
| BL-H-0676 | ostalo / historijski kontekst | [STATE red 852](history/STATE-2026-11-05.md#L852) |
| BL-H-0677 | ostalo / historijski kontekst | [STATE red 853](history/STATE-2026-11-05.md#L853) |
| BL-H-0678 | legacy/infrastruktura | [STATE red 854](history/STATE-2026-11-05.md#L854) |
| BL-H-0679 | ostalo / historijski kontekst | [STATE red 855](history/STATE-2026-11-05.md#L855) |
| BL-H-0680 | legacy/infrastruktura | [STATE red 856](history/STATE-2026-11-05.md#L856) |
| BL-H-0681 | ostalo / historijski kontekst | [STATE red 857](history/STATE-2026-11-05.md#L857) |
| BL-H-0682 | ostalo / historijski kontekst | [STATE red 858](history/STATE-2026-11-05.md#L858) |
| BL-H-0683 | ostalo / historijski kontekst | [STATE red 859](history/STATE-2026-11-05.md#L859) |
| BL-H-0684 | legacy/infrastruktura | [STATE red 860](history/STATE-2026-11-05.md#L860) |
| BL-H-0685 | legacy/infrastruktura | [STATE red 862](history/STATE-2026-11-05.md#L862) |
| BL-H-0686 | idempotentnost/retry | [STATE red 863](history/STATE-2026-11-05.md#L863) |
| BL-H-0687 | ostalo / historijski kontekst | [STATE red 864](history/STATE-2026-11-05.md#L864) |
| BL-H-0688 | ostalo / historijski kontekst | [STATE red 865](history/STATE-2026-11-05.md#L865) |
| BL-H-0689 | sesija/auth | [STATE red 866](history/STATE-2026-11-05.md#L866) |
| BL-H-0690 | ostalo / historijski kontekst | [STATE red 867](history/STATE-2026-11-05.md#L867) |
| BL-H-0691 | ostalo / historijski kontekst | [STATE red 868](history/STATE-2026-11-05.md#L868) |
| BL-H-0692 | ostalo / historijski kontekst | [STATE red 869](history/STATE-2026-11-05.md#L869) |
| BL-H-0693 | ostalo / historijski kontekst | [STATE red 870](history/STATE-2026-11-05.md#L870) |
| BL-H-0694 | ostalo / historijski kontekst | [STATE red 871](history/STATE-2026-11-05.md#L871) |
| BL-H-0695 | legacy/infrastruktura | [STATE red 872](history/STATE-2026-11-05.md#L872) |
| BL-H-0696 | ostalo / historijski kontekst | [STATE red 873](history/STATE-2026-11-05.md#L873) |
| BL-H-0697 | tenant/prava | [STATE red 874](history/STATE-2026-11-05.md#L874) |
| BL-H-0698 | ostalo / historijski kontekst | [STATE red 875](history/STATE-2026-11-05.md#L875) |
| BL-H-0699 | legacy/infrastruktura | [STATE red 876](history/STATE-2026-11-05.md#L876) |
| BL-H-0700 | ostalo / historijski kontekst | [STATE red 877](history/STATE-2026-11-05.md#L877) |
| BL-H-0701 | ostalo / historijski kontekst | [STATE red 878](history/STATE-2026-11-05.md#L878) |
| BL-H-0702 | legacy/infrastruktura | [STATE red 879](history/STATE-2026-11-05.md#L879) |
| BL-H-0703 | ostalo / historijski kontekst | [STATE red 881](history/STATE-2026-11-05.md#L881) |
| BL-H-0704 | ostalo / historijski kontekst | [STATE red 882](history/STATE-2026-11-05.md#L882) |
| BL-H-0705 | ostalo / historijski kontekst | [STATE red 883](history/STATE-2026-11-05.md#L883) |
| BL-H-0706 | ostalo / historijski kontekst | [STATE red 884](history/STATE-2026-11-05.md#L884) |
| BL-H-0707 | ostalo / historijski kontekst | [STATE red 885](history/STATE-2026-11-05.md#L885) |
| BL-H-0708 | legacy/infrastruktura | [STATE red 886](history/STATE-2026-11-05.md#L886) |
| BL-H-0709 | ostalo / historijski kontekst | [STATE red 887](history/STATE-2026-11-05.md#L887) |
| BL-H-0710 | idempotentnost/retry | [STATE red 888](history/STATE-2026-11-05.md#L888) |
| BL-H-0711 | idempotentnost/retry | [STATE red 889](history/STATE-2026-11-05.md#L889) |
| BL-H-0712 | ostalo / historijski kontekst | [STATE red 890](history/STATE-2026-11-05.md#L890) |
| BL-H-0713 | legacy/infrastruktura | [STATE red 891](history/STATE-2026-11-05.md#L891) |
| BL-H-0714 | ostalo / historijski kontekst | [STATE red 892](history/STATE-2026-11-05.md#L892) |
| BL-H-0715 | ostalo / historijski kontekst | [STATE red 893](history/STATE-2026-11-05.md#L893) |
| BL-H-0716 | legacy/infrastruktura | [STATE red 894](history/STATE-2026-11-05.md#L894) |
| BL-H-0717 | ostalo / historijski kontekst | [STATE red 895](history/STATE-2026-11-05.md#L895) |
| BL-H-0718 | idempotentnost/retry | [STATE red 896](history/STATE-2026-11-05.md#L896) |
| BL-H-0719 | legacy/infrastruktura | [STATE red 897](history/STATE-2026-11-05.md#L897) |
| BL-H-0720 | ostalo / historijski kontekst | [STATE red 898](history/STATE-2026-11-05.md#L898) |
| BL-H-0721 | idempotentnost/retry | [STATE red 899](history/STATE-2026-11-05.md#L899) |
| BL-H-0722 | ostalo / historijski kontekst | [STATE red 900](history/STATE-2026-11-05.md#L900) |
| BL-H-0723 | legacy/infrastruktura | [STATE red 901](history/STATE-2026-11-05.md#L901) |
| BL-H-0724 | ostalo / historijski kontekst | [STATE red 902](history/STATE-2026-11-05.md#L902) |
| BL-H-0725 | legacy/infrastruktura | [STATE red 903](history/STATE-2026-11-05.md#L903) |
| BL-H-0726 | ostalo / historijski kontekst | [STATE red 904](history/STATE-2026-11-05.md#L904) |
| BL-H-0727 | ostalo / historijski kontekst | [STATE red 905](history/STATE-2026-11-05.md#L905) |
| BL-H-0728 | post-commit efekti | [STATE red 906](history/STATE-2026-11-05.md#L906) |
| BL-H-0729 | ostalo / historijski kontekst | [STATE red 907](history/STATE-2026-11-05.md#L907) |
| BL-H-0730 | legacy/infrastruktura | [STATE red 908](history/STATE-2026-11-05.md#L908) |
| BL-H-0731 | ostalo / historijski kontekst | [STATE red 909](history/STATE-2026-11-05.md#L909) |
| BL-H-0732 | legacy/infrastruktura | [STATE red 910](history/STATE-2026-11-05.md#L910) |
| BL-H-0733 | ostalo / historijski kontekst | [STATE red 911](history/STATE-2026-11-05.md#L911) |
| BL-H-0734 | ostalo / historijski kontekst | [STATE red 912](history/STATE-2026-11-05.md#L912) |
| BL-H-0735 | ostalo / historijski kontekst | [STATE red 913](history/STATE-2026-11-05.md#L913) |
| BL-H-0736 | ostalo / historijski kontekst | [STATE red 914](history/STATE-2026-11-05.md#L914) |
| BL-H-0737 | legacy/infrastruktura | [STATE red 915](history/STATE-2026-11-05.md#L915) |
| BL-H-0738 | legacy/infrastruktura | [STATE red 916](history/STATE-2026-11-05.md#L916) |
| BL-H-0739 | ostalo / historijski kontekst | [STATE red 917](history/STATE-2026-11-05.md#L917) |
| BL-H-0740 | ostalo / historijski kontekst | [STATE red 918](history/STATE-2026-11-05.md#L918) |
| BL-H-0741 | ostalo / historijski kontekst | [STATE red 919](history/STATE-2026-11-05.md#L919) |
| BL-H-0742 | ostalo / historijski kontekst | [STATE red 920](history/STATE-2026-11-05.md#L920) |
| BL-H-0743 | legacy/infrastruktura | [STATE red 921](history/STATE-2026-11-05.md#L921) |
| BL-H-0744 | idempotentnost/retry | [STATE red 922](history/STATE-2026-11-05.md#L922) |
| BL-H-0745 | ostalo / historijski kontekst | [STATE red 923](history/STATE-2026-11-05.md#L923) |
| BL-H-0746 | ostalo / historijski kontekst | [STATE red 924](history/STATE-2026-11-05.md#L924) |
| BL-H-0747 | ostalo / historijski kontekst | [STATE red 925](history/STATE-2026-11-05.md#L925) |
| BL-H-0748 | ostalo / historijski kontekst | [STATE red 926](history/STATE-2026-11-05.md#L926) |
| BL-H-0749 | ostalo / historijski kontekst | [STATE red 927](history/STATE-2026-11-05.md#L927) |
| BL-H-0750 | ostalo / historijski kontekst | [STATE red 928](history/STATE-2026-11-05.md#L928) |
| BL-H-0751 | ostalo / historijski kontekst | [STATE red 929](history/STATE-2026-11-05.md#L929) |
| BL-H-0752 | ostalo / historijski kontekst | [STATE red 930](history/STATE-2026-11-05.md#L930) |
| BL-H-0753 | ostalo / historijski kontekst | [STATE red 931](history/STATE-2026-11-05.md#L931) |
| BL-H-0754 | legacy/infrastruktura | [STATE red 932](history/STATE-2026-11-05.md#L932) |
| BL-H-0755 | ostalo / historijski kontekst | [STATE red 933](history/STATE-2026-11-05.md#L933) |
| BL-H-0756 | legacy/infrastruktura | [STATE red 934](history/STATE-2026-11-05.md#L934) |
| BL-H-0757 | legacy/infrastruktura | [STATE red 935](history/STATE-2026-11-05.md#L935) |
| BL-H-0758 | legacy/infrastruktura | [STATE red 936](history/STATE-2026-11-05.md#L936) |
| BL-H-0759 | legacy/infrastruktura | [STATE red 937](history/STATE-2026-11-05.md#L937) |
| BL-H-0760 | ostalo / historijski kontekst | [STATE red 938](history/STATE-2026-11-05.md#L938) |
| BL-H-0761 | ostalo / historijski kontekst | [STATE red 939](history/STATE-2026-11-05.md#L939) |
| BL-H-0762 | ostalo / historijski kontekst | [STATE red 940](history/STATE-2026-11-05.md#L940) |
| BL-H-0763 | idempotentnost/retry | [STATE red 941](history/STATE-2026-11-05.md#L941) |
| BL-H-0764 | ostalo / historijski kontekst | [STATE red 942](history/STATE-2026-11-05.md#L942) |
| BL-H-0765 | ostalo / historijski kontekst | [STATE red 943](history/STATE-2026-11-05.md#L943) |
| BL-H-0766 | ostalo / historijski kontekst | [STATE red 944](history/STATE-2026-11-05.md#L944) |
| BL-H-0767 | ostalo / historijski kontekst | [STATE red 945](history/STATE-2026-11-05.md#L945) |
| BL-H-0768 | legacy/infrastruktura | [STATE red 946](history/STATE-2026-11-05.md#L946) |
| BL-H-0769 | legacy/infrastruktura | [STATE red 947](history/STATE-2026-11-05.md#L947) |
| BL-H-0770 | ostalo / historijski kontekst | [STATE red 948](history/STATE-2026-11-05.md#L948) |
| BL-H-0771 | idempotentnost/retry | [STATE red 949](history/STATE-2026-11-05.md#L949) |
| BL-H-0772 | vremenske zone | [STATE red 950](history/STATE-2026-11-05.md#L950) |
| BL-H-0773 | legacy/infrastruktura | [STATE red 951](history/STATE-2026-11-05.md#L951) |
| BL-H-0774 | legacy/infrastruktura | [STATE red 952](history/STATE-2026-11-05.md#L952) |
| BL-H-0775 | ostalo / historijski kontekst | [STATE red 953](history/STATE-2026-11-05.md#L953) |
| BL-H-0776 | ostalo / historijski kontekst | [STATE red 954](history/STATE-2026-11-05.md#L954) |
| BL-H-0777 | ostalo / historijski kontekst | [STATE red 955](history/STATE-2026-11-05.md#L955) |
| BL-H-0778 | ostalo / historijski kontekst | [STATE red 956](history/STATE-2026-11-05.md#L956) |
| BL-H-0779 | legacy/infrastruktura | [STATE red 957](history/STATE-2026-11-05.md#L957) |
| BL-H-0780 | ostalo / historijski kontekst | [STATE red 958](history/STATE-2026-11-05.md#L958) |
| BL-H-0781 | legacy/infrastruktura | [STATE red 959](history/STATE-2026-11-05.md#L959) |
| BL-H-0782 | idempotentnost/retry | [STATE red 960](history/STATE-2026-11-05.md#L960) |
| BL-H-0783 | vremenske zone | [STATE red 961](history/STATE-2026-11-05.md#L961) |
| BL-H-0784 | legacy/infrastruktura | [STATE red 962](history/STATE-2026-11-05.md#L962) |
| BL-H-0785 | legacy/infrastruktura | [STATE red 963](history/STATE-2026-11-05.md#L963) |
| BL-H-0786 | legacy/infrastruktura | [STATE red 964](history/STATE-2026-11-05.md#L964) |
| BL-H-0787 | ostalo / historijski kontekst | [STATE red 965](history/STATE-2026-11-05.md#L965) |
| BL-H-0788 | konkurentnost/lockovi | [STATE red 966](history/STATE-2026-11-05.md#L966) |
| BL-H-0789 | legacy/infrastruktura | [STATE red 967](history/STATE-2026-11-05.md#L967) |
| BL-H-0790 | legacy/infrastruktura | [STATE red 968](history/STATE-2026-11-05.md#L968) |
| BL-H-0791 | ostalo / historijski kontekst | [STATE red 969](history/STATE-2026-11-05.md#L969) |
| BL-H-0792 | ostalo / historijski kontekst | [STATE red 970](history/STATE-2026-11-05.md#L970) |
| BL-H-0793 | legacy/infrastruktura | [STATE red 971](history/STATE-2026-11-05.md#L971) |
| BL-H-0794 | legacy/infrastruktura | [STATE red 974](history/STATE-2026-11-05.md#L974) |
| BL-H-0795 | legacy/infrastruktura | [STATE red 975](history/STATE-2026-11-05.md#L975) |
| BL-H-0796 | ostalo / historijski kontekst | [STATE red 976](history/STATE-2026-11-05.md#L976) |
| BL-H-0797 | sesija/auth | [STATE red 977](history/STATE-2026-11-05.md#L977) |
| BL-H-0798 | legacy/infrastruktura | [STATE red 978](history/STATE-2026-11-05.md#L978) |
| BL-H-0799 | ostalo / historijski kontekst | [STATE red 979](history/STATE-2026-11-05.md#L979) |
| BL-H-0800 | legacy/infrastruktura | [STATE red 980](history/STATE-2026-11-05.md#L980) |
| BL-H-0801 | ostalo / historijski kontekst | [STATE red 981](history/STATE-2026-11-05.md#L981) |
| BL-H-0802 | legacy/infrastruktura | [STATE red 982](history/STATE-2026-11-05.md#L982) |
| BL-H-0803 | legacy/infrastruktura | [STATE red 983](history/STATE-2026-11-05.md#L983) |
| BL-H-0804 | sesija/auth | [STATE red 984](history/STATE-2026-11-05.md#L984) |
| BL-H-0805 | ostalo / historijski kontekst | [STATE red 985](history/STATE-2026-11-05.md#L985) |
| BL-H-0806 | sesija/auth | [STATE red 986](history/STATE-2026-11-05.md#L986) |
| BL-H-0807 | sesija/auth | [STATE red 987](history/STATE-2026-11-05.md#L987) |
| BL-H-0808 | ostalo / historijski kontekst | [STATE red 988](history/STATE-2026-11-05.md#L988) |
| BL-H-0809 | legacy/infrastruktura | [STATE red 989](history/STATE-2026-11-05.md#L989) |
| BL-H-0810 | ostalo / historijski kontekst | [STATE red 992](history/STATE-2026-11-05.md#L992) |
| BL-H-0811 | sesija/auth | [STATE red 993](history/STATE-2026-11-05.md#L993) |
| BL-H-0812 | FE nacrti/oporavak | [STATE red 994](history/STATE-2026-11-05.md#L994) |
| BL-H-0813 | ostalo / historijski kontekst | [STATE red 995](history/STATE-2026-11-05.md#L995) |
| BL-H-0814 | ostalo / historijski kontekst | [STATE red 996](history/STATE-2026-11-05.md#L996) |
| BL-H-0815 | ostalo / historijski kontekst | [STATE red 997](history/STATE-2026-11-05.md#L997) |
| BL-H-0816 | ostalo / historijski kontekst | [STATE red 998](history/STATE-2026-11-05.md#L998) |
| BL-H-0817 | ostalo / historijski kontekst | [STATE red 999](history/STATE-2026-11-05.md#L999) |
| BL-H-0818 | ostalo / historijski kontekst | [STATE red 1000](history/STATE-2026-11-05.md#L1000) |
| BL-H-0819 | sesija/auth | [STATE red 1001](history/STATE-2026-11-05.md#L1001) |
| BL-H-0820 | legacy/infrastruktura | [STATE red 1002](history/STATE-2026-11-05.md#L1002) |
| BL-H-0821 | ostalo / historijski kontekst | [STATE red 1003](history/STATE-2026-11-05.md#L1003) |
| BL-H-0822 | ostalo / historijski kontekst | [STATE red 1005](history/STATE-2026-11-05.md#L1005) |
| BL-H-0823 | tenant/prava | [STATE red 1006](history/STATE-2026-11-05.md#L1006) |
| BL-H-0824 | ostalo / historijski kontekst | [STATE red 1007](history/STATE-2026-11-05.md#L1007) |
| BL-H-0825 | sesija/auth | [STATE red 1009](history/STATE-2026-11-05.md#L1009) |
| BL-H-0826 | legacy/infrastruktura | [STATE red 1010](history/STATE-2026-11-05.md#L1010) |
| BL-H-0827 | ostalo / historijski kontekst | [STATE red 1011](history/STATE-2026-11-05.md#L1011) |
| BL-H-0828 | sesija/auth | [STATE red 1012](history/STATE-2026-11-05.md#L1012) |
| BL-H-0829 | FE nacrti/oporavak | [STATE red 1014](history/STATE-2026-11-05.md#L1014) |
| BL-H-0830 | legacy/infrastruktura | [STATE red 1015](history/STATE-2026-11-05.md#L1015) |
| BL-H-0831 | ostalo / historijski kontekst | [STATE red 1016](history/STATE-2026-11-05.md#L1016) |
| BL-H-0832 | ostalo / historijski kontekst | [STATE red 1017](history/STATE-2026-11-05.md#L1017) |
| BL-H-0833 | ostalo / historijski kontekst | [STATE red 1019](history/STATE-2026-11-05.md#L1019) |
| BL-H-0834 | ostalo / historijski kontekst | [STATE red 1020](history/STATE-2026-11-05.md#L1020) |
| BL-H-0835 | ostalo / historijski kontekst | [STATE red 1021](history/STATE-2026-11-05.md#L1021) |
| BL-H-0836 | ostalo / historijski kontekst | [STATE red 1022](history/STATE-2026-11-05.md#L1022) |
| BL-H-0837 | ostalo / historijski kontekst | [STATE red 1024](history/STATE-2026-11-05.md#L1024) |
| BL-H-0838 | ostalo / historijski kontekst | [STATE red 1025](history/STATE-2026-11-05.md#L1025) |
| BL-H-0839 | novac/decimale | [STATE red 1026](history/STATE-2026-11-05.md#L1026) |
| BL-H-0840 | tenant/prava | [STATE red 1027](history/STATE-2026-11-05.md#L1027) |
| BL-H-0841 | ostalo / historijski kontekst | [STATE red 1028](history/STATE-2026-11-05.md#L1028) |
| BL-H-0842 | ostalo / historijski kontekst | [STATE red 1029](history/STATE-2026-11-05.md#L1029) |
| BL-H-0843 | ostalo / historijski kontekst | [STATE red 1030](history/STATE-2026-11-05.md#L1030) |
| BL-H-0844 | ostalo / historijski kontekst | [STATE red 1032](history/STATE-2026-11-05.md#L1032) |
| BL-H-0845 | ostalo / historijski kontekst | [STATE red 1033](history/STATE-2026-11-05.md#L1033) |
| BL-H-0846 | legacy/infrastruktura | [STATE red 1034](history/STATE-2026-11-05.md#L1034) |
| BL-H-0847 | ostalo / historijski kontekst | [STATE red 1035](history/STATE-2026-11-05.md#L1035) |
| BL-H-0848 | idempotentnost/retry | [STATE red 1036](history/STATE-2026-11-05.md#L1036) |
| BL-H-0849 | idempotentnost/retry | [STATE red 1037](history/STATE-2026-11-05.md#L1037) |
| BL-H-0850 | ostalo / historijski kontekst | [STATE red 1038](history/STATE-2026-11-05.md#L1038) |
| BL-H-0851 | idempotentnost/retry | [STATE red 1039](history/STATE-2026-11-05.md#L1039) |
| BL-H-0852 | ostalo / historijski kontekst | [STATE red 1040](history/STATE-2026-11-05.md#L1040) |
| BL-H-0853 | ostalo / historijski kontekst | [STATE red 1041](history/STATE-2026-11-05.md#L1041) |
| BL-H-0854 | ostalo / historijski kontekst | [STATE red 1042](history/STATE-2026-11-05.md#L1042) |
| BL-H-0855 | legacy/infrastruktura | [STATE red 1043](history/STATE-2026-11-05.md#L1043) |
| BL-H-0856 | ostalo / historijski kontekst | [STATE red 1045](history/STATE-2026-11-05.md#L1045) |
| BL-H-0857 | ostalo / historijski kontekst | [STATE red 1046](history/STATE-2026-11-05.md#L1046) |
| BL-H-0858 | ostalo / historijski kontekst | [STATE red 1047](history/STATE-2026-11-05.md#L1047) |
| BL-H-0859 | sesija/auth | [STATE red 1048](history/STATE-2026-11-05.md#L1048) |
| BL-H-0860 | legacy/infrastruktura | [STATE red 1049](history/STATE-2026-11-05.md#L1049) |
| BL-H-0861 | post-commit efekti | [STATE red 1050](history/STATE-2026-11-05.md#L1050) |
| BL-H-0862 | post-commit efekti | [STATE red 1051](history/STATE-2026-11-05.md#L1051) |
| BL-H-0863 | legacy/infrastruktura | [STATE red 1052](history/STATE-2026-11-05.md#L1052) |
| BL-H-0864 | idempotentnost/retry | [STATE red 1053](history/STATE-2026-11-05.md#L1053) |
| BL-H-0865 | ostalo / historijski kontekst | [STATE red 1054](history/STATE-2026-11-05.md#L1054) |
| BL-H-0866 | ostalo / historijski kontekst | [STATE red 1055](history/STATE-2026-11-05.md#L1055) |
| BL-H-0867 | ostalo / historijski kontekst | [STATE red 1056](history/STATE-2026-11-05.md#L1056) |
| BL-H-0868 | ostalo / historijski kontekst | [STATE red 1057](history/STATE-2026-11-05.md#L1057) |
| BL-H-0869 | sesija/auth | [STATE red 1058](history/STATE-2026-11-05.md#L1058) |
| BL-H-0870 | sesija/auth | [STATE red 1059](history/STATE-2026-11-05.md#L1059) |
| BL-H-0871 | ostalo / historijski kontekst | [STATE red 1060](history/STATE-2026-11-05.md#L1060) |
| BL-H-0872 | sesija/auth | [STATE red 1061](history/STATE-2026-11-05.md#L1061) |
| BL-H-0873 | ostalo / historijski kontekst | [STATE red 1062](history/STATE-2026-11-05.md#L1062) |
| BL-H-0874 | ostalo / historijski kontekst | [STATE red 1063](history/STATE-2026-11-05.md#L1063) |
| BL-H-0875 | sesija/auth | [STATE red 1064](history/STATE-2026-11-05.md#L1064) |
| BL-H-0876 | sesija/auth | [STATE red 1065](history/STATE-2026-11-05.md#L1065) |
| BL-H-0877 | sesija/auth | [STATE red 1066](history/STATE-2026-11-05.md#L1066) |
| BL-H-0878 | sesija/auth | [STATE red 1067](history/STATE-2026-11-05.md#L1067) |
| BL-H-0879 | sesija/auth | [STATE red 1068](history/STATE-2026-11-05.md#L1068) |
| BL-H-0880 | novac/decimale | [STATE red 1069](history/STATE-2026-11-05.md#L1069) |
| BL-H-0881 | ostalo / historijski kontekst | [STATE red 1070](history/STATE-2026-11-05.md#L1070) |
| BL-H-0882 | ostalo / historijski kontekst | [STATE red 1071](history/STATE-2026-11-05.md#L1071) |
| BL-H-0883 | ostalo / historijski kontekst | [STATE red 1072](history/STATE-2026-11-05.md#L1072) |
| BL-H-0884 | ostalo / historijski kontekst | [STATE red 1074](history/STATE-2026-11-05.md#L1074) |
| BL-H-0885 | ostalo / historijski kontekst | [STATE red 1075](history/STATE-2026-11-05.md#L1075) |
| BL-H-0886 | legacy/infrastruktura | [STATE red 1076](history/STATE-2026-11-05.md#L1076) |
| BL-H-0887 | idempotentnost/retry | [STATE red 1077](history/STATE-2026-11-05.md#L1077) |
| BL-H-0888 | ostalo / historijski kontekst | [STATE red 1078](history/STATE-2026-11-05.md#L1078) |
| BL-H-0889 | ostalo / historijski kontekst | [STATE red 1079](history/STATE-2026-11-05.md#L1079) |
| BL-H-0890 | ostalo / historijski kontekst | [STATE red 1080](history/STATE-2026-11-05.md#L1080) |
| BL-H-0891 | ostalo / historijski kontekst | [STATE red 1081](history/STATE-2026-11-05.md#L1081) |
| BL-H-0892 | ostalo / historijski kontekst | [STATE red 1082](history/STATE-2026-11-05.md#L1082) |
| BL-H-0893 | ostalo / historijski kontekst | [STATE red 1083](history/STATE-2026-11-05.md#L1083) |
| BL-H-0894 | sesija/auth | [STATE red 1084](history/STATE-2026-11-05.md#L1084) |
| BL-H-0895 | ostalo / historijski kontekst | [STATE red 1085](history/STATE-2026-11-05.md#L1085) |
| BL-H-0896 | sesija/auth | [STATE red 1086](history/STATE-2026-11-05.md#L1086) |
| BL-H-0897 | ostalo / historijski kontekst | [STATE red 1087](history/STATE-2026-11-05.md#L1087) |
| BL-H-0898 | legacy/infrastruktura | [STATE red 1089](history/STATE-2026-11-05.md#L1089) |
| BL-H-0899 | ostalo / historijski kontekst | [STATE red 1090](history/STATE-2026-11-05.md#L1090) |
| BL-H-0900 | idempotentnost/retry | [STATE red 1091](history/STATE-2026-11-05.md#L1091) |
| BL-H-0901 | legacy/infrastruktura | [STATE red 1092](history/STATE-2026-11-05.md#L1092) |
| BL-H-0902 | legacy/infrastruktura | [STATE red 1093](history/STATE-2026-11-05.md#L1093) |
| BL-H-0903 | sesija/auth | [STATE red 1094](history/STATE-2026-11-05.md#L1094) |
| BL-H-0904 | legacy/infrastruktura | [STATE red 1095](history/STATE-2026-11-05.md#L1095) |
| BL-H-0905 | tenant/prava | [STATE red 1096](history/STATE-2026-11-05.md#L1096) |
| BL-H-0906 | idempotentnost/retry | [STATE red 1097](history/STATE-2026-11-05.md#L1097) |
| BL-H-0907 | tenant/prava | [STATE red 1098](history/STATE-2026-11-05.md#L1098) |
| BL-H-0908 | ostalo / historijski kontekst | [STATE red 1099](history/STATE-2026-11-05.md#L1099) |
| BL-H-0909 | ostalo / historijski kontekst | [STATE red 1100](history/STATE-2026-11-05.md#L1100) |
| BL-H-0910 | sesija/auth | [STATE red 1101](history/STATE-2026-11-05.md#L1101) |
| BL-H-0911 | ostalo / historijski kontekst | [STATE red 1102](history/STATE-2026-11-05.md#L1102) |
| BL-H-0912 | ostalo / historijski kontekst | [STATE red 1103](history/STATE-2026-11-05.md#L1103) |
| BL-H-0913 | legacy/infrastruktura | [STATE red 1104](history/STATE-2026-11-05.md#L1104) |
| BL-H-0914 | ostalo / historijski kontekst | [STATE red 1105](history/STATE-2026-11-05.md#L1105) |
| BL-H-0915 | legacy/infrastruktura | [STATE red 1106](history/STATE-2026-11-05.md#L1106) |
| BL-H-0916 | legacy/infrastruktura | [STATE red 1107](history/STATE-2026-11-05.md#L1107) |
| BL-H-0917 | ostalo / historijski kontekst | [STATE red 1108](history/STATE-2026-11-05.md#L1108) |
| BL-H-0918 | ostalo / historijski kontekst | [STATE red 1109](history/STATE-2026-11-05.md#L1109) |
| BL-H-0919 | ostalo / historijski kontekst | [STATE red 1111](history/STATE-2026-11-05.md#L1111) |
| BL-H-0920 | ostalo / historijski kontekst | [STATE red 1112](history/STATE-2026-11-05.md#L1112) |
| BL-H-0921 | ostalo / historijski kontekst | [STATE red 1113](history/STATE-2026-11-05.md#L1113) |
| BL-H-0922 | ostalo / historijski kontekst | [STATE red 1114](history/STATE-2026-11-05.md#L1114) |
| BL-H-0923 | ostalo / historijski kontekst | [STATE red 1115](history/STATE-2026-11-05.md#L1115) |
| BL-H-0924 | ostalo / historijski kontekst | [STATE red 1116](history/STATE-2026-11-05.md#L1116) |
| BL-H-0925 | ostalo / historijski kontekst | [STATE red 1117](history/STATE-2026-11-05.md#L1117) |
| BL-H-0926 | ostalo / historijski kontekst | [STATE red 1118](history/STATE-2026-11-05.md#L1118) |
| BL-H-0927 | ostalo / historijski kontekst | [STATE red 1119](history/STATE-2026-11-05.md#L1119) |
| BL-H-0928 | ostalo / historijski kontekst | [STATE red 1120](history/STATE-2026-11-05.md#L1120) |
| BL-H-0929 | idempotentnost/retry | [STATE red 1121](history/STATE-2026-11-05.md#L1121) |
| BL-H-0930 | legacy/infrastruktura | [STATE red 1122](history/STATE-2026-11-05.md#L1122) |
| BL-H-0931 | ostalo / historijski kontekst | [STATE red 1123](history/STATE-2026-11-05.md#L1123) |
| BL-H-0932 | ostalo / historijski kontekst | [STATE red 1124](history/STATE-2026-11-05.md#L1124) |
| BL-H-0933 | ostalo / historijski kontekst | [STATE red 1125](history/STATE-2026-11-05.md#L1125) |
| BL-H-0934 | legacy/infrastruktura | [STATE red 1126](history/STATE-2026-11-05.md#L1126) |
| BL-H-0935 | ostalo / historijski kontekst | [STATE red 1127](history/STATE-2026-11-05.md#L1127) |
| BL-H-0936 | ostalo / historijski kontekst | [STATE red 1129](history/STATE-2026-11-05.md#L1129) |
| BL-H-0937 | ostalo / historijski kontekst | [STATE red 1130](history/STATE-2026-11-05.md#L1130) |
| BL-H-0938 | idempotentnost/retry | [STATE red 1131](history/STATE-2026-11-05.md#L1131) |
| BL-H-0939 | ostalo / historijski kontekst | [STATE red 1132](history/STATE-2026-11-05.md#L1132) |
| BL-H-0940 | ostalo / historijski kontekst | [STATE red 1133](history/STATE-2026-11-05.md#L1133) |
| BL-H-0941 | ostalo / historijski kontekst | [STATE red 1134](history/STATE-2026-11-05.md#L1134) |
| BL-H-0942 | ostalo / historijski kontekst | [STATE red 1135](history/STATE-2026-11-05.md#L1135) |
| BL-H-0943 | legacy/infrastruktura | [STATE red 1136](history/STATE-2026-11-05.md#L1136) |
| BL-H-0944 | legacy/infrastruktura | [STATE red 1137](history/STATE-2026-11-05.md#L1137) |
| BL-H-0945 | ostalo / historijski kontekst | [STATE red 1138](history/STATE-2026-11-05.md#L1138) |
| BL-H-0946 | ostalo / historijski kontekst | [STATE red 1140](history/STATE-2026-11-05.md#L1140) |
| BL-H-0947 | ostalo / historijski kontekst | [STATE red 1141](history/STATE-2026-11-05.md#L1141) |
| BL-H-0948 | ostalo / historijski kontekst | [STATE red 1142](history/STATE-2026-11-05.md#L1142) |
| BL-H-0949 | ostalo / historijski kontekst | [STATE red 1143](history/STATE-2026-11-05.md#L1143) |
| BL-H-0950 | ostalo / historijski kontekst | [STATE red 1144](history/STATE-2026-11-05.md#L1144) |
| BL-H-0951 | idempotentnost/retry | [STATE red 1145](history/STATE-2026-11-05.md#L1145) |
| BL-H-0952 | ostalo / historijski kontekst | [STATE red 1146](history/STATE-2026-11-05.md#L1146) |
| BL-H-0953 | ostalo / historijski kontekst | [STATE red 1147](history/STATE-2026-11-05.md#L1147) |
| BL-H-0954 | ostalo / historijski kontekst | [STATE red 1148](history/STATE-2026-11-05.md#L1148) |
| BL-H-0955 | ostalo / historijski kontekst | [STATE red 1149](history/STATE-2026-11-05.md#L1149) |
| BL-H-0956 | ostalo / historijski kontekst | [STATE red 1150](history/STATE-2026-11-05.md#L1150) |
| BL-H-0957 | legacy/infrastruktura | [STATE red 1151](history/STATE-2026-11-05.md#L1151) |
| BL-H-0958 | ostalo / historijski kontekst | [STATE red 1153](history/STATE-2026-11-05.md#L1153) |
| BL-H-0959 | ostalo / historijski kontekst | [STATE red 1154](history/STATE-2026-11-05.md#L1154) |
| BL-H-0960 | novac/decimale | [STATE red 1155](history/STATE-2026-11-05.md#L1155) |
| BL-H-0961 | ostalo / historijski kontekst | [STATE red 1156](history/STATE-2026-11-05.md#L1156) |
| BL-H-0962 | ostalo / historijski kontekst | [STATE red 1157](history/STATE-2026-11-05.md#L1157) |
| BL-H-0963 | ostalo / historijski kontekst | [STATE red 1158](history/STATE-2026-11-05.md#L1158) |
| BL-H-0964 | ostalo / historijski kontekst | [STATE red 1159](history/STATE-2026-11-05.md#L1159) |
| BL-H-0965 | ostalo / historijski kontekst | [STATE red 1160](history/STATE-2026-11-05.md#L1160) |
| BL-H-0966 | ostalo / historijski kontekst | [STATE red 1161](history/STATE-2026-11-05.md#L1161) |
| BL-H-0967 | ostalo / historijski kontekst | [STATE red 1162](history/STATE-2026-11-05.md#L1162) |
| BL-H-0968 | ostalo / historijski kontekst | [STATE red 1163](history/STATE-2026-11-05.md#L1163) |
| BL-H-0969 | legacy/infrastruktura | [STATE red 1165](history/STATE-2026-11-05.md#L1165) |
| BL-H-0970 | ostalo / historijski kontekst | [STATE red 1166](history/STATE-2026-11-05.md#L1166) |
| BL-H-0971 | ostalo / historijski kontekst | [STATE red 1167](history/STATE-2026-11-05.md#L1167) |
| BL-H-0972 | legacy/infrastruktura | [STATE red 1168](history/STATE-2026-11-05.md#L1168) |
| BL-H-0973 | ostalo / historijski kontekst | [STATE red 1169](history/STATE-2026-11-05.md#L1169) |
| BL-H-0974 | ostalo / historijski kontekst | [STATE red 1170](history/STATE-2026-11-05.md#L1170) |
| BL-H-0975 | ostalo / historijski kontekst | [STATE red 1171](history/STATE-2026-11-05.md#L1171) |
| BL-H-0976 | legacy/infrastruktura | [STATE red 1172](history/STATE-2026-11-05.md#L1172) |
| BL-H-0977 | legacy/infrastruktura | [STATE red 1173](history/STATE-2026-11-05.md#L1173) |
| BL-H-0978 | ostalo / historijski kontekst | [STATE red 1174](history/STATE-2026-11-05.md#L1174) |
| BL-H-0979 | ostalo / historijski kontekst | [STATE red 1175](history/STATE-2026-11-05.md#L1175) |
| BL-H-0980 | ostalo / historijski kontekst | [STATE red 1176](history/STATE-2026-11-05.md#L1176) |
| BL-H-0981 | ostalo / historijski kontekst | [STATE red 1177](history/STATE-2026-11-05.md#L1177) |
| BL-H-0982 | legacy/infrastruktura | [STATE red 1178](history/STATE-2026-11-05.md#L1178) |
| BL-H-0983 | ostalo / historijski kontekst | [STATE red 1179](history/STATE-2026-11-05.md#L1179) |
| BL-H-0984 | legacy/infrastruktura | [STATE red 1181](history/STATE-2026-11-05.md#L1181) |
| BL-H-0985 | legacy/infrastruktura | [STATE red 1182](history/STATE-2026-11-05.md#L1182) |
| BL-H-0986 | ostalo / historijski kontekst | [STATE red 1183](history/STATE-2026-11-05.md#L1183) |
| BL-H-0987 | idempotentnost/retry | [STATE red 1184](history/STATE-2026-11-05.md#L1184) |
| BL-H-0988 | ostalo / historijski kontekst | [STATE red 1185](history/STATE-2026-11-05.md#L1185) |
| BL-H-0989 | sesija/auth | [STATE red 1186](history/STATE-2026-11-05.md#L1186) |
| BL-H-0990 | sesija/auth | [STATE red 1187](history/STATE-2026-11-05.md#L1187) |
| BL-H-0991 | ostalo / historijski kontekst | [STATE red 1188](history/STATE-2026-11-05.md#L1188) |
| BL-H-0992 | ostalo / historijski kontekst | [STATE red 1189](history/STATE-2026-11-05.md#L1189) |
| BL-H-0993 | ostalo / historijski kontekst | [STATE red 1190](history/STATE-2026-11-05.md#L1190) |
| BL-H-0994 | ostalo / historijski kontekst | [STATE red 1192](history/STATE-2026-11-05.md#L1192) |
| BL-H-0995 | legacy/infrastruktura | [STATE red 1193](history/STATE-2026-11-05.md#L1193) |
| BL-H-0996 | ostalo / historijski kontekst | [STATE red 1194](history/STATE-2026-11-05.md#L1194) |
| BL-H-0997 | ostalo / historijski kontekst | [STATE red 1195](history/STATE-2026-11-05.md#L1195) |
| BL-H-0998 | legacy/infrastruktura | [STATE red 1196](history/STATE-2026-11-05.md#L1196) |
| BL-H-0999 | legacy/infrastruktura | [STATE red 1197](history/STATE-2026-11-05.md#L1197) |
| BL-H-1000 | legacy/infrastruktura | [STATE red 1198](history/STATE-2026-11-05.md#L1198) |
| BL-H-1001 | ostalo / historijski kontekst | [STATE red 1199](history/STATE-2026-11-05.md#L1199) |
| BL-H-1002 | ostalo / historijski kontekst | [STATE red 1200](history/STATE-2026-11-05.md#L1200) |
| BL-H-1003 | ostalo / historijski kontekst | [STATE red 1201](history/STATE-2026-11-05.md#L1201) |
| BL-H-1004 | ostalo / historijski kontekst | [STATE red 1202](history/STATE-2026-11-05.md#L1202) |
| BL-H-1005 | ostalo / historijski kontekst | [STATE red 1203](history/STATE-2026-11-05.md#L1203) |
| BL-H-1006 | sesija/auth | [STATE red 1204](history/STATE-2026-11-05.md#L1204) |
| BL-H-1007 | ostalo / historijski kontekst | [STATE red 1205](history/STATE-2026-11-05.md#L1205) |
| BL-H-1008 | tenant/prava | [STATE red 1206](history/STATE-2026-11-05.md#L1206) |
| BL-H-1009 | ostalo / historijski kontekst | [STATE red 1207](history/STATE-2026-11-05.md#L1207) |
| BL-H-1010 | FE nacrti/oporavak | [STATE red 1208](history/STATE-2026-11-05.md#L1208) |
| BL-H-1011 | FE nacrti/oporavak | [STATE red 1209](history/STATE-2026-11-05.md#L1209) |
| BL-H-1012 | legacy/infrastruktura | [STATE red 1210](history/STATE-2026-11-05.md#L1210) |
| BL-H-1013 | ostalo / historijski kontekst | [STATE red 1211](history/STATE-2026-11-05.md#L1211) |
| BL-H-1014 | ostalo / historijski kontekst | [STATE red 1212](history/STATE-2026-11-05.md#L1212) |
| BL-H-1015 | legacy/infrastruktura | [STATE red 1213](history/STATE-2026-11-05.md#L1213) |
| BL-H-1016 | ostalo / historijski kontekst | [STATE red 1214](history/STATE-2026-11-05.md#L1214) |
| BL-H-1017 | ostalo / historijski kontekst | [STATE red 1216](history/STATE-2026-11-05.md#L1216) |
| BL-H-1018 | ostalo / historijski kontekst | [STATE red 1217](history/STATE-2026-11-05.md#L1217) |
| BL-H-1019 | sesija/auth | [STATE red 1218](history/STATE-2026-11-05.md#L1218) |
| BL-H-1020 | sesija/auth | [STATE red 1219](history/STATE-2026-11-05.md#L1219) |
| BL-H-1021 | sesija/auth | [STATE red 1220](history/STATE-2026-11-05.md#L1220) |
| BL-H-1022 | ostalo / historijski kontekst | [STATE red 1221](history/STATE-2026-11-05.md#L1221) |
| BL-H-1023 | legacy/infrastruktura | [STATE red 1222](history/STATE-2026-11-05.md#L1222) |
| BL-H-1024 | sesija/auth | [STATE red 1223](history/STATE-2026-11-05.md#L1223) |
| BL-H-1025 | sesija/auth | [STATE red 1224](history/STATE-2026-11-05.md#L1224) |
| BL-H-1026 | sesija/auth | [STATE red 1225](history/STATE-2026-11-05.md#L1225) |
| BL-H-1027 | legacy/infrastruktura | [STATE red 1226](history/STATE-2026-11-05.md#L1226) |
| BL-H-1028 | ostalo / historijski kontekst | [STATE red 1227](history/STATE-2026-11-05.md#L1227) |
| BL-H-1029 | ostalo / historijski kontekst | [STATE red 1228](history/STATE-2026-11-05.md#L1228) |
| BL-H-1030 | ostalo / historijski kontekst | [STATE red 1229](history/STATE-2026-11-05.md#L1229) |
| BL-H-1031 | idempotentnost/retry | [STATE red 1230](history/STATE-2026-11-05.md#L1230) |
| BL-H-1032 | ostalo / historijski kontekst | [STATE red 1231](history/STATE-2026-11-05.md#L1231) |
| BL-H-1033 | sesija/auth | [STATE red 1232](history/STATE-2026-11-05.md#L1232) |
| BL-H-1034 | idempotentnost/retry | [STATE red 1233](history/STATE-2026-11-05.md#L1233) |
| BL-H-1035 | ostalo / historijski kontekst | [STATE red 1234](history/STATE-2026-11-05.md#L1234) |
| BL-H-1036 | sesija/auth | [STATE red 1235](history/STATE-2026-11-05.md#L1235) |
| BL-H-1037 | sesija/auth | [STATE red 1236](history/STATE-2026-11-05.md#L1236) |
| BL-H-1038 | legacy/infrastruktura | [STATE red 1237](history/STATE-2026-11-05.md#L1237) |
| BL-H-1039 | ostalo / historijski kontekst | [STATE red 1238](history/STATE-2026-11-05.md#L1238) |
| BL-H-1040 | legacy/infrastruktura | [STATE red 1239](history/STATE-2026-11-05.md#L1239) |
| BL-H-1041 | ostalo / historijski kontekst | [STATE red 1240](history/STATE-2026-11-05.md#L1240) |
| BL-H-1042 | ostalo / historijski kontekst | [STATE red 1241](history/STATE-2026-11-05.md#L1241) |
| BL-H-1043 | ostalo / historijski kontekst | [STATE red 1242](history/STATE-2026-11-05.md#L1242) |
| BL-H-1044 | ostalo / historijski kontekst | [STATE red 1244](history/STATE-2026-11-05.md#L1244) |
| BL-H-1045 | ostalo / historijski kontekst | [STATE red 1245](history/STATE-2026-11-05.md#L1245) |
| BL-H-1046 | ostalo / historijski kontekst | [STATE red 1246](history/STATE-2026-11-05.md#L1246) |
| BL-H-1047 | ostalo / historijski kontekst | [STATE red 1247](history/STATE-2026-11-05.md#L1247) |
| BL-H-1048 | ostalo / historijski kontekst | [STATE red 1248](history/STATE-2026-11-05.md#L1248) |
| BL-H-1049 | ostalo / historijski kontekst | [STATE red 1249](history/STATE-2026-11-05.md#L1249) |
| BL-H-1050 | ostalo / historijski kontekst | [STATE red 1250](history/STATE-2026-11-05.md#L1250) |
| BL-H-1051 | ostalo / historijski kontekst | [STATE red 1251](history/STATE-2026-11-05.md#L1251) |
| BL-H-1052 | ostalo / historijski kontekst | [STATE red 1252](history/STATE-2026-11-05.md#L1252) |
| BL-H-1053 | ostalo / historijski kontekst | [STATE red 1253](history/STATE-2026-11-05.md#L1253) |
| BL-H-1054 | ostalo / historijski kontekst | [STATE red 1254](history/STATE-2026-11-05.md#L1254) |
| BL-H-1055 | ostalo / historijski kontekst | [STATE red 1255](history/STATE-2026-11-05.md#L1255) |
| BL-H-1056 | ostalo / historijski kontekst | [STATE red 1256](history/STATE-2026-11-05.md#L1256) |
| BL-H-1057 | ostalo / historijski kontekst | [STATE red 1257](history/STATE-2026-11-05.md#L1257) |
| BL-H-1058 | ostalo / historijski kontekst | [STATE red 1258](history/STATE-2026-11-05.md#L1258) |
| BL-H-1059 | ostalo / historijski kontekst | [STATE red 1259](history/STATE-2026-11-05.md#L1259) |
| BL-H-1060 | legacy/infrastruktura | [STATE red 1260](history/STATE-2026-11-05.md#L1260) |
| BL-H-1061 | ostalo / historijski kontekst | [STATE red 1261](history/STATE-2026-11-05.md#L1261) |
| BL-H-1062 | ostalo / historijski kontekst | [STATE red 1262](history/STATE-2026-11-05.md#L1262) |
| BL-H-1063 | legacy/infrastruktura | [STATE red 1264](history/STATE-2026-11-05.md#L1264) |
| BL-H-1064 | ostalo / historijski kontekst | [STATE red 1265](history/STATE-2026-11-05.md#L1265) |
| BL-H-1065 | ostalo / historijski kontekst | [STATE red 1266](history/STATE-2026-11-05.md#L1266) |
| BL-H-1066 | ostalo / historijski kontekst | [STATE red 1267](history/STATE-2026-11-05.md#L1267) |
| BL-H-1067 | post-commit efekti | [STATE red 1268](history/STATE-2026-11-05.md#L1268) |
| BL-H-1068 | ostalo / historijski kontekst | [STATE red 1269](history/STATE-2026-11-05.md#L1269) |
| BL-H-1069 | ostalo / historijski kontekst | [STATE red 1270](history/STATE-2026-11-05.md#L1270) |
| BL-H-1070 | ostalo / historijski kontekst | [STATE red 1271](history/STATE-2026-11-05.md#L1271) |
| BL-H-1071 | legacy/infrastruktura | [STATE red 1272](history/STATE-2026-11-05.md#L1272) |
| BL-H-1072 | post-commit efekti | [STATE red 1273](history/STATE-2026-11-05.md#L1273) |
| BL-H-1073 | legacy/infrastruktura | [STATE red 1274](history/STATE-2026-11-05.md#L1274) |
| BL-H-1074 | ostalo / historijski kontekst | [STATE red 1275](history/STATE-2026-11-05.md#L1275) |
| BL-H-1075 | legacy/infrastruktura | [STATE red 1276](history/STATE-2026-11-05.md#L1276) |
| BL-H-1076 | ostalo / historijski kontekst | [STATE red 1277](history/STATE-2026-11-05.md#L1277) |
| BL-H-1077 | post-commit efekti | [STATE red 1279](history/STATE-2026-11-05.md#L1279) |
| BL-H-1078 | ostalo / historijski kontekst | [STATE red 1280](history/STATE-2026-11-05.md#L1280) |
| BL-H-1079 | post-commit efekti | [STATE red 1281](history/STATE-2026-11-05.md#L1281) |
| BL-H-1080 | idempotentnost/retry | [STATE red 1282](history/STATE-2026-11-05.md#L1282) |
| BL-H-1081 | legacy/infrastruktura | [STATE red 1283](history/STATE-2026-11-05.md#L1283) |
| BL-H-1082 | legacy/infrastruktura | [STATE red 1285](history/STATE-2026-11-05.md#L1285) |
| BL-H-1083 | legacy/infrastruktura | [STATE red 1286](history/STATE-2026-11-05.md#L1286) |
| BL-H-1084 | idempotentnost/retry | [STATE red 1287](history/STATE-2026-11-05.md#L1287) |
| BL-H-1085 | idempotentnost/retry | [STATE red 1288](history/STATE-2026-11-05.md#L1288) |
| BL-H-1086 | legacy/infrastruktura | [STATE red 1289](history/STATE-2026-11-05.md#L1289) |
| BL-H-1087 | tenant/prava | [STATE red 1291](history/STATE-2026-11-05.md#L1291) |
| BL-H-1088 | legacy/infrastruktura | [STATE red 1292](history/STATE-2026-11-05.md#L1292) |
| BL-H-1089 | tenant/prava | [STATE red 1293](history/STATE-2026-11-05.md#L1293) |
| BL-H-1090 | idempotentnost/retry | [STATE red 1294](history/STATE-2026-11-05.md#L1294) |
| BL-H-1091 | FE nacrti/oporavak | [STATE red 1296](history/STATE-2026-11-05.md#L1296) |
| BL-H-1092 | legacy/infrastruktura | [STATE red 1297](history/STATE-2026-11-05.md#L1297) |
| BL-H-1093 | idempotentnost/retry | [STATE red 1298](history/STATE-2026-11-05.md#L1298) |
| BL-H-1094 | ostalo / historijski kontekst | [STATE red 1299](history/STATE-2026-11-05.md#L1299) |
| BL-H-1095 | legacy/infrastruktura | [STATE red 1301](history/STATE-2026-11-05.md#L1301) |
| BL-H-1096 | legacy/infrastruktura | [STATE red 1302](history/STATE-2026-11-05.md#L1302) |
| BL-H-1097 | legacy/infrastruktura | [STATE red 1303](history/STATE-2026-11-05.md#L1303) |
| BL-H-1098 | legacy/infrastruktura | [STATE red 1305](history/STATE-2026-11-05.md#L1305) |
| BL-H-1099 | ostalo / historijski kontekst | [STATE red 1306](history/STATE-2026-11-05.md#L1306) |
| BL-H-1100 | idempotentnost/retry | [STATE red 1307](history/STATE-2026-11-05.md#L1307) |
| BL-H-1101 | legacy/infrastruktura | [STATE red 1308](history/STATE-2026-11-05.md#L1308) |
| BL-H-1102 | post-commit efekti | [STATE red 1310](history/STATE-2026-11-05.md#L1310) |
| BL-H-1103 | legacy/infrastruktura | [STATE red 1311](history/STATE-2026-11-05.md#L1311) |
| BL-H-1104 | idempotentnost/retry | [STATE red 1312](history/STATE-2026-11-05.md#L1312) |
| BL-H-1105 | legacy/infrastruktura | [STATE red 1313](history/STATE-2026-11-05.md#L1313) |
| BL-H-1106 | legacy/infrastruktura | [STATE red 1315](history/STATE-2026-11-05.md#L1315) |
| BL-H-1107 | post-commit efekti | [STATE red 1316](history/STATE-2026-11-05.md#L1316) |
| BL-H-1108 | legacy/infrastruktura | [STATE red 1317](history/STATE-2026-11-05.md#L1317) |
| BL-H-1109 | idempotentnost/retry | [STATE red 1318](history/STATE-2026-11-05.md#L1318) |
| BL-H-1110 | legacy/infrastruktura | [STATE red 1320](history/STATE-2026-11-05.md#L1320) |
| BL-H-1111 | idempotentnost/retry | [STATE red 1321](history/STATE-2026-11-05.md#L1321) |
| BL-H-1112 | legacy/infrastruktura | [STATE red 1322](history/STATE-2026-11-05.md#L1322) |
| BL-H-1113 | legacy/infrastruktura | [STATE red 1324](history/STATE-2026-11-05.md#L1324) |
| BL-H-1114 | vremenske zone | [STATE red 1325](history/STATE-2026-11-05.md#L1325) |
| BL-H-1115 | idempotentnost/retry | [STATE red 1326](history/STATE-2026-11-05.md#L1326) |
| BL-H-1116 | legacy/infrastruktura | [STATE red 1327](history/STATE-2026-11-05.md#L1327) |
| BL-H-1117 | legacy/infrastruktura | [STATE red 1329](history/STATE-2026-11-05.md#L1329) |
| BL-H-1118 | legacy/infrastruktura | [STATE red 1330](history/STATE-2026-11-05.md#L1330) |
| BL-H-1119 | legacy/infrastruktura | [STATE red 1331](history/STATE-2026-11-05.md#L1331) |
| BL-H-1120 | ostalo / historijski kontekst | [STATE red 1332](history/STATE-2026-11-05.md#L1332) |
| BL-H-1121 | ostalo / historijski kontekst | [STATE red 1334](history/STATE-2026-11-05.md#L1334) |
| BL-H-1122 | post-commit efekti | [STATE red 1336](history/STATE-2026-11-05.md#L1336) |
| BL-H-1123 | ostalo / historijski kontekst | [STATE red 1337](history/STATE-2026-11-05.md#L1337) |
| BL-H-1124 | sesija/auth | [STATE red 1338](history/STATE-2026-11-05.md#L1338) |
| BL-H-1125 | legacy/infrastruktura | [STATE red 1339](history/STATE-2026-11-05.md#L1339) |
| BL-H-1126 | sesija/auth | [STATE red 1340](history/STATE-2026-11-05.md#L1340) |
| BL-H-1127 | ostalo / historijski kontekst | [STATE red 1341](history/STATE-2026-11-05.md#L1341) |
| BL-H-1128 | ostalo / historijski kontekst | [STATE red 1343](history/STATE-2026-11-05.md#L1343) |
| BL-H-1129 | idempotentnost/retry | [STATE red 1345](history/STATE-2026-11-05.md#L1345) |
| BL-H-1130 | post-commit efekti | [STATE red 1346](history/STATE-2026-11-05.md#L1346) |
| BL-H-1131 | ostalo / historijski kontekst | [STATE red 1348](history/STATE-2026-11-05.md#L1348) |
| BL-H-1132 | post-commit efekti | [STATE red 1349](history/STATE-2026-11-05.md#L1349) |
| BL-H-1133 | ostalo / historijski kontekst | [STATE red 1350](history/STATE-2026-11-05.md#L1350) |
| BL-H-1134 | legacy/infrastruktura | [STATE red 1351](history/STATE-2026-11-05.md#L1351) |
| BL-H-1135 | ostalo / historijski kontekst | [STATE red 1352](history/STATE-2026-11-05.md#L1352) |
| BL-H-1136 | ostalo / historijski kontekst | [STATE red 1353](history/STATE-2026-11-05.md#L1353) |

- **BE-19, riješeno za projects pagination:** `/dashboard/projects` sada ima cursor/limit i dodatni `meta` bez promjene niza `data`; dokaz u `ops-web.e2e-spec.ts`.

- **BE-19 test fixture:** ponavljanje `ops-web.e2e-spec.ts` na istoj bazi nakuplja projekte i poslije više ponavljanja može izgurati fixture iz prve stranice; koristiti svježu testnu bazu ili kasnije izolovati/počistiti fixture.
