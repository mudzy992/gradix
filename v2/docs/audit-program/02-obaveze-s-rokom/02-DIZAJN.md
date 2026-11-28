# Modul 2 — Obaveze s rokom: ciljni dizajn

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [specifikacija 02](../../specs/02-obaveze-s-rokom.md), [PRAVILA.md](../PRAVILA.md).
**Status:** prijedlog za trijažu i vlasnički pregled; ništa nije odobreno za kodiranje.

## 1. Cilj i granice

Uskladiti vezu između tipa, aktivne obaveze, jedinstvene odluke `canUseEntity`, iznimke, priloga, pregleda, podsjetnika i uredskog prikaza. Zaključani spec 02 je ugovor; ovaj dokument ga ne mijenja. Mobilni UI ostaje izvan obuhvata. Svaki tenant poslovni upit ostaje u `withCompany()` uz provjeru scope/RLS; UI nije sigurnosna granica. Sve promjene čekaju **`KREĆEMO U KODIRANJE: 2`**.

## 2. Odluke koje prvo traže vlasnika

1. **Missing i stanje:** potvrditi da li „aktivna obaveza“ znači nezamijenjen zapis ili dokument koji još važi; odrediti odnos `expired`, `rejected`, `pending_review`, `review_due` u prikazu i prioritetu, bez izmjene zaključanog speca prije odluke.
2. **Projektna primjena pravila:** potvrditi da li `applies_scope=PROJECT` za radnika/mašinu važi za svaku istovremenu dodjelu ili samo jednu trenutnu; postojeći SQL uzima jedan projekat.
3. **Iznimke:** odobriti mjerodavni životni ciklus i migraciju između `project_assignment_overrides` i `usage_overrides`. Zabilježiti zahtjev → odluka OWNER/ADMIN → aktivna iznimka, dozvoljene akcije, izvor blokade, `valid_from/valid_to`, razlog, opseg firme i vidljiv trag. Posebno potvrditi da li `valid_to = NULL` znači neograničeno važenje ili je završni datum obavezan; ne zaključivati to iz trenutne šeme. Ne tretirati `read_at` kao odobrenje ni `NULL approved_*` kao aktivno stanje.
4. **Obavijest riješena:** precizirati da li se eskalacija zatvara samo eksplicitnom radnjom „riješeno“ ili drugom poslovnom promjenom; razgraničiti polje/API od `read_at` i `actioned_at` u zajedničkom M12 sistemu.
5. **Osjetljivi tipovi i retencija:** vlasnik potvrđuje koje vrste su `sensitive` i `requires_review`; spec određuje 24 mjeseca nakon prestanka/deaktivacije za osjetljive i 10 godina za ostale. Predloženi audit i fizičko brisanje reda treba uskladiti s DB ACL/append-only praksom bez tihe promjene specifikacije.

Bez tih odluka se ne dodaje nova semantika, ne uklanja legacy tabela i ne mijenjaju prava.

## 3. Ciljna nepromjenjiva pravila

### 3.1 Jedan enforcement i odobrene iznimke

- Svaki stvarni upis za `assign`, `haul`, `machine_hours` i `tender_submit` poziva isti `canUseEntity` put u transakciji koja upisuje poslovni zapis. `fuel` i `workday` ostaju dozvoljeni, ali vraćaju upozorenje u ugovorenom prikazu. Stari `checkAssignment()` se ili uklanja ili postaje spojni adapter istog pravila; ne smije postojati drugi izvor odluke.
- `usage_overrides` je djelotvoran samo uz dokazivo odobrenje, kada važenje obuhvata današnji poslovni datum i subjekt, akcija i referenca tačno odgovaraju blokeru. Značenje `valid_to = NULL` mora biti vlasnički potvrđeno prije odluke da li je iznimka otvorenog roka djelotvorna. Pending zahtjev nikad nije override; migracija ne smije aktivirati stari pending red.
- DB guard za dvostruku dodjelu mora potvrditi odobrenu iznimku za baš tu mašinu/preklapanje; ne oslanjati se samo na ne-null FK. Ne uvoditi writer dok podaci i approval invariant nisu testirani.
- Tender prelaz u `SUBMITTED` provjerava `tender_submit` u istoj transakciji kao promjena statusa. Tipovi `TENDER` moraju moći nositi i izložiti odgovarajuće `blocks_actions`/flagove.

### 3.2 Tip, prilog i review

- Zajednički contract i API za tip vraćaju/mijenjaju `requires_attachment`, `requires_review`, `sensitive` i `blocks_actions` gdje je to dozvoljeno. Seedovi eksplicitno označavaju predviđene tipove; ne oslanjati se na `false` default za medicinski nalaz.
- `requires_attachment` znači `ready` prilog vezan za baš tu obavezu prije slanja na review i prije potvrde. `pending` nije dokaz. Oznaka/list filter „Nema priloga“ koristi isti server-side kriterij.
- Opće slanje na pregled mijenja stanje tek uz propisane priloge; API za odluku o pregledu atomarno prihvata samo trenutno `pending_review`, odbijanje traži razlog i čuva audit zapis. Detalj pokazuje stanje/razlog i akcije samo rolama s odgovarajućim pravima.
- `obligations.attachments.view` i `obligations.attachments.manage` su stvarne route/UI kontrole; ne svoditi upravljanje prilozima na `obligations.manage`. ACCESS audit nastaje pri izdavanju/otvaranju osjetljivog sadržaja, bez sadržaja/naziva fajla u metapodacima.

### 3.3 Masovne radnje i missing

- Grupna obnova prvo validira sve odabrane ID-jeve i promjene, zatim kreira sve verzije i audit u jednoj tenant transakciji. Greška bilo koje stavke vraća nula izmjena; nema pozivanja `withCompany()` po redu.
- Uvoz parsira i validira cijeli fajl prije upisa. Ako jedna stavka nije prihvatljiva ili se stanje promijenilo od preview-a, cijeli apply se odbija bez zamjene/upisa; greške se vraćaju po redu. Ne koristiti per-row savepoint kao semantiku djelimičnog uspjeha.
- „Kreiraj sve nedostajuće“ ostaje jedna transakcija i vraća vjerodostojan broj stvorenih/preskočenih. Ako se podrži oporavak po redu, svaki pokušaj mora biti izolovan savepointom i ugovor mora izričito zadržati djelimični ishod; to ne mijenja pravilo §1.6.33/34 za bulk renew/import.
- Missing GET zahtijeva `obligations.view`; create i pravila ostaju `obligations.manage`. Uredski ekran prikazuje sve grupe i konkretne entitete, s uređivačem pravila i jasnim filterima; nema čvrstog ograničenja na osam bez paginacije ili opcije „prikaži sve“.
- Project-scope ulaz se računa za sve aktivne dodjele koje semantika dopušta, bez `LIMIT 1` gubitka. Jedan domenski helper odlučuje `obligationCoversRequirement`; rezultat je usklađen sa odobrenom definicijom „aktivna“.

### 3.4 Podsjetnici, eskalacija i izvještaji

- `reminders.scan` koristi jedan zajednički, server-side `notify()` ugovor i pravi odgovarajuću IN_APP isporuknu evidenciju u `notification_deliveries`; po potrebi se postojeći web servis izdvaja na zajedničku serversku granicu koju web i worker mogu pozivati. Direktni `INSERT` u `notifications` se ne uvodi. Uloga po tipu se može upravljati kroz odobreni UI/API ili se svjesno dokumentira fiksni default; M2 ne uvodi skriveni SQL-only konfiguracijski put.
- Eskalacija prema OWNER-u provjerava je li obavijest neriješena prema dogovorenom modelu; `read_at` ne zatvara slučaj. Dedupe ostaje tenant-scopovan i idempotentan.
- Izvoz CSV/PDF koristi trenutne server filtere i firmno zaglavlje (logo, naziv, PIB). Stranica nudi oba formata ili jasno definisan odobreni put. Kalendar mjesec/sedmica filtrira istu listu na klik dana.
- Retencija briše objekt i red prema specu, čuva samo dopušteni audit dokaz, koristi fallback deaktivacije kad nema `ended_at` i ponovljeni prolaz je siguran. Fizičko brisanje mora proći DBA/ACL i audit provjeru, ne zaobilaziti je.

## 4. Ugovori i mjerila testiranja prije implementacije

| Površina | Invarijanta za test |
|---|---|
| Iznimka | Pending/NULL approval ne otključava nijednu radnju; odobrena iznimka vrijedi samo za tačan subject/action/reference i datum do uključivo; istekla ne važi. Migracija čuva zahtjeve kao pending, ne kao odobrene. |
| `canUseEntity` | Upis assignment/haul/machine-hours/tender-submit odbija `expired` i `rejected`; `missing`/`pending_review` ne blokiraju; `fuel`/`workday` ne odbijaju, ali vraćaju upozorenje. I odluka i upis vide istu transakciju. |
| Pregled/prilog | `requires_attachment=true` bez `ready` priloga ne može preći u stanje pregleda/odobrenja; prilog druge obaveze/firme ne prolazi; pregled je moguć samo iz `pending_review` stanja, a odbijanje bez razloga se odbija. |
| Osjetljivi prilog | Izdavanje potpisane GET veze za osjetljivi prilog piše ACCESS trag bez naziva/sadržaja fajla; seed osjetljivih tipova ulazi u 24-mjesečni rok čuvanja; bez `ended_at` deaktivacija pokreće isti rok; objekat i red se uklanjaju, audit ostaje. |
| Grupna obnova/uvoz | N stavki uz jednu neispravnu ili konkurentno promijenjenu stavku → nula poslovnih upisa; audit odgovara stvarnom ishodu; nema djelimično obnovljenih/zamijenjenih verzija. |
| Missing | Aktivni/inaktivni subjekti, sve scopes, više projekata, expired/superseded/rejected pokriće i view-only dozvola daju dogovorene rezultate; kreiranje izvještava pouzdano i ne ostavlja abortiranu transakciju. |
| Podsjetnik | Ponovni prolaz ne duplira; resolved obavijest ne eskalira; samo `read` ne mijenja resolution; role po tipu i delivery row odgovaraju ugovoru. |
| Tenant/scope | Firma B ne vidi niti mijenja firmu A; PROJECTS/SELF scope je isti u listi, detailu, missing, review, izvozima i mutacijama. |

## 5. Otvorena implementacijska ograničenja

- Postojeći testovi i migracije su samo dokaz prisutnosti; nisu pokrenuti. Sve acceptance probe (DB, race, RLS, API/UI, worker, export) rade se tek nakon kodne kapije.
- M1/M12 presjeci: osjetljivi ACCESS audit i obavještenja/isporuku treba koordinirati s vlasnicima zajedničkih servisnih površina. M2 ne pravi paralelni inbox, outbox ni novu dozvolu izvan zaključanog speca.
- Novi ekran/obrazac za pravila, pregled ili kalendar i svaki novi vizuelni obrazac prije UI koda traži UI-odobrenje, dopunu `reference.html` i `/katalog` te vlasnikovo „ovako“; kodna fraza sama to ne zamjenjuje.
- Nema prepravke `v2/docs/specs/02-obaveze-s-rokom.md` niti mobilnog UI-ja u ovom dizajnu. Promjena briefa traži zasebnu vlasničku odluku.

Ovaj ciljni dizajn je prijedlog, ne odobren SQL/API niti dozvola za kodiranje.
