# Modul 3 — Radno vrijeme, terenski unos i sync: plan nakon trijaže

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [02-DIZAJN.md](02-DIZAJN.md), [specifikacija 03](../../specs/03-radno-vrijeme-sync.md).

**Status:** fazni prijedlog ažuriran djelimičnom vlasničkom trijažom 2026-11-27; nijedna stavka nije odobrena za implementaciju.

## 1. Kapije prije rada

1. Vlasnik potvrđuje konačnu dispoziciju i težinu svakog M3 nalaza; ciljne politike M3-01/02/04/05/06/07/09/11/12/13/14/15 zapisane su 2026-11-27, ali ne potvrđuju nalaze, S0 ni runtime stanje.
2. Vlasnik/tehnički dizajn razrješava: M3-02 sync submit naspram approval gatea; M3-06 snapshot schema/freshness, race lock, istorija i eksplicitno razriješen dan; M3-11 receipt TTL/backfill, tenant-safe ACL i enumeracija neaktivnih firmi; M3-13 pre/post-booking correction, project-cost storno naspram M6 pay correction te praznični marker/istorija. M6 potvrđuje payroll interfejs; M5/M10 preuzimaju svoje entity resolvere/scope.
3. Ažurira se dizajn i acceptance kriteriji bez izmjene zaključane specifikacije; ako je potrebna promjena pravila, staje se do vlasničke odluke.
4. Poslovni kod ostaje netaknut do **`KREĆEMO U KODIRANJE: 3`**. Ovaj plan sam po sebi nije odobrenje.

## 2. Predloženi redoslijed rada

### Korak A — Ujednačiti efektivni scope i dozvole (M3-01)

**Površine:** `workday-review.ts`, `workday-timer-service.ts`, `workday-approval.ts`, `workday-week-actions.ts`, `workdays/*` API rute i njihove UI pozivne putanje.

**Cilj:** koristiti jedan server-side role ∩ session ∩ R3 assignment predicate za sedmični read, vrstu dana, grupnu potvrdu, odluku/lock i conflict list/detail. PROJECT_MANAGER ostaje samo u R3 assignment scopeu i kad session ima `scope=COMPANY`; firmni pregled pripada eksplicitno firmno ovlaštenim rolama.

**Gate:** PROJECT_MANAGER sa firmnim session-scopeom i dalje dobija samo R3; firmne role ostaju po izričitoj dozvoli; pozitivni/negativni company/project/self probeovi dokazuju da `setDayKind`, decide, lock, group confirmation i conflict read/mutacije ne šire scope. Sedmični odlučilac ne može odobriti vlastiti obračun.

### Korak B — Zatvoriti self-confirm i grupni tok (M3-02)

**Površine:** `workday-approval.ts`, `workday-timer-service.ts#bulkConfirm`, API rute confirm/confirm-bulk i statusni UI.

**Cilj:** isti team predicate/readiness gateovi za single/bulk, zabrana `viewerWorkerId === worker_id` i sedmičnog samoodobravanja; `workdays.status=SUBMITTED` i week-status/OPEN conflict/segment parity; uspješan pojedinačni/grupni confirm knjiži `bookWorkdayCost()` u istoj transakciji, audit rezultat odgovara potvrđenim danima.

**Gate:** single/bulk imaju iste server-side readiness gateove; vlastiti dan, ne-SUBMITTED dan, OPEN conflict/segment, nevažeće week stanje i radnik izvan R3 ostaju nepromijenjeni; sedmični actor ne odobrava vlastite sate; uspješan confirm + trošak je atomski, odbijeni poziv nema knjiženje.

**Sync subgate / vlasničko pitanje:** poravnati `workday` submit s postojećim `syncGateForWorkDate()` koji koristi `work_entry`; `LOCKED` reject, `WEEK_APPROVED` conflict, bez `approval_status` potvrde i bez cost booking side-effecta. Potvrditi da li OPEN conflict blokira samo kasniji confirm (preporuka) ili i sync `DRAFT → SUBMITTED`; testirati oba sync item tipa, week gate, replay i da se odbijeni push ne promijeni.

### Korak C — Opraviti timer datum/segment lifecycle (M3-03, M3-04, M3-08)

**Površine:** `workday-timer-service.ts`, `workday-my-day.ts`, contracts `WorkdayTimerInput`, timer route i DB overlap trigger.

**Cilj:** stari OPEN ne blokira novi datum; akcija cilja konkretan segment/dan; sve četiri timer akcije su idempotentne po `localId`; live timer van ±5 min se odbija; offline `startedAt` čuva event time, `deviceSentAt` se poredi sa serverom samo radi review flaga; ručni historijski unos ide kroz `workdays.revise` + audit bez live ±5 odbijanja; overlap SQL greška ima ljudski odgovor.

**Gate:** stari OPEN + novi dan; pause/finish nad prethodnim danom; retry za sve četiri akcije i isti ključ s drugim action/payload/datumom; paralelni start/overlap; live skew odbijen; offline event time očuvan, `deviceSentAt` skew flag; ručni historical entry audited; zaboravljeni dan se ne zatvara automatski; header verzija se mijenja na pravom danu.

### Korak D — Poravnati assignment, warning i vrstu dana (M3-05, M3-13)

**Površine:** `assignmentsForWorker`, timer/sync writers, `workday-review`/`weekView` read modeli, `setDayKind`, payroll/cost integration i web UI oznake.

**Cilj:** warning se računa za izabrani projekat i radni datum; izričito izabran neassigned projekat ostaje dozvoljen uz `assignment_warning` na dan/segment i uredski warning, bez pogađanja projekta. SYNC ne ostaje samo skriveni `review_flags`; odsustvo se ne može postaviti dok WORK/ledger nisu eksplicitno korigovani; `day_kind` koristi `workdays.revise`, a praznik se predlaže po specu.

**Gate:** dodjela A/rad na izabranom B → dozvoljen zapis + flag na dan/segment + uredski warning; bez projekta nema tihog pogađanja; istekla dodjela i TIMER/SYNC daju isti ishod. Absence se može postaviti samo prije confirm/booking nakon korekcije; nakon toga zaseban auditujući korektivni tok, LOCKED je nepromjenjiv; testirati ledger reconciliation/holiday suggestion.

**Correction subgate (M3-13):** optimistic `base_version` + razlog; pre-confirm absence ne prolazi dok nije izričito razriješen svaki aktivni WORK segment i nema `WORKDAY` cost source-a sa statusom različitim od `REVERSED` (`POSTED` ili `PENDING`). Post-booking tok veže correction ID za izvorni dan/segmente/knjižbe i stornira/zamjenjuje project cost bez prepisivanja originala; zatvoren obračun ide kroz zasebni M6 `pay_corrections`. LOCKED izvor ostaje nepromijenjen; ne koristiti postojeći generički `workday_revisions.payload` kao dokaz primjene. Potvrditi status dozvoljen za korekciju potvrđenog ali nezaključanog dana.

**Holiday subgate:** per-company lookup po `businessDate(startedAt, company.timezone)` i tačnom `holiday_date`; odgovor vraća suggestion, ne postavlja `day_kind`. Testirati firmni datum oko ponoći, `is_working=true` (radni/preneseni datum, ne odsustvo), neradni praznik kao prijedlog `HOLIDAY`, eksplicitni `WORK` uz marker i tenant izolaciju.

### Korak E — Jedna računica sati, sedmice, roster i reviewed snapshot (M3-06, M3-07, M3-14, M3-15)

**Površine:** `packages/domain/src/workdays.ts`, `workday-timer-service.ts#loadDayBy/weekView`, `workday-week-actions.ts`, `work_week_approvals`, `/ured/radni-dani[/sedmica]`, CSV i project-cost writer.

**Cilj:** M3 read modeli/CSV sabiraju samo `WORK`; radne minute se sijeku po poslovnoj zoni na dnevnoj/sedmičnoj granici prije zaokruživanja WORK dijelova. Roster prati assignment historiju na datum rada; validan `weekStart` se normalizuje na ponedjeljak; APPROVE/REJECT se izvršavaju tek kad su svi dani potvrđeni ili eksplicitno razriješeni i čuvaju server snapshot iste slike; LOCK ne dopušta `SUBMITTED` dan.

**Gate:** BREAK ne ulazi u WORK-minute/CSV ni project cost; split prije per-slice rounding; ne-ponedjeljak se normalizuje prije GET/decide/lock; roster po historijskim dodjelama; svi dani potvrđeni/eksplicitno razriješeni prije APPROVE/REJECT; snapshot equality/hash; LOCK odbija svaki `SUBMITTED` dan.

**Snapshot subgate (M3-06):** versioned JSON s istim grid/CSV projekcijama, firmnim timezone/rounding/formula versionom i source IDs/versions; `GET` vraća server digest, a `decide` ga šalje nazad. Pod zajedničkim company+week write lockom koji koriste svi mutatori prikazanih izvora server ponovo računa digest; stale → 409 bez side effecta, match → upiši snapshot i odluku atomarno. Uključi `workdays.header_version`, `work_entries.version`, status/day_kind, open conflicts, roster/assignment i sume po projektu; nikad ne vjeruj klijentskim sumama. Probe: promjena entry/conflict/assignment/rounding između GET i POST, stale retry, concurrent writer, svaki REJECT/APPROVE snapshot i očuvanje ranijeg decision evidence.

### Korak F — Entity-aware sync konflikt lifecycle (M3-09)

**Površine:** `r4-sync-service.ts`, specijalizirani `r4-sync-*` handleri, `workday-resolve.ts`, conflict API/UI, migracije i scope helperi.

**Cilj:** M3 obrađuje `workday`/`work_entry`; M5/M10 vlasnici određuju scope i daju tipizirane resolvere za svoje entitete. Svaki novi konflikt dobija puni entity key; web lista filtrira i prikazuje tip; ne-work-entry payload ne prolazi kroz time-only editor.

**Gate:** M3 pokriva scenarije za workday/work_entry; M5/M10 daju po jedan acceptance scenario za svoje entity tipove. Zajednički dokaz pokriva svih sedam tipova, tenant/scope, idempotentni repeat, audit/change-log, notification i rollback nevažeće odluke.

**Koordinacija:** M5/M10 vlasnici vode typed resolver/API odluke za svoje entitete; M3 zadržava workday/work_entry tok i zajednički conflict lifecycle/UI.

### Korak G — Provenance i retencija (M3-10, M3-11)

**Površine:** sync contracts/writers, `work_entries.segment_source`/`tz_offset_minutes`, `sync_receipts`, `sync_conflicts`, `sync-purge.ts`, worker schedule, DB guardovi i uska purge funkcija za receipt ACL.

**Cilj:** SYNC/timer/uredski izvori su tačni; offset ne nestaje; `sync_receipts.result` i conflict payload koriste isti per-company retention (`sync_conflict_retention_days`) čak i za neaktivne firme; po isteku ostaje minimalni replay key/hash trajno; nema širokog direktnog UPDATE granta na receipts.

**Gate:** source/offset roundtrip; OPEN conflict ostaje; receipt/conflict detalji čiste se po istom company roku i za neaktivne firme; minimalni replay key/hash opstaje poslije expiry; testirati tenant-safe cleanup, idempotentni retry, više firmi/RLS i zabranu direktnog receipt UPDATE-a.

**Receipt subgate (M3-11):** expiry se snima na INSERT-u po `sync_conflict_retention_days` (receipt od `created_at`, conflict od `resolved_at`); legacy backfill je konzervativan i ne skraćuje postojeći rok bez vlasničke odluke. Namjenska SECURITY DEFINER batch funkcija provjerava `app.company_id`, koristi `SKIP LOCKED`, vraća samo count i zove se po tenant transakciji. Novi ID-only worker lookup uključuje i neaktivne firme; active-only helper ostaje nepromijenjen. DB preflight/test potvrđuje `EXECUTE` least-privilege, no direct receipt UPDATE/DELETE, expired-only purge, retained hash i no cross-tenant purge.

## 3. Budući dokazi i završni pregled

Tek nakon kodne fraze i implementacije pokrenuti odobrene unit/integration/UI testove, typecheck, lint, build, DB migracijski preflight i odgovarajuće tenant/race provjere. Rezultat bilježiti kao stvarni ishod komande s datumom; fajl testa ili migracije nije rezultat. E2E/pilot/deploy/owner live review su zasebni dokazi i ne izvode se iz CI.

Preporučeni ankeri za naknadnu provjeru: `phase3.integration.test.ts`; `workday-review.integration.test.ts`; `workday-approval.integration.test.ts` i `workday-approval-gates.integration.test.ts`; `workday-resolve.integration.test.ts`/`workday-resolve-pull.integration.test.ts`; `sync-workday-scope.integration.test.ts`; DB `r4-workday.integration.test.ts`/`sync-cursor.integration.test.ts`; worker `sync-purge.integration.test.ts`; UI `week-client.test.ts`, `review-label.test.ts`, `conflict-detail-client.test.tsx`. Trenutno nisu pokretani.

Mobilni kod/UI/test nije u planu. Ako buduće promjene zajedničkog ugovora traže mobilnu kompatibilnost, staje se i traži vlasnički dogovor o zasebnom opsegu; ne podrazumijeva se mobilni rad.

## 4. Zavisnosti, rizici i stajanje

- M3-01 R3 scope, M3-02 self-approval/single-bulk parity i atomic cost booking su vlasnički potvrđeni, ali server-side enforcement i testovi ostaju prije UI polish-a i iza kodne kapije.
- M3-06/M3-07 utiču na M7 obračun; održati jedan algoritam ili dokumentovati odobren adapter, ne dvije divergentne računice.
- M3-09 uključuje R4 payload/DB/worker i M5/M10 typed handlere; per-entity scope, compat i historijski nullable redovi moraju biti dogovoreni prije migracije.
- M3-11 isti company rok, trajni minimalni replay key/hash i purge neaktivnih firmi su potvrđeni; DB/ACL cleanup put ostaje za dizajn. Ne zaobilaziti immutability, RLS ili no-delete grant.
- Statički nalaz, unit test ili CI ne dokazuju deploy, migraciju na živu bazu, stvarnu push isporuku ni vlasnikov pregled.

**Trenutna faza ostaje audit.** Nijedan korak iz ovog plana nije započet u poslovnom kodu.
