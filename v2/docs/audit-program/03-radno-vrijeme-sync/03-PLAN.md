# Modul 3 — Radno vrijeme, terenski unos i sync: plan nakon trijaže

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [02-DIZAJN.md](02-DIZAJN.md), [specifikacija 03](../../specs/03-radno-vrijeme-sync.md).

**Status:** fazni prijedlog ažuriran djelimičnom vlasničkom trijažom 2026-11-27; nijedna stavka nije odobrena za implementaciju.

## 1. Kapije prije rada

1. Vlasnik potvrđuje konačnu dispoziciju i težinu svakog M3 nalaza; ciljne politike M3-01/02/04/05/06/07/09/11/12/13/14/15 zapisane su 2026-11-27, ali ne potvrđuju nalaze, S0 ni runtime stanje.
2. Vlasničke politike su potvrđene: M3-02 OPEN conflict dopušta sync submit, ali blokira confirm/booking; M3-06 traži eksplicitnu dispoziciju svakog dana, strict `409 REVIEW_STALE` i append-only odluke; M3-11 backfill ne skraćuje expiry; M3-13 potvrđen ali nezaključan dan koristi zaseban correction record bez izmjene izvora i s project-cost storno/zamjenom. Tehnički dizajn još mora definirati M3-02 scope/race enforcement; M3-06 schema/canonical digest/source lock/history store; M3-11 tenant-safe ACL i all-company ID lookup; M3-13 correction schema/link/idempotency i holiday marker/history. M6 potvrđuje payroll interfejs; M5/M10 preuzimaju svoje entity resolvere/scope.
3. Ažurira se dizajn i acceptance kriteriji bez izmjene zaključane specifikacije; ako je potrebna promjena pravila, staje se do vlasničke odluke.
4. Poslovni kod ostaje netaknut do **`KREĆEMO U KODIRANJE: 3`**. Ovaj plan sam po sebi nije odobrenje.

## 2. Predloženi redoslijed rada

### Korak A — Ujednačiti efektivni scope i dozvole (M3-01)

**Površine:** `workday-review.ts`, `workday-timer-service.ts`, `workday-approval.ts`, `workday-week-actions.ts`, `workdays/*` API rute i njihove UI pozivne putanje.

**Cilj:** koristiti jedan server-side role ∩ session ∩ R3 assignment predicate za sedmični read, vrstu dana, grupnu potvrdu, odluku/lock i conflict list/detail. PROJECT_MANAGER ostaje samo u R3 assignment scopeu i kad session ima `scope=COMPANY`; firmni pregled pripada eksplicitno firmno ovlaštenim rolama.

**Gate:** PROJECT_MANAGER sa firmnim session-scopeom i dalje dobija samo R3; firmne role ostaju po izričitoj dozvoli; pozitivni/negativni company/project/self probeovi dokazuju da `setDayKind`, decide, lock, group confirmation i conflict read/mutacije ne šire scope. Sedmični odlučilac ne može odobriti vlastiti obračun.

### Korak B — Zatvoriti self-confirm i grupni tok (M3-02)

**Površine:** `workday-approval.ts`, `workday-timer-service.ts#bulkConfirm`, API rute confirm/confirm-bulk i statusni UI.

**Cilj:** isti role ∩ session ∩ R3 scope predicate/readiness gateovi za single/bulk, zabrana `viewerWorkerId === worker_id` i sedmičnog samoodobravanja; `workdays.status=SUBMITTED` i week-status/OPEN conflict/segment parity; uspješan pojedinačni/grupni confirm knjiži `bookWorkdayCost()` u istoj transakciji, audit rezultat odgovara potvrđenim danima.

**Gate:** single/bulk imaju iste server-side readiness gateove; vlastiti dan, DRAFT (uključujući default `approval_status=SUBMITTED`), OPEN segment, OPEN `work_entry` i `workday` entity-conflict (uključujući konflikt bez `work_entry_id`), nevažeće week stanje i radnik izvan R3 ostaju nepromijenjeni; testirati `scope=COMPANY` SITE_SUPERVISOR bez dodjele na izabrani projekat, miješani project day, invalid `workDate` → 400 i paralelne confirm zahtjeve; sedmični actor ne odobrava vlastite sate; uspješan confirm + trošak je atomski, odbijeni poziv nema knjiženje/audit side-effecta.

**Sync subgate / policy potvrđen:** `workday` i `work_entry` koriste isti `syncGateForWorkDate()` gate: `LOCKED` reject, `WEEK_APPROVED` conflict, bez `approval_status` potvrde i bez cost booking side-effecta. OPEN conflict **ne** blokira sync `DRAFT → SUBMITTED`, ali blokira kasniji confirm/booking. Testirati oba sync tipa, week gate, replay i nepromijenjeno stanje kod odbijenog push-a.

### Korak C — Opraviti timer datum/segment lifecycle (M3-03, M3-04, M3-08)

**Površine:** `workday-timer-service.ts`, `workday-my-day.ts`, contracts `WorkdayTimerInput`, timer route i DB overlap trigger.

**Cilj:** stari OPEN ne blokira novi datum; akcija cilja konkretan segment/dan; sve četiri timer akcije su idempotentne po `localId`; live timer van ±5 min se odbija; offline `startedAt` čuva event time, `deviceSentAt` se poredi sa serverom samo radi review flaga; ručni historijski unos ide kroz `workdays.revise` + audit bez live ±5 odbijanja; overlap SQL greška ima ljudski odgovor.

**Gate:** stari OPEN + novi dan; pause/finish nad prethodnim danom; retry za sve četiri akcije i isti ključ s drugim action/payload/datumom; paralelni start/overlap; live skew odbijen; offline event time očuvan, `deviceSentAt` skew flag; ručni historical entry audited; zaboravljeni dan se ne zatvara automatski; header verzija se mijenja na pravom danu.

### Korak D — Poravnati assignment, warning i vrstu dana (M3-05, M3-13)

**Površine:** `assignmentsForWorker`, timer/sync writers, `workday-review`/`weekView` read modeli, `setDayKind`, payroll/cost integration i web UI oznake.

**Cilj:** warning se računa za izabrani projekat i radni datum; izričito izabran neassigned projekat ostaje dozvoljen uz `assignment_warning` na dan/segment i uredski warning, bez pogađanja projekta. SYNC ne ostaje samo skriveni `review_flags`; odsustvo se ne može postaviti dok WORK/ledger nisu eksplicitno korigovani; `day_kind` koristi `workdays.revise`, a praznik se predlaže po specu.

**Gate:** dodjela A/rad na izabranom B → dozvoljen zapis + flag na dan/segment + uredski warning; bez projekta nema tihog pogađanja; istekla dodjela i TIMER/SYNC daju isti ishod. Absence se može postaviti samo prije confirm/booking nakon korekcije; nakon toga zaseban auditujući korektivni tok, LOCKED je nepromjenjiv; testirati ledger reconciliation/holiday suggestion.

**Correction subgate (M3-13):** optimistic `base_version` + razlog; pre-confirm absence ne prolazi dok nije izričito razriješen svaki aktivni WORK segment i nema `WORKDAY` cost source-a sa statusom različitim od `REVERSED` (`POSTED` ili `PENDING`). Za potvrđen ali nezaključan izvor vlasnik je odabrao zaseban append-only correction record: izvorni workday/segmenti ostaju neizmijenjeni, record veže korekciju za izvor/segmente/knjižbe i project cost se stornira/zamjenjuje bez prepisivanja originala; zatvoren obračun ide kroz zasebni M6 `pay_corrections`. LOCKED izvor ostaje nepromijenjen i ne otključava se. Ne koristiti postojeći generički `workday_revisions.payload` kao dokaz primjene; record schema/link/idempotency ostaju za tehnički dizajn.

**Holiday subgate:** per-company lookup po `businessDate(startedAt, company.timezone)` i tačnom `holiday_date`; odgovor vraća suggestion, ne postavlja `day_kind`. Testirati firmni datum oko ponoći, `is_working=true` (radni/preneseni datum, ne odsustvo), neradni praznik kao prijedlog `HOLIDAY`, eksplicitni `WORK` uz marker i tenant izolaciju.

### Korak E — Jedna računica sati, sedmice, roster i reviewed snapshot (M3-06, M3-07, M3-14, M3-15)

**Površine:** `packages/domain/src/workdays.ts`, `workday-timer-service.ts#loadDayBy/weekView`, `workday-week-actions.ts`, `work_week_approvals`, `WeekDecideInput`, `/api/work-weeks/decide`, `/ured/radni-dani[/sedmica]` decision/grid UI, CSV i project-cost writer.

**Cilj:** M3 read modeli/CSV sabiraju samo `WORK`; radne minute se sijeku po poslovnoj zoni na dnevnoj/sedmičnoj granici prije zaokruživanja WORK dijelova. Roster prati assignment historiju na datum rada; validan `weekStart` se normalizuje na ponedjeljak; APPROVE/REJECT se izvršavaju tek kad svaki radnik-dan ima eksplicitnu dispoziciju i čuvaju append-only server snapshot iste slike; LOCK ne dopušta `SUBMITTED` dan.

**Gate:** BREAK ne ulazi u WORK-minute/CSV ni project cost; split prije per-slice rounding; ne-ponedjeljak se normalizuje prije GET/decide/lock; roster po historijskim dodjelama; nijedan prazan/nepostojeći dan nije implicitno razriješen; stale digest vraća `409 REVIEW_STALE` bez side-effecta i traži novi pregled; svaki REJECT/re-review/APPROVE ima append-only dokaz; LOCK odbija svaki `SUBMITTED` dan.

**Snapshot subgate (M3-06):** versioned JSON s istim grid/CSV projekcijama, firmnim timezone/rounding/formula versionom i source IDs/versions; `GET` vraća server digest, a `decide` ga šalje nazad. Pod zajedničkim company+week write lockom koji koriste svi mutatori prikazanih izvora server ponovo računa digest; stale → 409 bez side effecta, match + eksplicitna dispozicija svakog dana → upiši snapshot i odluku atomarno. Uključi `workdays.header_version`, `work_entries.version`, status/day_kind, open conflicts, roster/assignment i sume po projektu; nikad ne vjeruj klijentskim sumama. Probe: promjena entry/conflict/assignment/rounding između GET i POST, stale retry, concurrent writer, svaki REJECT/APPROVE snapshot i očuvanje ranijeg decision evidence.

### Korak F — Entity-aware sync konflikt lifecycle (M3-09)

**Površine:** `r4-sync-service.ts`, specijalizirani `r4-sync-*` handleri, `workday-resolve.ts`, conflict API/UI, migracije i scope helperi.

**Cilj:** M3 obrađuje `workday`/`work_entry`; M5/M10 vlasnici određuju scope i daju tipizirane resolvere za svoje entitete. Svaki novi konflikt dobija puni entity key; web lista filtrira i prikazuje tip; ne-work-entry payload ne prolazi kroz time-only editor.

**Gate:** M3 pokriva scenarije za workday/work_entry; M5/M10 daju po jedan acceptance scenario za svoje entity tipove. Zajednički dokaz pokriva svih sedam tipova, tenant/scope, idempotentni repeat, audit/change-log, notification i rollback nevažeće odluke.

**Koordinacija:** M5/M10 vlasnici vode typed resolver/API odluke za svoje entitete; M3 zadržava workday/work_entry tok i zajednički conflict lifecycle/UI.

### Korak G — Provenance i retencija (M3-10, M3-11)

**Površine:** sync contracts/writers, `work_entries.segment_source`/`tz_offset_minutes`, `sync_receipts`, `sync_conflicts`, `sync-purge.ts`, worker schedule, DB guardovi i uska purge funkcija za receipt ACL.

**Cilj:** SYNC/timer/uredski izvori su tačni; offset ne nestaje; `sync_receipts.result` i conflict payload koriste isti per-company retention (`sync_conflict_retention_days`) čak i za neaktivne firme; po isteku ostaje minimalni replay key/hash trajno; nema širokog direktnog UPDATE granta na receipts.

**Gate:** source/offset roundtrip; OPEN conflict ostaje; receipt/conflict detalji čiste se po istom company roku i za neaktivne firme; minimalni replay key/hash opstaje poslije expiry; testirati tenant-safe cleanup, idempotentni retry, više firmi/RLS i zabranu direktnog receipt UPDATE-a.

**Receipt subgate (M3-11):** expiry se snima na INSERT-u po `sync_conflict_retention_days` (receipt od `created_at`, conflict od `resolved_at`); legacy backfill koristi vlasnički potvrđeni `GREATEST(stari result_expires_at, created_at + novi per-company rok)` i ne skraćuje postojeći rok. Namjenska SECURITY DEFINER batch funkcija provjerava `app.company_id`, koristi `SKIP LOCKED`, vraća samo count i zove se po tenant transakciji. Novi ID-only worker lookup uključuje i neaktivne firme; active-only helper ostaje nepromijenjen. DB preflight/test potvrđuje `EXECUTE` least-privilege, no direct receipt UPDATE/DELETE, expired-only purge, retained hash i no cross-tenant purge.

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
