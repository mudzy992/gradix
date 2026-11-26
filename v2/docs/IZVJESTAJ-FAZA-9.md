# Izvještaj — Faza 9: Dnevnik građenja i zaštita na radu

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Specifikacija:** `10-dnevnik-hse.md`

Ovaj izvještaj bilježi isporuku i lokalne rezultate prije završnog GitHub CI pokretanja. Stvarni
rezultat CI-ja i položaj taga `phase-9` provjeravaju se na GitHubu; prethodni zeleni run za
`e5b0a7f` ne pokriva ove izmjene. Faza 10 nije mijenjana u ovom zadatku.

## 1. Šta je isporučeno

### Baza

- Dnevnik po firmi, projektu i danu; stavke, zastoji, revizije i šabloni. Zaključavanje i zaštita
  potpisanog sadržaja, audit i trag revizije.
- Incidenti, nepromjenjive činjenice i dopune, istrage, mjere, inspekcije, obuke, prisustvo i
  prilozi. Forward migracija dodaje sve uključene i više povrijeđenih radnika, composite tenant
  FK-ove, FORCE RLS i backfill ranijeg povrijeđenog; `NEAR_MISS` ne prima povrijeđene.
- Svježa baza: **51 migracija, 120 tabela**, uključujući `schema_migrations`; 111 tenant tabela
  u admin katalogu. Aplikacijska rola nema direktni pristup internim cursor tabelama.
- Mobilni SQLite v5 zadržava postojeće redove i dodaje account-scoped keš dnevnika i trajni red
  foto bajtova; incident i lokalne fotografije spremaju se atomski.

### Domena i API

- Pravila dnevnika, zastoj do 24 h, sekcijski sukobi, projekt i poslovni datum količine, BOQ
  ažuriranje u transakciji, potpis i audit. Offline potpis uspoređuje prikazani automatski
  presjek i verziju; promijenjeni presjek ide u konflikt, a nepotpisan ili nedozvoljen zahtjev
  ne potpisuje dnevnik.
- `NEAR_MISS`, mjere s odgovornim i rokom, Toolbox potpisi, odvojena statistika i LTIFR. Lista
  svih učesnika provjerava firmu i ne dozvoljava duplikate.
- Push/pull sa idempotentnim potvrdama; zavisne stavke čekaju uspješan roditeljski dnevnik ili
  incident. Potpis čeka prethodne promjene. Nakon prekida se prvo ponavlja isti ID, pa tek nakon
  potvrde šalje zavisni zapis.
- Stara količina bez poslovnog ključa ne pogađa dan slanja: tek nakon potvrđenog odbijanja
  `DIARY_REFERENCE_REQUIRED` korisnik bira projekt/dan i kreira novi idempotency ID, dok original
  ostaje sačuvan. Neizvjestan ishod se prvo sigurno ponavlja.
- Foto nastavak: prijavitelj ili istražitelj dobija kratkotrajni staging PUT; server provjerava
  bajtove, veličinu, MIME i SHA-256, snima u zaseban trajni ključ i auditira potvrdu. Pristup je
  tenant-scoped; potvrđeni prilog dostupan je preko kratkotrajnog linka uz `hse.view`.
- OpenAPI: **243 putanje**; uključuje minimalni roster kolega na vlastitoj projektnoj dodjeli.

### Web i mobilni UI

- Web `/ured/dnevnik` i `/ured/hse`: pregled, potpis, revizija, dopune, istraga, mjere,
  inspekcije, obuke, PDF; detalj incidenta prikazuje sve učesnike i potvrđene fotografije.
- Mobilni `/dnevnik`: presjek radnika/sati, mašina, tura i kvarova; vrijeme, opis, posjetioci,
  događaji, zastoj, ručne količine i offline potpis. Nespremljeni unos se ne prenosi tiho na
  drugi dan/projekt; mete zajedničkog UI-ja su najmanje 56 dp.
- `/hse/prijava`: višestruki učesnici i povrijeđeni, kamera ili izbor slike, lokalni red,
  nastavak uploada, prikaz čekanja/odbijanja. `/hse/toolbox`: tema/projekt, lokalni roster i
  pojedinačna imena/vremena potpisa.

## 2. Nalazi testova i CI-ja

- Međukorak `d4573e0`: CI `45761033852` pao je na ESLint pravilu za import tipa; ispravljeno.
- Jednokratni lokalni puni `pnpm test` otkrio je dvije greške NUL-sweep registra novih foto ruta:
  1 312 testova prošlo, dva pala. Registrovane su GET/POST foto rute i roster/query; naknadni
  ciljani `nul-guard` prolazi **9/9**. Puni suite poslije ispravke lokalno nije ponovljen.
- `check-tenant-sql` prvi put pokrenut samo s aplikacijskom rolom nije vidio dvije namjerno
  privatne cursor tabele. Direktna ponovljena provjera s `DATABASE_ADMIN_URL`, kako dokumentuje
  sama skripta i koristi CI, prolazi **111/111**; bez proširivanja aplikacijskih grantova.
- Testovi provjeravaju izgubljen odgovor, ponovno otvaranje SQLite, odbijenog roditelja, nepoznat
  ishod, oporavak uz eksplicitni dan, promjenu naloga, neprijavljenog korisnika, tuđi tenant,
  neovlaštenog prijavitelja, neispravne bajtove, idempotentnu potvrdu i audit.

## 3. Tabela provjera

| Provjera | Rezultat |
|---|---|
| Puni test, jednokratni lokalni pokušaj | **1 312 prošlo, 2 pala** prije ispravke registra |
| Web u tom pokušaju | 723 prošla / 2 pala; naknadni ciljani NUL sweep 9/9 |
| Domena | 328 prošlo |
| Mobile | 123 unit + 22 screen = 145 prošlo |
| DB / contracts / worker | 70 / 21 / 25 prošlo |
| Ciljana F9 PG integracija | `f9-sync` 21/21 + `f9-diary-hse` 13/13 |
| `lint`, `typecheck`, `check-cycles` | prošli u jednokratnoj lokalnoj provjeri |
| `db:types:check` | prošao; tipovi sinhroni sa svježom bazom |
| `check-tenant-sql` | prvi pokušaj samo app rolom pao; ciljana provjera s admin katalogom 111/111 |
| `check-matrix-parity` | 0 grešaka; ranije R1 upozorenje |
| OpenAPI check / Android Metro export | prošli; export nije test na uređaju |
| Preflight SQL 001/002 | prošao kroz `pg` kao `gradix_app`; `run.sh` lokalno nije izvršen jer nema `psql` |
| S3 Coolify | korisnik ranije potvrdio bucket/object i browser CORS PASS |

## 4. Ograničenja i primopredaja

Mobilni screen testovi koriste mockove, a puni Maestro emulator i fizički uređaj nisu pokrenuti.
Offline roster je dostupan samo ako je prethodno dohvaćen za konkretnu dodjelu/dan; u suprotnom
je moguće ručno navesti ID povrijeđenog. Mobilni izbor BOQ stavke nije isporučen (ručni unos je
omogućen); za presjek koji ne stane u limit sync zapisa ekran upućuje na web potpis. PDF dnevnika
je `DRAFT_FORMAT` do potvrde obrasca. Oštećeni nečitljivi red se čuva za provjeru i ne šalje
zavisne zapise dok mu se ne utvrdi sadržaj. Staging objekt može ostati ako brisanje ne uspije;
potvrđena datoteka je u odvojenom ključu.

Završni commit i tag su na aktivnoj grani nakon objave; GitHub Actions je mjerodavan za konačni
CI status. Faza 10 ostaje sljedeći zaseban zadatak.
