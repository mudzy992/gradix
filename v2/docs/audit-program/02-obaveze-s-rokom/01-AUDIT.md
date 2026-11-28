# Modul 2 — Obaveze s rokom: statički audit

**Snimak:** 2026-11-27 · **Grana:** `arena/7b5ea9bf-gradix` · **Pregledani kodni commit:** `e7a37910a9c0a651d3d77a059592d755330b399c`
**Normativni izvor:** [zaključana specifikacija 02](../../specs/02-obaveze-s-rokom.md) · **Status:** spremno za vlasnički pregled; trijaža i težine nisu potvrđene.

## Opseg i dokazni standard

Pregled je bio samo za čitanje nad web/API, `v2/packages/*`, migracijama i workerima povezanim s obavezama. Mobilni kod nije pregledan, mijenjan ni testiran prema pravilima programa. Testni fajlovi su samo postojeći ankeri. U ovoj sesiji nisu pokretani testovi, typecheck, lint, build, DB/preflight, deploy ni pilot provjera. Nalaz o kodu ne dokazuje ponašanje baze ili produkcije. Zaključci su vezani za HEAD naveden iznad; nema tvrdnje o primijenjenim migracijama.

Specifikacija 02 ostaje zaključana. Ispod su kandidati za trijažu, ne konačni nalazi niti vlasnički prihvaćene ocjene. Nije potvrđen S0; posebno, tamo gdje nema produkcijskog writer-a ne zaključujem da je mogući put zaobilaženja trenutno iskorištiv.

## Sažetak

Osnovni vertikalni dijelovi postoje: servisi ograničeni na firmu, verzije obaveza, izračun stanja, pravila missing, zajednički servis priloga, API za pregled/obnovu, podsjetnici u workeru i testni uporišni fajlovi. Statički pregled ipak nalazi značajna nepovezana mjesta između šeme, upisnih puteva, provedbe pravila i UI-ja: novi `usage_overrides` tok nije postao izvor istine; `tender_submit` nije pozvan pri predaji tendera; opći flagovi pregleda/osjetljivosti nisu dostupni kroz tipove; masovne radnje nisu atomarne kako traži spec; a missing, review i kalendar nisu pokriveni odgovarajućim uredskim UI-jem.

### M2-01 · Iznimke: migracija, odobrenje i stvarni enforcement nisu usklađeni

- `v2/packages/db/migrations/20261123130000_f0_3_usage_overrides/migration.sql` pravi `usage_overrides`, ne briše staru tabelu i kopira svaki red s razrješivim radnikom bez filtera po `approved_at` ili `assignment_id`. R3 (`v2/packages/db/migrations/20261109170000_r3_iznimka_zahtjev/migration.sql`) dopušta zahtjeve sa `assignment_id = NULL`, `approved_at = NULL`, `valid_until = NULL`; oni se prenose kao `WORKER/assign` s `reference_id = obligation_id`, otvorenim datumom važenja i bez odobrenja.
- Šema dopušta da su `approved_by` i `approved_at` oba `NULL`; constraint samo traži da budu zajedno NULL ili zajedno postavljeni. `v2/apps/web/src/server/usage-service.ts#loadOverrides` i batch čitači filtriraju po firmi, subjektu, radnji, datumu i `reference_id`, ali ne provjeravaju odobrenje niti obaveznost `valid_to`. `v2/packages/domain/src/can-use-entity.ts#canUseEntity` traži razlog i podudaranje akcije/reference, ne odobrenje. Zato se preneseni zahtjev može prikazati kao djelotvorna iznimka u `v2/apps/web/src/app/api/me/blockers/route.ts` za `assign`.
- Ovaj statički nalaz **ne dokazuje da se tako može izvršiti dodjela**: `v2/apps/web/src/server/project-service.ts#createAssignment()` i dalje koristi `v2/packages/domain/src/assignments.ts#checkAssignment` i staru tabelu, a produkcijski writer za `usage_overrides` nije pronađen. Rute `v2/apps/web/src/app/api/projects/[id]/override-requests/**` i dalje rade nad legacy tabelom. F2 (`v2/packages/db/migrations/20261124130000_f2_1_obligation_requirements/migration.sql`) ipak navodi da je §19 već ispunjen; generički tok zahtjev/odobrenje za subjekt + akciju nije pronađen.
- F4.1 (`v2/packages/db/migrations/20261124160000_f4_1_mehanizacija/migration.sql#project_assignment_machine_global_guard`) pušta globalno preklapanje kad je `double_booking_override_id` samo ne-null. FK potvrđuje da neki red `usage_overrides` postoji, ali trigger ne provjerava odobrenje, subjekt, akciju, datum ili referencu. Pregledani produkcijski čitač je `v2/apps/web/src/server/machine-availability-service.ts`; writer nije pronađen.

**Trijaža:** preporuka da se razmatra kao S1 zbog odobrenja/blokada; nema osnove za S0 bez potvrde stvarno dostupnog upisnog puta od zahtjeva do izmjene. Potrebna je provjera stvarnih migriranih podataka i ciljano testiranje prije zaključka o uticaju.

### M2-02 · Jedinstveni motor blokada nije povezan sa svim poslovnim radnjama

`v2/packages/domain/src/can-use-entity.ts` sadrži očekivane akcije i pravila blokiranja; `v2/apps/web/src/server/usage-service.ts` učitava obaveze i iznimke. Produkcijski `checkUse()` se poziva u turama (`v2/apps/web/src/server/haul-service.ts`), satima mašina (`v2/apps/web/src/server/machine-work-log-service.ts`) i njihovim sync putanjama. Međutim:

- `v2/apps/web/src/server/project-service.ts#createAssignment()` koristi drugi put: `entityObligations()` + `v2/packages/domain/src/assignments.ts#checkAssignment`, bez `canUseEntity()`/`usage_overrides`. `v2/apps/web/src/app/api/me/blockers/route.ts` koristi motor za radnikovu `assign` poruku, ali to nije isti enforcement kao upis dodjele. Za mašine odgovor iz `v2/apps/web/src/server/usage-service.ts#meBlockers` sadrži `haul`, `machine_hours` i `fuel`, ne mašinsku `assign` odluku.
- `v2/apps/web/src/server/tender-service.ts#changeStatus` pri prelazu u `SUBMITTED` provjerava rok i checklistu, ali ne poziva `checkUse(..., action: "tender_submit")`. Pretraga tender API/servisa nije našla drugi poziv. Domena i `usage-service` znaju za `TENDER`, ali to samo po sebi ne blokira predaju.
- F2 migracija (`v2/packages/db/migrations/20261124130000_f2_1_obligation_requirements/migration.sql`) mapira `blocks_actions` na `tender_submit` za `entity_kind = 'PROJECT'`; za `TENDER` ostavlja podrazumijevani `{assign}`. F7 seed (`v2/packages/db/migrations/20261125120000_f7_1_tenderi/migration.sql#seed_obligation_types`) postavlja `blocks_assignment = false` za tender tipove. Tip API/service izlaže samo legacy `blocksAssignment`, ne upravljanje `blocks_actions`. Zato u pregledanom toku nema konfigurisanog puta koji bi istekloj tender obavezi dao enforcement pri predaji.
- `fuel` upozorenje postoji u `meBlockers()`, ali pregledani upisni servisi `v2/apps/web/src/server/fuel-entry-*.ts` ne pozivaju `checkUse` niti vraćaju warning uz samu radnju. Upotreba shared endpointa na mobilnom nije predmet ovog audita.

**Trijaža:** `tender_submit` je S1 kandidat (obavezna kapija pri ključnom toku); ostale razlike su djelimična/nepotvrđena integracija. Nije provjereno ponašanje uživo.

### M2-03 · Pregled, obavezan prilog i prava nisu opći tok

- F2 DDL (`v2/packages/db/migrations/20261124130000_f2_1_obligation_requirements/migration.sql`) dodaje `obligation_types.requires_review` i `sensitive`, oba s defaultom `false`. U seedovima te obligation type API/service/contracts sloju (`v2/apps/web/src/server/obligation-service.ts#TYPE_SELECT`, `v2/packages/contracts/src/schemas.ts#ObligationType`) nisu pronađeni njihovi writer-i/response polja. Tip zato ne može kroz postojeći ugovor izraziti opći review ili osjetljivost.
- Jedini pronađeni produkcijski setter `review_state = 'pending_review'` je `v2/apps/web/src/server/hse-service.ts#createTrainingTx()` za ograničene certifikacijske tipove. Taj put provjerava prilog `status='ready'` vezan baš za istu obavezu. `v2/apps/web/src/app/api/obligations/[id]/review/route.ts` prihvata samo već postojeći `pending_review`; ne postoji opći submit-for-review tok.
- `v2/apps/web/src/app/ured/rokovi/obligation-detail.tsx#DetailDialog` prikazuje detalje, verzije i priloge te upload/download, ali u pregledanom UI-ju nema review kontrole niti prikaza `reviewState`/`reviewNote`. Nije pronađen filter/oznaka „Nema priloga“. Review endpoint ne provjerava `requires_review` ili ready prilog sam; HSE putanja ga trenutno provjerava, pa rizik izvan tog puta traži test/vlasničku trijažu.
- `obligations.attachments.manage` postoji u `v2/apps/web/src/server/permissions.ts`, ali obaveza upload/confirm i generički attachment DELETE provjeravaju `obligations.manage` preko `v2/apps/web/src/server/attachment-access.ts#ATTACHMENT_ACCESS`. Konkretne rute su `v2/apps/web/src/app/api/obligations/[id]/attachments/route.ts`, `v2/apps/web/src/app/api/obligations/[id]/attachments/[attachmentId]/confirm/route.ts` i `v2/apps/web/src/app/api/attachments/[id]/route.ts`. Uži permission nije spojen na taj put/UI; korisnik sa samo `obligations.attachments.manage` nema upload/confirm/DELETE put.

### M2-04 · Osjetljivi prilog: ACCESS audit i retencija nisu povezani s flagom

- `v2/apps/web/src/server/attachment-service.ts#attachmentDownloadUrl` vraća potpisani GET link, ali pregledani servis ne upisuje `attachment.sensitive_viewed`/ACCESS događaj. Writer za tu akciju nije pronađen. Ruta `v2/apps/web/src/app/api/obligations/[id]/attachments/[attachmentId]/url/route.ts` ima dozvolu `obligations.attachments.view`, ali sama dozvola ne nadomješta audit čitanja iz §32.
- `v2/apps/worker/src/attachments-purge.ts#findPurgeCandidates` koristi `obligation_types.sensitive`; F7 seed (`v2/packages/db/migrations/20261125120000_f7_1_tenderi/migration.sql#seed_obligation_types`) i pregledani type API ne postavljaju flag pa tipovi ostaju na defaultu `false` i ulaze u 10-godišnju granu. Grana osjetljivih priloga traži `workers.ended_at IS NOT NULL`; nema zamjenske provjere deaktivacije radnika bez tog datuma, kako traži §31.
- `v2/apps/worker/src/attachments-purge.ts#purgeAttachments` nakon brisanja objekta mijenja bazni red u `status='deleted'`; specifikacija §31 traži brisanje objekta **i reda** uz audit bez sadržaja. Razlika može biti namjerna zbog postojećeg ACL/retention pravila (worker komentar navodi da nema DELETE granta), ali nije usklađena sa zaključanim specom i traži vlasničku odluku, ne prećutnu zamjenu.

**Trijaža:** preporuka S1 za vlasničku procjenu osjetljivih nalaza/retencije; nije dokaz neovlaštenog čitanja niti deploy stanja.

### M2-05 · Masovne radnje odstupaju od atomarnosti

- `v2/apps/web/src/server/obligation-requirement-service.ts#bulkRenewObligations` poziva `renewOne()` redom. Ruta `v2/apps/web/src/app/api/obligations/bulk-renew/route.ts` za svaku obavezu zasebno poziva `v2/apps/web/src/server/obligation-service.ts#renewObligation` ili zasebni `withCompany()` update trajne obaveze. Prethodne stavke su već potvrđene u bazi ako kasnija padne; rezultat eksplicitno dopušta `renewed` + `failed`. To odstupa od §1.6.33: jedna greška mora ostaviti nula upisa.
- `v2/apps/web/src/server/obligation-import-service.ts#applyImport` otvara transakciju, ali koristi `SAVEPOINT` po redu, vraća grešku tog reda, nastavlja i na kraju vraća djelimičan `created/replaced/skipped` rezultat. Apply ruta je `v2/apps/web/src/app/api/obligations/import/apply/route.ts`. To odstupa od §1.6.34 „sve ili ništa“.
- `v2/apps/web/src/server/obligation-requirement-service.ts#createMissingObligations` hvata SQL grešku po stavci bez savepointa unutar jedne transakcije. Nakon PostgreSQL greške transakcija ostaje abortirana; kasniji upisi i završni audit mogu pasti, pa kodom predviđeni `skipped` izvještaj nije pouzdan. Ovo je strukturni zaključak, nije runtime-provjeren.

**Trijaža:** S1 kandidat za masovne mutacije zbog izričitog atomarnog ugovora; procijeniti razdvojeno ako vlasnik želi različitu težinu za uvoz i obnovu.

### M2-06 · Missing pravila: servis postoji, ali čitanje i uredski UI su djelimični

- `v2/apps/web/src/server/obligation-requirement-service.ts#listMissing` i `v2/apps/web/src/app/api/obligation-requirements/**` podržavaju Worker/Machine/Project i scope-ove iz šeme. Nije pronađena stranica/editor `/ured/rokovi/zahtjevi`; `v2/apps/web/src/app/ured/rokovi/missing-panel.tsx#MissingPanel` u komentaru obećava prelazak na pravila, ali prikazuje samo grupisane brojeve i najviše osam grupa (`groups.slice(0, 8)`), bez tražene tabele entitet × tip i pune liste za rad.
- `v2/apps/web/src/app/api/obligations/missing/route.ts#GET` traži `obligations.manage`, dok spec §3 traži `obligations.view`. `v2/apps/web/src/app/ured/rokovi/page.tsx` dopušta `obligations.view` i uvijek montira `MissingPanel`, pa read-only korisniku panel može završiti greškom 403.
- Missing je zasebna ruta/panel ispod liste. `v2/apps/web/src/app/api/obligations/route.ts#GET` ne uključuje `state=missing`; route komentar izričito kaže da missing nema pandan u listi, za razliku od §1.1/§3 zahtjeva za stanje/listu. Filteri, prioritizacija i prikaz zato nisu jedan ugovor.
- `v2/apps/web/src/server/obligation-requirement-service.ts#loadMissing` bira jedan aktivni `project_id` po radniku/mašini preko `ORDER BY ... LIMIT 1`. Ako su istovremene dodjele na više projekata dozvoljene (`v2/packages/db/migrations/20261109120000_r3_projekti/migration.sql` sprječava preklapanje unutar istog projekta, ne dokazuje globalnu jedinstvenost), PROJECT-scope pravilo može biti izostavljeno za drugi projekat. Potrebno je potvrditi semantiku/ograničenje.
- `v2/packages/domain/src/obligations.ts#obligationCoversRequirement` računa svaku nezamijenjenu obavezu kao pokriće, uključujući isteklu. Komentar to obrazlaže kao „missing = nikad nije unesena“, dok spec kaže „aktivne obaveze tog tipa nema“. To je otvoreno značenje „aktivna“, ne proglašavam ga kvarom dok vlasnik ne izabere da li isteklo znači missing, expired ili samo expired.

**Trijaža:** preporuka S2 za UI/pristup i moguć gubitak pokrivenosti; semantička pitanja ostaju bez težine.

### M2-07 · Podsjetnici i eskalacija ne znaju je li obavijest riješena

- `v2/apps/worker/src/reminders-scan.ts` računa firmni 06:00 prolaz, rokove i primaoce; `obligation_notify_roles` se čita, ali nije pronađena ruta/UI/seed za konfiguraciju. Bez zapisa se koristi `[ADMIN, PROJECT_MANAGER]` uz odgovornog korisnika i radnika lično; spec navodi i tip-specifične role (npr. SITE_SUPERVISOR, vozač).
- `v2/apps/worker/src/reminders-scan.ts` pravi eskalaciju za svaki `daysLeft <= 3`, bez provjere da li je notifikacija riješena. Šema (`v2/packages/db/migrations/20261123140000_f0_4_notifications/migration.sql`) ima `read_at` i `actioned_at`, ali nema `resolved_at`; web `v2/apps/web/src/server/notification-service.ts` izlaže `markRead()`, a resolve/action API nije pronađen (`v2/apps/web/src/app/api/notifications/` sadrži samo `route.ts` i `read/route.ts`). Čitanje nije isto što i rješavanje po §25–26.
- Worker koristi vlastiti `INSERT INTO notifications` u `v2/apps/worker/src/reminders-scan.ts`, ne zajednički `notify()` iz `v2/apps/web/src/server/notification-service.ts`; helper upisuje `notification_deliveries` IN_APP red koji worker putanja ne pravi. In-app stavka se pojavi u inbox tabeli, ali zajednički delivery/audit put je zaobiđen.

**Trijaža:** S2 kandidat / presjek s Modulom 12; bez trijaže se ne zaključuje koliko ponovljene eskalacije utiču na korisnike.

### M2-08 · Tipovi: PATCH ugovor je nepodudaran i F2 polja nisu upravljiva

`v2/apps/web/src/app/api/obligation-types/[id]/route.ts` parsira `ObligationTypeInput.partial()`, ali `v2/apps/web/src/server/obligation-service.ts#updateObligationType` poziva `validateTypeInput()` koja traži `code`, `label` i `entityKind`; validan parcijalni PATCH se odbija. Čak i puni poziv SQL-om ne ažurira `code`, iako ga validator prima. Ugovor API-ja, servis i lista tipova (`v2/packages/contracts/src/schemas.ts#ObligationTypeInput`, `v2/apps/web/src/server/obligation-service.ts#ObligationTypeRow`) ne izlažu F2 polja `requiresReview`, `sensitive` ni `blocksActions`; nude samo legacy `blocksAssignment`. Kreiranje i izmjena ne upisuju F2 polja. Tipovi se učitavaju u `v2/apps/web/src/app/ured/rokovi/obligations-client.tsx`, ali nije pronađen editor tipova u toj stranici.

**Trijaža:** S2 kandidat; statički ugovorni nesklad, nije testiran.

### M2-09 · Izvoz i kalendar

`v2/apps/web/src/app/api/obligations/export/route.ts` i `v2/apps/web/src/server/obligation-export-service.ts` vraćaju CSV/PDF i auditiraju, ali nema zaglavlja firme s logom, nazivom i PIB-om iz §1.6.35. Rokova UI (`v2/apps/web/src/app/ured/rokovi/obligations-client.tsx`) koristi drugi endpoint, `v2/apps/web/src/app/api/obligations/list-export/route.ts`, koji izvozi šest kolona u CSV, ne nudi PDF i takođe nema zaglavlje. U `v2/apps/web/src/app/ured/rokovi/` i obaveza API rutama nije pronađen kalendar mjesec/sedmica niti klik-na-dan filter (§1.6.36). Nije pronađen ni filter „Nema priloga“ (§1.5.30).

**Trijaža:** S2 kandidati za izvještavanje/UI; PDF API prisustvo nije isto što i UI tok.

## Šta je potvrđeno samo statički / šta nije zaključak

- `withCompany()` se koristi u pregledanim M2 servisima, a scope helperi i firmni filteri su prisutni. Nije rađena runtime tenant/RLS provjera.
- Verzije, datum isteka, `review_at`, opseg obaveze, upload/confirm i osnovni state motor postoje. To nije dokaz potpune usklađenosti review/sensitive/atomic tokova.
- HSE certifikacijski put za obnovu provjerava ready prilog vezan za obavezu; to ne zatvara generički `requires_attachment`/`requires_review` ugovor.
- Testni ankeri postoje: `obligations.integration.test.ts`, `obligation-requirement.integration.test.ts`, `obligation-scoped-flows.integration.test.ts`, `obligation-isolation.integration.test.ts`, `obligation-attachment-register.integration.test.ts`, `usage-service.integration.test.ts`, `tender-lifecycle.integration.test.ts`, `tender-status.test.ts`, domena `obligations.test.ts`/`can-use-entity.test.ts`, UI `obligations-client.test.tsx`/`missing-panel.test.tsx`, export route testovi. Nijedan nije pokrenut u ovom prolazu.

## Otvoreno za vlasničku trijažu

1. Koje stavke prihvatiti kao S1/S2/S3? Nijedna težina u ovom dokumentu nije potvrđena.
2. Da li je `active obligation` za missing „nezamijenjen red“ ili „važeći dokument“; kako vrednovati `rejected` i `review_due` u prioritetu?
3. Da li je dopušteno da radnik/mašina istovremeno ima aktivne dodjele na više projekata i kako projektno pravilo tada važi?
4. Da li postojeći project override tok treba migrirati na opći `usage_overrides` ili je namjerno paralelan; koji writer ovlašćuje iznimku za assign/haul/machine_hours/tender_submit i dvostruku dodjelu?
5. Koja konkretna pravila konfiguriraju `obligation_notify_roles`, te šta je „riješeno“ obavještenje naspram samo pročitanog?

Nijedna preporuka ovdje ne odobrava implementaciju. Za poslovni kod i dalje je potrebna zasebna kapija **`KREĆEMO U KODIRANJE: 2`**.
