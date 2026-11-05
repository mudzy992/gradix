# Backlog — trijaža u toku

Ovo je početna konsolidacija, **nije završena inventura svih ograničenja**. Izvorni dnevnik
sačuvan je bez izmjena u [historiji](history/STATE-2026-11-05.md); nalazi i originalne odluke
su u [CI-05 ledgeru](CI-05-LEDGER.md) i [izvještaju](segments/CI-05.md). Starije bilješke
mogu opisivati stanje prije kasnijih popravki. Razdvojiti ta ograničenja od aktuelnih rizika,
dati svakom stvarnom preostalom scenariju ID, težinu, dokaz i prijedlog prije zatvaranja.

## Novac i decimalne vrijednosti

- **BL-001 — visoko, otvoreno, F-CI-05-64:** zajednički `parseDecimal` provjerava konačnost,
  ali `Decimal` može podliti nenultu vrijednost na nulu; drugi tokovi zaobilaze ograničenja
  skale/opsega. Dokaz: `backend/src/common/utils/decimal-input.ts`, F-CI-05-64 i historijski
  STATE (2026-11-05). Prijedlog: test-first validacija ulaza prije konverzije i posebno
  sistematska inventura skale/opsega po polju; ne tvrditi da postojeći podaci popravljeni.

## Sesije i autentifikacija

- **BL-002 — visoko, otvoreno, F-FE-06-06 / F-CI-05-29–33:** gubitak odgovora nakon
  rotacije, nepodržani Web Locks, stari tabovi ili kopirani storage mogu dovesti do reuse i
  opoziva legitimnih sesija. Dokaz: `AUDIT/segments/FE-06.md` F-FE-06-06 i CI-05 ledger.
  Prijedlog: dizajnirati i test-first dokazati serverski protokol sigurnog ponavljanja bez
  slabljenja detekcije krađe; posebno pokriti više tabova i nepoznat ishod.

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
