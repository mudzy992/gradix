# Modul 2 — Obaveze s rokom: plan zatvaranja

**Osnova:** [01-AUDIT.md](01-AUDIT.md), [02-DIZAJN.md](02-DIZAJN.md), [PRAVILA.md](../PRAVILA.md).
**Status:** plan za vlasničku trijažu; nema odobrenja implementacije. Kodna kapija: **`KREĆEMO U KODIRANJE: 2`**.

## 1. Kapija i prioritet

Prvo vlasnik potvrđuje težine i otvorene semantike iz audita. Do tada se kandidati ne zatvaraju kao konačni nalazi, a zaključana specifikacija se ne mijenja. Rad poslije kapije ostaje samo u webu, zajedničkim paketima i radnicima iz opsega; mobilni ostaje isključen. Novi ekran/obrazac ili vizuelni obrazac traži zasebno UI-odobrenje, dopunu `reference.html` i `/katalog` te vlasnikovo „ovako“ prije UI koda.

Predloženi redoslijed nakon odobrenja: **A. iznimke + enforcement + tender_submit → B. review/sensitive/retencija → C. atomarne grupne radnje → D. missing/pravila/tipovi i uredski UI → E. podsjetnici/izvještaji/kalendar → F. verifikacija i pregled vlasnika.** Ako vlasnik odredi drugačiji prioritet, STATE i ovaj plan se ažuriraju prije rada.

## 2. Radni paketi

### A · Iznimke i stvarne poslovne kapije

1. Napraviti dokazni popis svih upisnih/čitalačkih tokova za `project_assignment_overrides`, `usage_overrides` i `double_booking_override_id`; u izolovanoj testnoj bazi provjeriti predstavnike prenesenih pending/approved redova. Produkcijske podatke ne čitati bez zasebnog odobrenja vlasnika.
2. Uz vlasničku odluku odrediti status model, approve gate i migraciju bez aktiviranja pending zahtjeva. Uvesti provjeru approved actor/time, exact subject/action/reference i konačnog roka u DB/service odluci.
3. Prebaciti assignment na zajednički `canUseEntity` enforcement, uz očuvanje odobrenja i vidljivosti iznimke; provjeriti da se prethodni `checkAssignment` ne raziđe.
4. Povezati `tender_submit` u `tender-service.ts#changeStatus()` u istoj transakciji s promjenom statusa; uskladiti `TENDER` tip i `blocks_actions` contract/seed. Pregledati fuel warning put bez blokiranja.

**Prihvat:** pending ili istekla iznimka nikad ne pušta; druga firma/akcija/reference ne pušta; `SUBMITTED` odbija expired/rejected tender obavezu, ali missing/pending-review ne blokiraju; audit sadrži odluku i nema writer-a koji preskače provjeru.

### B · Review i zaštita osjetljivih priloga

1. Dodati type contract/service/seed polja prema odobrenom planu za `requires_review`, `sensitive` i `blocks_actions`; ispraviti djelimični PATCH merge i pravilo `code` izmjene.
2. Spojiti generički upload-ready → submit-for-review → approve/reject tok. Provjera ready priloga mora biti server-side i unutar odobrene transakcije; UI prikazuje stanje/razlog i prava. Postojeći HSE cert put sačuvati kao adapter, ne drugi lifecycle.
3. Uskladiti `obligations.attachments.manage` u API/DELETE/upload/confirm/UI; dodati ACCESS audit prilikom sensitive URL izdavanja. Ne upisivati filename/sadržaj u audit.
4. Uskladiti retention sa specom: osjetljivi flagovi stvarno popunjeni, rok počinje od `ended_at` ili dogovorenog fallbacka na deaktivaciju, fizički objekt i bazni red se brišu uz ACCESS audit, bez fallbacka na soft-delete ako vlasnik potvrdi doslovni §31.

**Prihvat:** no-ready attachment ne može biti pregledan/odobren; user bez view/manage prava dobija deny; svako sensitive otvaranje ima ACCESS zapis; istekao retention uklanja objekt i red, a in-scope retry je siguran.

### C · Atomarnost i missing insert

1. Prebaciti bulk renew na jednu `withCompany()` transakciju i jedinstveni actor/scope; zaključati redove u stabilnom redoslijedu, prevalidirati sve, dodati sve verzije/review datume i audit, rollback na prvoj grešci.
2. Uvoz: validirati cijeli re-parsirani fajl i konflikt/no-overwrite uslove prije upisa; jedna transakcija bez per-row commit semantike. Konkurentna promjena od preview-a mora odbiti cijelu grupu.
3. Missing-create: ili fail-fast/rollback kao batch ili, samo uz vlasnički ugovor za `skipped`, savepoint po upisu da se transakcija može nastaviti; završni audit mora odgovarati stvarno commitovanim redovima.

**Prihvat:** N redova + jedna neispravna/konkurentna stavka → nula izmjena kod bulk renew/import; missing rezultat je tačan i nikad ne vraća uspjeh nakon abortirane transakcije.

### D · Pravila, missing i tipovi

1. Riješiti owner pitanja o expired coverage i više projekata; zatim uskladiti domenski helper, SQL dataset, list API i UI.
2. Ispraviti `GET /api/obligations/missing` permission na spec; dodati `/ured/rokovi/zahtjevi` editor uz API; prikazati punu listu/grupe s pagination ili eksplicitnim „sve“.
3. Uskladiti `GET /api/obligations?state=missing` i redoslijed/ counts ako je to dio ugovora koji vlasnik traži; ne skrivati missing ispod glavne liste bez potvrde.
4. Ukloniti `LIMIT 1` gubitak projektnog scope-a ili dokumentovati ograničenje kroz provjereni DB invariant.
5. Dodati testove partial PATCH-a, invalid type, `requires_review/sensitive/blocks_actions` contract i ready attachment filter.

**Prihvat:** view-only korisnik može čitati missing; editor je ograničen na manage; nijedna primjenjiva PROJECT rule stavka ne nestaje; API, panel i lista daju isti brojač/pokriće.

### E · Podsjetnici, izvoz i kalendar

1. Koristiti `notify()`/delivery shared ugovor; upravljati `obligation_notify_roles` rolama koje specifikacija traži.
2. Implementirati razliku `read` naspram `resolved`; worker eskalira samo prema odobrenom unresolved kriteriju i ostaje idempotentan po tenant/pragu/primaocu.
3. Izvoz: zajednički firmni header (logo/naziv/PIB), isti filteri i CSV/PDF kroz UI; audit prije odgovora. Dodati month/week calendar sa day filterom i `Nema priloga` filter.

**Prihvat:** resolve zaustavlja OWNER eskalaciju, read je ne zaustavlja; role recipients i delivery evidencija su potpuni; PDF/CSV odražavaju isti filter i header; kalendar klikom vraća isti skup kao lista.

## 3. Verifikacija nakon odobrenog koda

- **Domena:** `packages/domain` testovi za states, missing semantics, `canUseEntity`, overrides; dodati test za pending/unapproved/no-expiry.
- **Server/DB:** `obligations.integration.test.ts`, `obligation-requirement.integration.test.ts`, `obligation-scoped-flows.integration.test.ts`, `obligation-isolation.integration.test.ts`, `obligation-attachment-register.integration.test.ts`, `usage-service.integration.test.ts`; dodati DB migracijski i konkurentni test za approval/atomicity/trigger.
- **Presjeci:** pokrenuti `tender-lifecycle.integration.test.ts`/`tender-status.test.ts`; obuhvatiti HSE certifikacijsku obnovu i notification integration; dodati posebne worker testove za podsjetnike i purge priloga.
- **UI/API:** `obligations-client.test.tsx`, `missing-panel.test.tsx`, review UI tests, type PATCH contract, export route tests; e2e za manager, reviewer i view-only uloge.
- **Kontrole:** typecheck, lint, web/domain/worker testovi, build, migracije/DB preflight, RLS/grant/runtime role test, race test, quality/parity check i a11y. Sve se bilježi tačnom komandom/rezultatom; ne izvodi se iz postojanja fajla.
- **Operativno:** tek nakon DB/CI dokaza provjeriti deployment, storage purge retry, presigned link audit i stvarni reminder schedule na odobrenom okruženju. CI ne dokazuje deploy ni pregled vlasnika uživo.

Ovdje navedene komande i ankere nisu pokrenuti u audit prolazu. Nakon popravki ažurirati `04-MATRICA.md`, quality registry samo stvarnim rezultatima i predati M2 na vlasnički pregled; ne napisati „završen“ prije pregleda.
