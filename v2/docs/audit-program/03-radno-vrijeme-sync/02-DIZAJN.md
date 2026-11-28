# Modul 3 — Radno vrijeme, terenski unos i sync: ciljni dizajn

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [zaključana specifikacija 03](../../specs/03-radno-vrijeme-sync.md), [PRAVILA.md](../PRAVILA.md).

**Status:** ciljna pravila su djelimično vlasnički potvrđena 2026-11-27; preostale politike i tehničke semantike ostaju otvorene, nije odobren za kodiranje. Specifikacija 03 se ne mijenja.

## 1. Cilj i granice

Jedan dosljedan web/API ugovor za radni dan, sedmičnu potvrdu i offline sync: isti firmni poslovni datum, isti obračun segmenta, iste role/scope odluke, vidljiva upozorenja i razrješivi sync konflikti. Ovaj dizajn se odnosi na `apps/web`, potrebne zajedničke pakete, migracije i worker. Mobilna aplikacija se ne dizajnira, mijenja niti testira. Svaka buduća promjena zajedničkog ugovora mora ostati kompatibilna i zahtijeva zasebno odobrenje ako bi tražila mobilni rad.

Nijedan prijedlog ne opravdava izmjenu zaključanog briefa/speca, izmjenu poslovnog koda ili promjenu DB politike prije vlasničke odluke i fraze **`KREĆEMO U KODIRANJE: 3`**.

## 2. Vlasnički potvrđena pravila i preostale tehničke semantike

1. **Efektivni opseg — potvrđeno 2026-11-27:** PROJECT_MANAGER sedmični pregled/odluka/zaključavanje ograničeni su na R3 assignment scope, i kad je session scope `COMPANY`; firmni pregled ostaje rolama s eksplicitnim firmnim ovlaštenjem (pregledani permission model: OWNER/ADMIN/ACCOUNTANT).
2. **Potvrda/grupni/sync gate — policy potvrđen 2026-11-27:** zabraniti samopotvrdu/samoodobravanje i u sedmičnom APPROVE/REJECT; single/bulk traže `workdays.status=SUBMITTED` i iste week-status, OPEN conflict i OPEN segment provjere; uspješan pojedinačni/grupni confirm knjiži trošak u istoj transakciji. Sync nije approval: `LOCKED` se odbija, `WEEK_APPROVED` vraća conflict za `workday` i `work_entry`; OPEN conflict ne blokira sam sync `DRAFT → SUBMITTED`, ali blokira kasniji confirm/booking. Enforcement/race test ostaju otvoreni.
3. **Vremenska plausibilnost — potvrđeno 2026-11-27:** live timer van ±5 min se odbija; offline `startedAt` ostaje event time, `deviceSentAt` se poredi sa serverom samo za review flag; ručni historijski unos ide kroz `workdays.revise` + audit bez live ±5 odbijanja. UTC/offset se čuvaju po specifikaciji.
4. **Dodjela — potvrđeno 2026-11-27:** rad na izričito izabranom projektu bez važeće dodjele prolazi uz `assignment_warning` na dan/segment i vidljiv uredski warning; projekat se ne pogađa ako nije izabran. TIMER/SYNC/read-model implementacija ostaje za provjeru.
5. **Sedmična odluka — policy potvrđen 2026-11-27:** svaki radnik-dan u opsegu mora imati eksplicitnu dispoziciju; prazna ćelija/nepostojeći dan nije automatsko razrješenje. Digest mismatch vraća `409 REVIEW_STALE` bez side-effecta i traži novi pregled. Svaki REJECT, ponovni pregled i APPROVE čuva append-only dokaz; ne prepisivati raniju odluku/snapshot. LOCK ne dopušta `SUBMITTED`. JSON/schema, potpuni source version set i zajednički race-lock ostaju za dizajn.
6. **Granice vremena — potvrđeno 2026-11-27:** WORK intervali se po poslovnoj zoni firme sijeku na ponoći i granici sedmice prije zaokruživanja WORK dijelova; koristi se postojeće firmno `rounding_minutes`/`rounding_mode` i spec per-segment pravilo.
7. **Entity konflikt — potvrđeno 2026-11-27:** M3 je odgovoran za `workday`/`work_entry`; vlasnici M5/M10 određuju scope i daju tipizirane resolvere za mašinu, gorivo, turu, provjeru i kvar. Per-entity API/ownership handoff se usklađuje s tim modulima.
8. **Retencija — policy potvrđen 2026-11-27:** receipt result i resolved conflict payload slijede isti per-company `sync_conflict_retention_days`; detaljni rezultat/payload se brišu po isteku, minimalni replay key/hash ostaje trajno, purge uključuje neaktivne firme, a legacy backfill koristi `GREATEST(stari result_expires_at, created_at + per-company rok)` i ne skraćuje rok. Tenant-safe cleanup/ACL put ostaje za tehnički dizajn.
9. **Timer idempotency — potvrđeno 2026-11-27:** `localId` pokriva start/pause/resume/finish; identičan retry vraća isti ishod, a isti ključ uz drugi action/payload/datum vraća konflikt bez upisa.
10. **Vrsta dana — policy potvrđen 2026-11-27:** pre-confirm absence traži eksplicitnu WORK/ledger korekciju. Za potvrđen ali nezaključan dan korekcija je zaseban auditujući correction record; izvorni workday/segmenti ostaju neizmijenjeni, a project cost se stornira/zamjenjuje. LOCKED ostaje nepromjenjiv; dozvola je `workdays.revise`. Record schema/link/idempotency ostaju za dizajn; praznik se predlaže po §1.3.15.
11. **Sedmični datum/roster — potvrđeno 2026-11-27:** roster prati assignment historiju na datume rada; validan `weekStart` se normalizuje na ponedjeljak za GET/decide/lock; podrazumijevana sedmica se računa u poslovnoj zoni firme.
12. **Pauze — potvrđeno za M3 2026-11-27:** dnevni/sedmični read modeli i CSV sabiraju samo `WORK`; M6 zasebno odlučuje da li plaćena pauza utiče na obračun, ali ne na projektni radni interval/trošak.

Ove odluke opisuju ciljni policy, ne potvrđuju ponašanje postojećeg koda. Dok se preostala pitanja ne razriješe, ne uvodi se nova semantika, migracija ni UI obrazac.

## 3. Ciljne invarijante nakon odobrenja

### 3.1 Jedan efektivni role/scope ugovor

- Zajednički server-side scope derivira se iz **role ∩ session scope ∩ assignment history**; UI i `workerIds` iz queryja nisu sigurnosna granica.
- Isti helper/predikat koriste week view, detail/list, vrsta dana, grupna potvrda, odluke/zaključavanje sedmice i M3 conflict list/detail/resolve.
- **Vlasnička odluka (2026-11-27):** PROJECT_MANAGER sedmični pregled/odluka/zaključavanje ostaju unutar R3 assignment scopea i ne postaju firmni zbog `scope=COMPANY`; firmni pregled ostaje rolama s izričitom firmnom ovlasti (u pregledanom permission modelu: OWNER/ADMIN/ACCOUNTANT). Ne miješati firmni pregled s assignment-only listom.
- Single/bulk confirmation i sedmični APPROVE/REJECT provjeravaju R3/scope i zabranjuju samopotvrdu/samoodobravanje; single/bulk traže `workdays.status=SUBMITTED` i iste week-status/OPEN conflict/OPEN segment gateove. Uspješan pojedinačni/grupni confirm knjiži projektni trošak u istoj transakciji; neuspješan/odbijen confirm ne knjiži. Sync ostaje ingest/submit, ne approval: `LOCKED` reject i `WEEK_APPROVED` conflict važe za oba item tipa; OPEN conflict ne blokira samo submit, ali blokira kasniji confirm/booking.

#### M3-02 — granica sync submit / approval (tehnički prijedlog)

Sync `work_entry` je ingest unosa; sync `workday` je predaja dana (`status: DRAFT → SUBMITTED`), ne potvrda niti sedmično odobrenje. Nijedan sync item ne smije postaviti `approval_status=FOREMAN_CONFIRMED/LOCKED` niti pozvati `bookWorkdayCost()`. Predloženi zajednički write gate za oba item tipa: ponovo koristiti `syncGateForWorkDate()`; izračunati datum u zoni firme; `LOCKED` odbiti, `WEEK_APPROVED` vratiti typed version conflict; status/version mismatch ostavlja sve kanonske redove nepromijenjene. `workday` submit i dalje traži očekivani `header_version`, `status='DRAFT'` i zatvoren aktivni segment.

Single/bulk confirm ostaju jedina tačka koja provodi self-approval, `workdays.status=SUBMITTED`, week status, OPEN conflict/segment i atomsko troškovno knjiženje. **Vlasnik je potvrdio 2026-11-27:** OPEN conflict ne blokira sync `DRAFT → SUBMITTED` (ured treba dobiti predmet za razrješenje), ali mora zaustaviti kasniji confirm/booking dok se ne riješi. Kod ostaje iza `KREĆEMO U KODIRANJE: 3`; za oba sync tipa još treba implementirati i testirati `LOCKED/WEEK_APPROVED` gate parity.

### 3.2 Timer, stari dan i upozorenja

- Za `start` se provjerava stanje **današnjeg kanonskog workdaya**; stariji OPEN ostaje vidljiv kroz `forgotten`, ali ne blokira novi dan niti se tiho zatvara.
- `pause`, `resume`, `finish` i zatvaranje zaboravljenog dana eksplicitno ciljaju odgovarajući segment/dan. Ne mijenjati dane iz drugih datuma kao nuspojavu akcije za danas.
- **Vlasnička odluka (2026-11-27):** `localId` pokriva svaku timersku akciju; identičan retry vraća isti ishod bez ponovne promjene, a isti ključ s drugim action/payloadom/datumom dobija eksplicitan konflikt bez dodatnog side effecta.
- **Vlasnička odluka (2026-11-27):** live timer izvan ±5 minuta se odbija; offline `startedAt` ostaje autoritativni event time, a `deviceSentAt` se poredi sa serverom samo za review flag. Ručni historijski unos ide kroz `workdays.revise` i audit, bez live ±5 odbijanja. UTC instant/offset se čuvaju; sync implementacija slijedi ovaj clock-source ugovor.
- **Vlasnička odluka (2026-11-27):** promjenu u odsustvo dozvoliti samo prije confirm/booking i nakon eksplicitne WORK/ledger korekcije; potvrđen ali nezaključan dan ispravlja se zasebnim auditujućim correction recordom, bez izmjene izvornog workdaya/segmenata, uz project-cost storno/zamjenu. LOCKED ostaje nepromjenjiv i ne otključava se. `day_kind` koristi `workdays.revise`; ne sakrivati niti tiho brisati segmente/trošak. Record schema/link/idempotency ostaju za dizajn; praznik se predlaže po §1.3.15, a rad ostaje `WORK`.
- **Vlasnička odluka (2026-11-27):** M3 dnevni/sedmični zbir i CSV sabiraju samo zatvorene `WORK` intervale; `BREAK` ne ulazi u radne minute ni projektni trošak. Eventualni obračun plaćene pauze pripada zasebnoj M6 odluci.
- **Vlasnička odluka (2026-11-27):** assignment provjera koristi izabrani `projectId` i `workDate`, ne boolean „postoji bilo koja dodjela“. Izričito odabran neassigned projekat prolazi uz `assignment_warning` na dan/segment i vidljiv uredski warning; ako projekat nije izabran, sistem ga ne pogađa. TIMER/SYNC moraju koristiti isti kriterij.
- `UNKNOWN_END`, skew, inactive/out-of-date assignment i drugi review flagovi moraju imati odobreno, vidljivo stanje; upozorenje ne smije se pretvoriti u tihu blokadu.
- Preklapanje se prevodi iz DB conflict u stabilan poslovni rezultat s postojećim i novim intervalom; SQLSTATE se ne šalje korisniku. Dug segment bez pauze dobija upozorenje prema vlasnički potvrđenom pragu.

#### M3-13 — korekcija WORK/ledger i holiday suggestion (tehnički prijedlog)

**Prije potvrde/knjiženja:** `workdays.revise` treba dobiti tipiziran correction payload s `base_version`, razlogom, ciljnom vrstom dana i eksplicitnim dispositionom svakog pogođenog WORK segmenta. U tenant transakciji zaključati dan/segmente i provjeriti status sedmice, da nema OPEN segmenta/sukoba ni postojećeg `WORKDAY` cost source-a sa statusom različitim od `REVERSED` (`POSTED` ili `PENDING`). Bez izmjene/poništenja svih postojećih WORK redova ne smije se postaviti odsustvo; revision, promjene segmenata, `day_kind`, header version i audit se primjenjuju atomarno. Ne brisati segmente niti se osloniti samo na to da read model odsustva prikazuje nula minuta.

**Nakon confirm/booking:** ne koristiti direktni `setDayKind()` kao prečicu. Vlasnik je potvrdio da i potvrđen ali nezaključan izvor ostaje neizmijenjen: otvara se zaseban, auditujući correction record koji veže izvorni workday, konkretne entry-e, razlog/autor i originalne troškovne redove. Projektni `cost_entries` ostaje append-only: korekcija koristi storno i po potrebi zamjensko knjiženje s novim korekcijskim source ID-jem; `bookWorkdayCost()` sam po sebi neće ponovo izračunati već korišteni `${workdayId}:${projectId}` source. M6 `pay_corrections`/obračun je odvojeni payroll tok, nije zamjena za project-cost storno.

**LOCKED:** ne mijenjati originalni `workdays`/`work_entries` ni sedmični status. Korekcija se čuva kao zaseban append-only, vidljiv trag; eventualni projektni ledger/payroll efekti idu kroz odgovarajuće korektivne zapise, bez „otključavanja“. `workday_revisions` trenutno ima generički JSONB i nema workflow status; zaseban correction record za potvrđeni dan je policy, dok njegovo table/schema/foreign-key/idempotency/audit povezivanje ostaje tehnički dizajn. Trenutni `pay_corrections` ne dokazuje niti implementira cijeli M3 correction workflow.

**Holiday lookup:** poslije izračuna `workDate` u poslovnoj zoni firme, server radi tenant-scopovani exact match `company_holidays(company_id, holiday_date)` i vraća suggestion, bez automatskog mijenjanja `day_kind`. `is_working=true` znači preneseni radni dan i ne smije se ponuditi kao odsustvo; za neradni praznik predložiti `HOLIDAY`, a rad tog dana ostaje eksplicitni `WORK` sa prazničnim markerom za M6. `is_paid` je zaseban payroll podatak. Ne koristiti UTC godinu/datum klijenta; historijsko snapshotovanje izmjena prazničnog registra i format markera ostaju M6/owner interfejs pitanja.

### 3.3 Jedna računica dnevnih/sedmičnih sati i dokaz odluke

- **Vlasnička odluka (2026-11-27):** jedan domenski helper prvo razdvaja `WORK` od `BREAK`, zatim reže `WORK` intervale po poslovnoj zoni firme na dnevne/sedmične sliceove, pa zaokružuje svaki WORK dio po postojećem firmnom rounding pravilu. Ne duplirati algoritam u sedmičnom UI-ju i obračunu M7.
- Sedmični pregled prikazuje radnik × dan, status/vrstu dana, zbir po radniku i po projektu, otvorene konflikte i CSV iz iste učitane slike. Podrazumijevani datum izvodi se u poslovnoj zoni firme; svaki validan ulazni `weekStart` se normalizuje na ponedjeljak prije GET/decide/lock. Roster prati assignment historiju u izabranom rasponu. Specifikacijski `/api/workdays/week/export` ostaje pitanje vlasničke odluke ako se zadrži client-side export.
- **Vlasnička odluka (2026-11-27):** APPROVE i REJECT oba čuvaju serverom izračunat `reviewed_snapshot`; svaki radnik-dan u opsegu mora imati eksplicitnu dispoziciju, a prazna ćelija/nepostojeći `workday` nije automatsko razrješenje. Ako izvor promijeni digest nakon prikaza, server vraća `409 REVIEW_STALE` bez odluke/side-effecta i traži novi pregled. Svaki REJECT, ponovni pregled i APPROVE čuva append-only dokaz; raniji decision evidence se ne prepisuje. Snapshot je server-authoritative, ne klijentski zbir.
- **Vlasnička odluka (2026-11-27):** `LOCKED` sedmica ne smije sadržavati `SUBMITTED` dan; odluka čeka da svaki dan bude potvrđen ili eksplicitno razriješen. Tačan per-day disposition set i njegov JSON/schema, digest serialization/versioning, potpuni source version set i zajednički write-lock ostaju acceptance/tehnički dizajn.

#### M3-06 — `reviewed_snapshot` schema i freshness (tehnički prijedlog)

Server generiše verzionisan JSON snapshot (`schema_version`, `week_start/end`, `reviewer_id`, `reviewed_at`, tenant/scope, poslovna zona, `rounding_minutes/mode`, formula version). `view` sadrži upravo prikazane i sortirane redove/ćelije/status/vrstu dana, WORK minute, sume po radniku/projektu, review oznake i aggregate konflikata; ne uključuje note ni sirovi conflict payload. `sources` čuva samo potrebne stabilne reference/verzije: workday ID + `header_version/status/approval_status/day_kind`; entry ID + `version/kind/timestamps/end_state/resolution_state/project_id`; OPEN conflict ID/status/hash; roster/assignment set i relevantne firmne postavke. SHA-256 se računa nad kanonskim JSON-u, a `reviewed_snapshot` ostaje server-authoritative, ne klijentski zbir.

`GET week` vraća `review_digest` iz istog server projection-a koji crta grid/CSV. `POST APPROVE/REJECT` šalje taj digest; server u tenant transakciji ponovo učitava/izračunava isti projection, primjenjuje jedan zajednički company+week serialization lock koji dijele svi writer-i prikazanih izvora (dani/segmenti/konflikti/assignment history/company postavke/praznici), te poredi digest prije statusa/side effecta. Mismatch vraća `409 REVIEW_STALE`, bez odluke/knjiženja; korisnik mora ponovo pregledati. Podudaranje i eksplicitna dispozicija svakog radnik-dana su preduvjeti; prazan dan/ćelija se ne smatra razriješenim samo zato što nema reda. Svaki REJECT, re-review i APPROVE upisuje append-only decision evidence sa snapshot/digestom, autorom i vremenom; ne prepisivati raniji dokaz. GET mora čitati dosljedan DB snapshot; sam `header_version` nije dovoljan jer su entry versioni i konflikt/roster/postavke zasebni izvori.

Preostali tehnički detalji: konačan enum/payload za per-day disposition, canonical JSON/schema/version/formula hash, potpuni skup versioniranih izvora, pokrivenost shared write-locka kroz sve writer-e i da li se `reviewed_snapshot` popunjava i na najnoviju approval row ili služi samo kao projekcija uz posebnu append-only decision tabelu. Nema snapshot UI/koda prije kodne kapije.

### 3.4 Entity-aware sync konflikti i retencija

- Svaki novi `sync_conflicts` red upisuje puni `(entity_type, entity_id)` za stvarni predmet konflikta; nullable ostaje samo kao migracijska kompatibilnost za stare redove.
- List/detail prikazuje tip i identitet, filter radi kroz web UI i API, a scope se računa nad mjerodavnim entitetom/projektom/radnikom, ne samo `work_entries` joinom.
- **Vlasnička odluka (2026-11-27):** M3 je odgovoran za `workday`/`work_entry`; M5/M10 vlasnici određuju scope i isporučuju tipizirane, transakcijske writer/validatore za svoje entitete. Time-only korekcija se ne prikazuje za mašinu, gorivo, turu, provjeru ili kvar; nepodržan konflikt ostaje otvoren, ne može se lažno zatvoriti generičkom akcijom.
- **Vlasnička odluka (2026-11-27):** `sync_receipts.result` i resolved conflict payload slijede isti per-company rok (`sync_conflict_retention_days`); po isteku se uklanja detaljni rezultat/payload, minimalni replay key/hash ostaje trajno, a purge se nastavlja i za neaktivne firme. Legacy receipt expiry se backfill-a kao `GREATEST(stari result_expires_at, created_at + novi per-company rok)`, bez skraćivanja; novi receipt-i koriste rok firme. `OPEN` konflikt ostaje za ured. Tačna tenant-safe SECURITY DEFINER/ACL granica ostaje za tehnički dizajn; nema širokog direktnog granta ni zaobilaženja RLS-a.

#### M3-11 — retention/ACL/purge put (tehnički prijedlog)

`result_expires_at` se postavlja pri INSERT-u kao `created_at + companies.sync_conflict_retention_days`; promjena postavke važi za nove receipts, dok već zapisan rok ostaje nepromjenjiv. Conflict payload rok ostaje računat od `resolved_at` po postojećem guardu. **Vlasnik je potvrdio** da legacy backfill koristi `GREATEST(stari result_expires_at, created_at + novi per-company rok)`, pa nijedan postojeći rok nije skraćen; potrebna je migration/trigger izmjena. Receipt id, actor, `local_id`, `request_hash` i red se nikad ne mijenjaju/brišu.

Predloženi `SECURITY DEFINER` batch entrypoint prima samo `company_id` i limit, postavlja fiksni `search_path`, provjerava `company_id = current_setting('app.company_id', true)`, uzima istekle `result IS NOT NULL` redove `FOR UPDATE SKIP LOCKED` i radi samo `SET result=NULL`; DB guard sam popunjava `result_purged_at`. Funkcija vraća samo broj, nikad payload, te ima `REVOKE ALL FROM PUBLIC` + samo nužni `EXECUTE TO gradix_app`; `sync_receipts` ostaje bez direktnog UPDATE/DELETE granta. Radni tenant posao zove je unutar `withCompany`; preflight provjerava owner/ACL/search_path/RLS.

Za neaktivne firme ne koristiti `listActiveCompanyIds()` niti mijenjati active-only ugovor drugih poslova. Dodati namjenski globalni lookup koji otkriva samo ID-jeve svih firmi (aktivnih i neaktivnih), a zatim za svaki ID otvarati izolovanu tenant transakciju. Batch + retry su idempotentni; postojeći dnevni `sync.purge` raspored može ostati. Acceptance mora pokriti: dvije firme, inactive, pogrešan tenant context, pred/poslije expiry, sačuvan ključ/hash, concurrent SKIP LOCKED i direct UPDATE denied.

- SYNC segment upisuje `segment_source='SYNC'` i odobreni offset. TIMER i prihvaćeni/ispravljeni unosi čuvaju tačno porijeklo bez prepisivanja historije.

## 4. Acceptance probe za buduću kodnu fazu

| Površina | Invarijanta za provjeru nakon zasebne kodne fraze |
|---|---|
| Scope | PROJECT_MANAGER s `scope=COMPANY` ostaje samo u odobrenom R3 assignment scopeu; firmni pregled ostaje eksplicitno firmno ovlaštenim rolama; `setDayKind`, bulk confirm, decide/lock i conflict detail ne šire scope. |
| Potvrda | Zabraniti samopotvrdu/samoodobravanje uključujući sedmični APPROVE/REJECT; single/bulk traže `SUBMITTED` i identične week-status/OPEN conflict/OPEN segment gateove; uspješan pojedinačni/grupni confirm i trošak su atomski. Sync `workday` submit dopušta OPEN conflict, ali confirm/booking ga blokira; oba sync tipa odbijaju `LOCKED` i vraćaju conflict za `WEEK_APPROVED`, bez potvrde/troška. Izvan-R3 i odbijeni pozivi ne mijenjaju status/trošak. |
| Stari OPEN | Jučerašnji otvoreni segment ostaje vidljiv; današnji `start` uspijeva; `pause`/`finish` ciljaju pravi dan; zatvaranje jučerašnjeg ne mijenja današnji header i obratno. |
| Timer retry | Ponovljeni `localId` za start/pause/resume/finish vraća isti rezultat bez druge promjene; isti ključ s drugim payloadom ne kreira dan/segment. |
| Vremena | Live timer van ±5 min se odbija; offline `startedAt` je event time, `deviceSentAt` se poredi sa serverom samo za review flag; ručni historijski unos ide kroz `workdays.revise` + audit bez live ±5 odbijanja. |
| Vrsta dana | Absence samo prije confirm/booking i nakon WORK/ledger korekcije; potvrđen ali nezaključan izvor ostaje neizmijenjen uz zaseban append-only auditujući correction record i project-cost storno/zamjenu; LOCKED nepromjenjiv, `workdays.revise`; praznici po §1.3.15. Provjeriti ledger reconciliation. |
| Dodjela/warnings | Izričito izabran neassigned projekat prolazi uz day/entry `assignment_warning` i vidljiv uredski warning; bez projekta sistem ne pogađa izbor; TIMER i SYNC daju isti rezultat. |
| Sati | BREAK ne ulazi u WORK-minute totals/CSV/project cost; rezati po poslovnoj zoni na dnevnoj/sedmičnoj granici prije zaokruživanja WORK dijelova; round modes i rubni slučajevi ostaju tačni. |
| Sedmica | APPROVE/REJECT tek kad svaki radnik-dan ima eksplicitnu dispoziciju (prazno nije razrješenje); digest mismatch vraća `409 REVIEW_STALE` bez side-effecta i traži novi pregled; svaki REJECT/re-review/APPROVE čuva append-only dokaz. LOCK odbija bilo koji `SUBMITTED`; roster je historijski, validan ne-ponedjeljak se normalizuje na ponedjeljak. |
| Konflikt | M3 rješava `workday`/`work_entry`; M5/M10 određuju scope i daju typed resolvere za druge entitete; key, tenant/scope, audit i odbijanje nevažeće odluke se testiraju po tipu. |
| Retencija/replay | Receipt result/resolved conflict detalji ističu po istom company roku, uključujući neaktivne firme; legacy expiry backfill ne skraćuje postojeći rok (`GREATEST(stari, created_at + firmni rok)`); minimalni replay key/hash ostaje trajno; OPEN se ne čisti. Receipt purge zahtijeva tenant-safe funkciju bez direktnog UPDATE ACL-a; job je idempotentan. |
| Tenant/grants | Firma B ne čita/mijenja A; `gradix_app` ostaje NOSUPERUSER/NOBYPASSRLS, ACL je najmanje potreban, RLS/grants preflight i stvarni DB test prolaze. |

Ovo su kriteriji prijedloga, ne dokaz da su probe pokrenute niti dozvola za implementaciju.

## 5. Ograničenja

- Ne mijenjati `v2/docs/specs/03-radno-vrijeme-sync.md`; svaka promjena pravila čeka zasebnu odluku vlasnika.
- Mobilni kod/UI/test nije predmet ovog audita ni dizajna. Prijedlozi za shared contracts ne predstavljaju ovlaštenje da se mijenja ili testira mobilna aplikacija.
- Dodavanje polja, resolvera ili scope helpera zahtijeva pregled migracija, DB grants/RLS i testnih race/tenant slučajeva u budućoj fazi.
- Za novi web vizuelni obrazac prije koda i dalje važe UI-odobrenje i katalog (`PRAVILA.md`).
- M2 dokumentacija ostaje zasebno spremna za vlasnički pregled, ne vlasnički zatvorena.

Ciljni dizajn je prijedlog. Kod počinje isključivo nakon potvrđene trijaže i **`KREĆEMO U KODIRANJE: 3`**.
