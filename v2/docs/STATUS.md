# STATUS — Gradix v2

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Faza 0–5: završene** · **CI: zelen.**

Realizacija ide po `docs/IMPLEMENTATION_PLAN.md` (odobren u cjelosti, strogi redoslijed).
Moduli 1–12 zaključani u `docs/specs/`. Sljedeće: **Faza 6** po `docs/IMPLEMENTATION_PLAN.md`. Izvještaji po fazama: `docs/IZVJESTAJ-FAZA-*.md`.

## Šta je gotovo

| Korak | Sadržaj | Stanje |
|---|---|---|
| 0 | Monorepo, TS strict, dvije DB role (`gradix_app` / vlasnik), FORCE RLS + `app.company_id`, `withCompany`, preflight, CI | ✅ |
| 0.1 | Prilozi objedinjeni u jednu `attachments` tabelu (entitet + vrsta), S3 potpisi, MIME provjera | ✅ |
| 0.2 | Stare attachment tabele uklonjene; matrix parity pokazuje na novu tabelu | ✅ |
| 0.3 | Matrica dozvola kao kod (`packages/domain`): akcija × rola × stanje reference; `SELF_APPROVAL_FORBIDDEN`; iznimke sa rokom i razlogom ≥10 znakova | ✅ |
| 0.4 | `apps/worker` na pg-boss-u + obavještenja (`notifications`, inbox, zvonce, `/ured/obavjestenja`), `/api/health` (bez baze) i `/api/health/queue` | ✅ |
| 0.5 | Higijena: OpenAPI iz `ROUTES` + CI provjera ažurnosti, preflight kao CI gate, `AGENTS.md` osvježen, `STATUS.md` | ✅ |
| 1.1 | Baza: zaglavlje firme, `company_holidays`, `user_sessions`/`user_devices`, `user_totp` + recovery kodovi, `platform_users`/`platform_sessions`, `report_jobs`, `daily_rollups`; audit klase i logovanje ČITANJA | ✅ |
| 1.2 | Domena: politika lozinki (10k crna lista, istorija 3, lock 10/15 min, rotacija 180 d za uredske role), TOTP (AES-256-GCM, replay zaštita), sesije, uređaji | ✅ |
| 1.3 | API: 2FA tok (obaveza za OWNER/ADMIN/ACCOUNTANT + uparivanje prije prve sesije), sesije i opoziv na daljinu, postavke firme i praznici, platforma (onboarding, suspend/activate, support pristup) | ✅ |
| 1.4 | UI: `/ured/postavke` (4 taba), `/ured/profil/sesije` (web) + `/uredjaji` (mobile), `/platform/firme` + onboarding čarobnjak | ✅ |
| 2.1 | Baza: `requires_review`/`sensitive`/`blocks_actions`, `review_at`/`reviewed_by`/`review_state`/`review_note`, `reminder_days`; trajna obaveza bez datuma provjere odbijena **odgođenim constraint triggerom**; `obligation_requirements`, `obligation_notify_roles` | ✅ |
| 2.2 | Domena: 9 stanja (`missing`…`superseded`), `BLOCKING_OBLIGATION_STATES`, `isBlockingState` nezavisno od radnje, dozvole `obligations.review`/`.attachments.manage` | ✅ |
| 2.3 | API: 10 F2 ruta — nedostajuće obaveze (spisak + kreiranje), pravila (CRUD), provjera, pomjeranje datuma provjere, masovna obnova, izvoz CSV/PDF, uvoz (pregled + primjena) | ✅ |
| 2.4 | UI: `/ured/rokovi` sa 9 stanja i karticom „Nedostaje“; mobilni ekran rokova razlikuje **blokadu** (isteklo/odbijeno) od upozorenja | ✅ |
| 2.5 | Worker: `reminders.scan` (po roli primaoca iz `obligation_notify_roles`, dedupe), `attachments.purge` (retencija) | ✅ |
| 3.1 | Baza: `day_kind`/`absence_note`/`assignment_warning`, segmenti sa `tz_offset_minutes`/`segment_source`, `one_open_per_worker_per_day`, `sync_conflicts` + `entity_type`/`entity_id`, `work_week_approvals.reviewed_snapshot`; nove tabele `worker_rates` (EXCLUDE po tipu), `worker_leave_entitlements`, `worker_issuances`, `ppe_templates`, `worker_history` — sve FORCE RLS | ✅ |
| 3.2 | Domena: 7 vrsta dana, zaokruživanje **po segmentu** (`sumSegmentMinutes`), zaboravljen dan (`forgottenDayOutcome`), stanje provjere dana — 20 testova | ✅ |
| 3.3 | API: 23 rute — timer (start/pause/resume/finish, idempotentno po `localId`), `me/day`, zaboravljen dan, sedmica, grupna potvrda, vrsta dana; kartica radnika, cijene (istorija, ne prepisivanje), dopust, zaduženja, OZO šabloni, historija, „Radnik odlazi“, masovne izmjene | ✅ |
| 3.4 | UI: web `/ured/radnici/[id]` (5 sekcija, dozvola po sekciji), `/ured/radni-dani/sedmica` (radnik × dan + CSV), mobilni „Moj dan“ timer-first (`≥ 56 dp`, ručni unos iza dugmeta) | ✅ |
| 3.5 | Worker: `sync.purge` (retencija tijela razriješenih sukoba); obavještenje radniku pri razrješenju sukoba; filter sukoba po `entity_type` | ✅ |

| 4.1 | Baza: `machine_cost_components` (važenje komponenti sa `EXCLUDE`/trigerom, isti izbor mehanizma kao dodjele i satnice), `machine_cost_rate_snapshots`, `fuel_prices`, `fuel_tanks`, `fuel_tank_movements`, `service_orders`, `check_templates`; `project_cost_entries` dobija `rate_snapshot`/`component_breakdown`/`snapshot_id` i `source_type` proširen na `SERVICE_ORDER`; `machine_cost_rates` postaje **ručna** stopa (`is_manual` + razlog ≥10 znakova); dvostruka dodjela mašine je **globalna** | ✅ |
| 4.2 | Domena: razlaganje stope po komponentama (zaokruživanje po komponenti na cent pa zbir; `PER_MONTH` → stoti dio centa pa pola-naviše; `PER_KM` van satne stope), iskorištenost `WORK/(WORK+IDLE+BREAKDOWN)` + kalendarska kolona, MTBF/MTTR, odstupanje goriva, stacionaža `km+m`, kritične stavke šablona — **196 testa** | ✅ |
| 4.3 | API: **24 nove rute** — komponente i ručna stopa, iskorištenost i zauzetost mašine, kalendar zauzetosti, najam, cijene goriva, cisterne i popis, odstupanja i objašnjenje, dionice, šabloni pregleda, foto potvrda; OpenAPI **150 putanja / 195 operacija** | ✅ |
| 4.4 | UI: `/ured/trosak-masina` (komponente + stopa + snapshot), `/ured/gorivo` (odstupanja, cijene, cisterne, unos bez obaveznog iznosa), `/ured/ture` (stacionaže sa zbirom po dionici), `/ured/dnevni-pregled` (šabloni, kritični FAIL → foto + kvar), `/ured/masine/kalendar` (mjesec × mašina) | ✅ |
| 4.5 | Provjere: `check-preklapanje.mjs` proširen na `machine_cost_components`, NUL-sweep pokriva sve F4 rute, integracioni test `phase4.integration.test.ts` (15 scenarija protiv prave baze) | ✅ |

| 5.1 | Baza: `project_phases` (težine 1–1000), `project_phase_dependencies`, `cost_categories`, `project_budget_lines` (append-only), `project_amendments`, `project_boq_items`, `budget_alert_events` (dedupe), `project_tasks`; **`cost_entries` kao jedini ledger** sa `cost_entry_guard()`; `attachments.entity_type` + `'PROJECT'` — **46 migracija, 83 tabele (74 tenant)** | ✅ |
| 5.2 | Domena: napredak po težinama, marža, EAC (**procjena**, pri 0 % nema broja), pragovi budžeta sa `dedupe_key`, zatvaranje projekta — **226 testova** u domeni | ✅ |
| 5.3 | API: **19 ruta** — faze i zavisnosti, napredak, profitabilnost, ledger troška, budžet, predmjer, aneksi, zatvaranje, zadaci, kategorije, prilozi projekta; `+22` audit akcije; OpenAPI **169 putanja / 222 metode** | ✅ |
| 5.4 | Knjiženje troška na **jednom mjestu** (`bookFuelEntryCost`, `bookMachineWorkLogCost`, `bookHaulCost`, `postCost`, `settlePendingCost`, `reverseCost`, `reverseSourceCost`); **R4 sync sada knjiži** (gorivo, sat, tura) — ranije je upisivao red bez troška | ✅ |
| 5.5 | UI: `/ured/projekti` (marža, rizičnost) + `/ured/projekti/[id]` sa 8 tabova, `/ured/zadaci`, `/ured/postavke/kategorije-troska`, kartica „Rizični projekti“ na `/pregled`; mobilni `/moji-zadaci` i `/trosak` (foto + `sha256`) | ✅ |
| 5.6 | Worker `budget.thresholds` (`*/15 * * * *`, 80/100 %, dedupe 3 sloja, PM + OWNER); provjere: `pnpm test` 639 prošlo, typecheck 6/6, lint čist, `next build`, OpenAPI ažuran, `check-tenant-sql` 769 upita ✓ | ✅ |

## Faza 4 — odluke koje se ne smiju izgubiti

- **Stopa je zbir komponenti, ne jedan broj.** Zaokruživanje ide **po komponenti na cent**, pa se
  sabira; `PER_MONTH` se dijeli sa `planned_hours_per_month` u dva koraka (stoti dio centa, pa
  pola-naviše) jer bi jedno zaokruživanje na kraju pomjerilo mjesečni trošak. `PER_KM` **ne ulazi**
  u satnu stopu (iznosio bi `0n`) — vraća se kao `rateWithKm` uz stopu.
- **Snapshot troška je dokaz i ne mijenja se.** `project_cost_entries.rate_snapshot` se puni pri
  knjiženju i triger odbija svaku kasniju izmjenu (`COST_SNAPSHOT_IMMUTABLE`); razlaganje po
  komponentama ostaje uz njega i kad je stopa ručna, da se vidi kolika bi bila izračunata.
- **Ručna stopa ne briše izračunatu.** Unos traži razlog ≥10 znakova (`COST_RATE_MANUAL_OVERRIDE`
  je zaseban kod — ekran tada traži razlog, ne popravku iznosa), a „vrati na izračunato" **zatvara**
  red (`valid_to`), ne briše ga. Historija je jedini način da se poslije objasni cijena sata.
- **Dvostruka dodjela mašine je GLOBALNA, ne po firmi.** Mašina ne može biti na dva gradilišta u
  istom periodu nigdje; iznimka ide kroz `usage_overrides.double_booking_override_id` i mora imati
  razlog i rok. Ograničenje je triger sa `pg_advisory_xact_lock` (ili `EXCLUDE` kad je `btree_gist`
  dostupan) — isto pravilo kao dodjele radnika i satnice.
- **Iskorištenost ima DVIJE kolone i to je namjerno.** Primarna je `WORK/(WORK+IDLE+BREAKDOWN)` —
  ne kažnjava mašinu za dane kad nije bila iznajmljena. Sekundarna je kalendarska (radni sati iz
  `workday_hours` i `company_holidays`, gdje `is_working = true` znači prenesena radna subota).
  Jedna kolona bi ili lagala o efikasnosti ili o trošku.
- **Odstupanje goriva je upozorenje, nikad blokada.** Točenje prolazi; otvara se stavka koja traži
  objašnjenje (`BREAKDOWN|THEFT|MISREAD|OTHER` + napomena ≥10 znakova). Cijena iz šifarnika je
  **predlog** (`price_source = PRICE_LIST`) i nikad ne prepisuje uneseni iznos; kad iznosa nema,
  `amount_cents` ostaje `NULL`, **ne nula** (nepoznato ≠ besplatno).
- **Cisterna i pumpa se ne vode paralelno.** Uključena cisterna (`companies.fuel_tank_enabled`) znači
  da točenje skida stanje; popis upisuje **razliku** u audit, jer bez nje se gubitak ne vidi.
  Isključena cisterna odbija unos sa `tank_id` uz jasnu poruku, a ne tiho zanemaruje izbor.
- **Kritična FAIL stavka otvara foto-obavezu i kvar, ali ne blokira rad.** Pregled se evidentira,
  kvar se veže na pregled (`daily_check_id`), a foto potvrda traži stvarni prilog `status='ready'`
  i idempotentna je. Odluka je čovjeka; dokaz mora postojati.
- **Prag odobrenja kvara je podatak firme** (`companies.fault_approval_threshold_cents`, default 500
  KM), ne konstanta. `APPROVED` otvara servisni nalog **trigerom** i tačno jednom
  (`UNIQUE (company_id, fault_id)`), jer se status mijenja na više mjesta.
- **Kalendar: „slobodno" je odsustvo reda.** Nema posebnog reda za slobodno; `to_date IS NULL` je
  otvorena dodjela. Tako kalendar ne može tvrditi nešto što baza ne zna.

## Korak 0 — zašto je CI bio crven i šta je popravljeno

Dva nezavisna uzroka; oba su bila **prvi** pad u nizu, pa su krila sve naredne korake.

| # | Korak CI-ja | Uzrok | Popravka |
|---|---|---|---|
| 1 | „Nema stvarnih ličnih podataka" (`ci-v2.yml`) | `check-privacy.mjs` je IBAN tretirao kao lični podatak, iako spec 01 §3.2 traži IBAN **firme**; 4 test mejla su bila van rezervisanih domena | IBAN izuzet iz `PERSONAL_SQL`/`PERSONAL_TS` (+ 2 self-test slučaja koja to čuvaju); test mejlovi prebačeni na `*.test` / `example.com` |
| 3 | `E2E Playwright` — **istekao job-timeout (30 min)**, sve prije njega zeleno | F1 prijava ima **drugi korak**, a replay zaštita (`user_totp.last_used_step`) dozvoljava tri prijave istog naloga po 30-s periodu. E2E prijavljuje `vlasnik@`/`racunovodja@` desetinama puta → drugi login pada kao „pogrešan kod", `loginUi` čeka `**/pregled` do isteka testa, lanac od 7 shardova pojede cijeli budžet | Helper `loginUi` sada traži **svjež kod** (`freshTotpCode`: tekući korak → dozvoljeni prozor `+1` → novi period) i resetuje brojač sintetičkog naloga (`resetTotpReplayGuard`) kad je `E2E_RESET_TOTP_STEP=1`; seed resetuje `last_used_step`; timeout joba 30 → 45 min |
| 2 | `assembleRelease` (mobilni E2E) | `packages/domain/src/totp.ts` uvozi `node:crypto`, a barrel `@gradix/domain` ga je uvlačio u Android bundle preko `r4-outbox.ts`. Metro nema Node stdlib → bundling pada | Novi ulaz `@gradix/domain/server` za serverske module; barrel više ne izvozi TOTP; uvoznici prebačeni. Greška se vidi **samo** pri bundlovanju, ne u `vitest`/`tsc` |

### Usklađeni ugovori i dokumentacija (F1 je promijenio ponašanje, ne samo kod)

- **`LoginResponse` je sada unija dvije stvarne grane.** Ruta `POST /api/auth/login` od F1 ima dva
  uspjeha: punu sesiju (role bez 2FA) i **2FA vrata** (`preAuthToken` + `gate`, bez sesije).
  Ugovor je opisivao samo prvu, pa je mobilni klijent dobijao `undefined` tokene i padao na
  validaciji, a web ekran je oblik odgovora pogađao ručno napisanim tipom. Sada:
  `LoginSessionResponse | LoginTwoFactorRequiredResponse`, diskriminant `isTwoFactorRequired()`,
  `enrollmentRequired` u ugovoru, i test uzorak za **oba** oblika.
- **Mobilna prijava ne ostavlja poluspremnu sesiju.** Nalog sa obaveznom 2FA sada dobija jasnu
  `AUTH_2FA_REQUIRED` grešku („prijavite se na webu") umjesto praznog ekrana, i test provjerava
  da se tokeni **ne** upisuju.
- **E2E prijava je dvostepena i ponovljiva.** `loginUi` popunjava kod iz autentikatora kad se polje pojavi;
  demo seed daje sintetičku TOTP tajnu uredskim rolama. Bez toga bi svaki E2E shard stao na
  `/login` — a integracioni testovi bi i dalje bili zeleni (to je bila slijepa tačka).
  Novi integracioni test prolazi **istu** putanju kao čovjek: lozinka → pre-auth → kod → `gx_at`.
  Zaštita od replay-a se time **ne gasi** — testira je integracioni test protiv pravog servera; u
  E2E-u se resetuje samo brojač sintetičkog naloga, i to pod izričitom env zastavicom.
- **`@gradix/domain/server`** je dokumentovan kao jedini dozvoljeni ulaz za serverske module
  (TOTP). Mobilni ga nikad ne uvozi — pravilo stoji u zaglavlju barrella.
- **`STATUS.md` je tvrdio da je sljedeća „Faza 2 — projekti i mehanizacija"**, što je u suprotnosti
  sa `IMPLEMENTATION_PLAN.md` (Faza 2 = Obaveze s rokom). Ispravljeno.

## Brojevi (lokalna provjera, 2026-11-23)

```
migracije       46          tabele          83 (74 tenant)
OpenAPI         169 putanja (222 metode)
pnpm test       639 prošlo, 338 preskočeno
                (web 277 + domain 226 + mobile 93 + contracts 21 + worker 22; preskočeno = DB integracija bez DATABASE_URL)
pnpm lint       6/6 · pnpm typecheck 6/6 · next build ✓
check-tenant-sql 769 upita ✓ · check-matrix-parity 0 grešaka · check-application-coverage 0 grešaka
a11y            axe (WCAG 2.1 AA) u svakom novom UI testu — bez serious/critical
```

Baza lokalno: embedded Postgres na portu 5433 (`v2/.pg/`, gitignorisano).

## Kako je Faza 1 provjerena

- **Integracioni test na živoj bazi** (`f1-access.integration.test.ts`, 20 testova): RLS izolacija
  svih novih tabela i FORCE RLS, 2FA šifrovanje (pogrešan ključ pada na GCM tagu), replay istog
  koda, jednokratnost recovery kodova, politika lozinki i istorija, lock poslije 10 promašaja,
  rotacija poslije 180 d **samo** uredskim rolama, opoziv pojedinačne/tuđe sesije i „svi ostali“,
  audit metadata `{before, after, changed}` i klase, onboarding u jednoj transakciji sa rollbackom
  i dvostrukim slugom, CHECK-ovi support pristupa.
- **Dvije greške koje su testovi našli, a ne oko:**
  1. `password_history` nije imala `DELETE` grant za `gradix_app` (bootstrap je imao, baza nije) —
     reset lozinke je vraćao 500. Otkrilo se jer test traži stvarni 200, ne mock.
  2. `gate: "ENROLL"` je izdavao **ništa** — uredska rola bez 2FA nije mogla ni da se prijavi ni
     da upari 2FA (kružni argument). Sada se izdaje sesija ograničena na uparivanje (`enr` u
     tokenu, `ENROLLMENT_ALLOWED` u guard-u), a `refresh` ponovo čita stanje iz baze — inače bi
     jedno osvježavanje tokena pretvorilo tu sesiju u punu i zaobišlo obaveznu 2FA.
- **Tačna lozinka više nije promašaj:** prije je svaki `AUTH_2FA_REQUIRED` ulazio u brojač, pa je
  pet ispravnih prijava zaključalo nalog. Sada brojač pune samo `AUTH_INVALID_CREDENTIALS`.
- **Statička provjera tenanta** je otkrila da lista tenant tabela ne pokriva F1 tabele
  (`company_holidays`, `report_jobs`, `daily_rollups`, `user_devices`, `notifications`, …) — lista
  dopunjena na 51.

## Kako je Faza 0 provjerena

- **Worker stvarno radi**, nije samo kompajliran: `ping.health` se izvršio dva puta sa
  `REMINDER_INTERVAL_MINUTES=1`, proces se ugasio uredno, `queueHealth()` je nad tom bazom
  vratio `available:true, completed:4, active:0, stuck:0, stale:false`.
- **Obavještenja protiv žive baze** (`notification.integration.test.ts`, 6 testova): dedupe po
  `dedupe_key`, validacija bez primaoca i bez `href`, tuđe se ne vidi ni ne označava, druga firma
  ne vidi ništa, email bez SMTP-a je `BLOCKED_NO_PROVIDER` i poruka ostaje u inboxu, retencija
  90 d / 1 g / 2 g.
- **Testovi su hvatali prave greške**, ne samo prolazili: `SafeText` je uhvatio `z.string()` u
  `NotificationReadInput` (NUL bi ušao u bazu), `tokens.test.ts` je uhvatio hardkodirani heks u
  `shell.css`, a worker test je uhvatio da `loadConfig(env)` čita `process.env` umjesto `env`.

## Odluke na snazi (iz modula 1–12)

2FA TOTP za OWNER/ADMIN/ACCOUNTANT · pg-boss, **bez Redisa** · jedan `cost_entries` sa 8
`source_type` · satnice samo OWNER/ADMIN/ACCOUNTANT · `SELF_APPROVAL_FORBIDDEN` · cisterna je
skladište `TANK` · situacije prema naručiocu van MVP-a (B15) · dashboard po roli ·
`notifications` sa obaveznim `href` i `dedupe_key` · audit retention 2/5/10 g · `Cmd/Ctrl+K` pod
RLS-om · **bez** AI/vektorske pretrage i **bez** kvalifikovanog e-potpisa u MVP-u.

## Faza 2 — odluke koje se ne smiju izgubiti

- **Trajna obaveza ne može ostati bez roka.** `expires_at` piše trigger *poslije* INSERT-a, pa ga
  CHECK ne može vidjeti; zato odgođeni constraint trigger (`obligations_review_at_required`,
  `DEFERRABLE INITIALLY DEFERRED`) **ponovo čita red** i traži `review_at`. Isto pravilo u servisu
  daje bolju poruku („Obaveza bez roka mora imati datum provjere“) i to je ugovor: provjera roda
  entiteta ide **prije** te poruke, inače „ljekarski na mašini“ prijavi datum umjesto uzroka.
- **`isBlockingState` ne zavisi od radnje.** `expired`/`rejected` blokiraju uvijek; da li blokiraju
  *ovu* radnju odlučuje `signalBlocksAction`. Spajanje ta dva pojma je tiho uklonilo upozorenje pri
  evidentiranju goriva — signal koji ne blokira ovu radnju ide u `warns`, nikad se ne gubi.
- **„Nedostaje“ je posao, ne greška.** Spisak se računa iz pravila firme; kreiranje traži datum
  provjere jer nove obaveze nemaju rok. Preskočeni redovi se prijavljuju kao djelimičan uspjeh.
- **Mobilni ekran razlikuje blokadu od upozorenja i po boji.** Radnik na suncu ne čita tekst;
  `danger` postoji baš za isteklo/odbijeno.

## Faza 5 — odluke koje se ne smiju izgubiti

- **`cost_entries` je JEDINI ledger troška.** Nema druge tabele u koju se knjiži; svaki izvor
  (radni dan, gorivo, sat mašine, tura, servisni nalog, ručni unos, storno) ide kroz
  `cost-entry-service.ts`, i to uvijek sa istim `PoolClient`-om kao upis izvora — inače bi izvor i
  trošak mogli završiti u različitim transakcijama.
- **`PENDING` nije nula.** Red bez cijene ima `amount_cents NULL` i **količinu**; u UI-u piše
  „bez cijene“ i broji se kao **broj zapisa**, nikad kao iznos. Svaka zamjena nulom bi tiho umanjila
  trošak projekta.
- **`POSTED` se ne prepisuje.** Ispravka je storno (novi red sa `reverses_id`) + novo knjiženje;
  `cost_entry_guard()` odbija povratak `POSTED` → izmjena i svaki `REVERSED` dalje.
- **EAC je procjena i pri 0 % napretka ne postoji.** `estimateAtCompletion` vraća `amount: null`,
  `reason: "NO_PROGRESS"`; na ekranu piše „Procjena nije moguća pri 0 % napretka“. Nula bi bila
  tvrdnja koju nemamo, a „ostatak budžeta“ je druga formula i ne zove se EAC.
- **Storno iz revizije izvora nikad ne obara posao.** `reverseSourceCost` vraća
  `{ reversed: boolean }` i ne baca; revizija goriva/sata/ture mora proći i kad storno nije moguć
  (npr. projekat je `FINISHED`).
- **Terenski (offline) unos knjiži isto kao uredski.** `r4-sync-*` handleri zovu iste `book*`
  funkcije — ranije su upisivali red bez troška, što je bila tiha rupa između terena i knjige.
- **Trošak bez projekta je `skipped`, ne greška.** Ledger prima i troškove bez `project_id`
  (npr. mašina na održavanju); oni ne ulaze u maržu nijednog projekta.
- **Napredak ima imenilac.** `projectProgress` sabira **težine** faza (`1–1000`), ne broj završenih
  faza; projekat bez faza nema procenat i EAC se ne računa.
- **Upozorenje na budžet je događaj, ne stanje.** `budget_alert_events` sa `dedupe_key`
  `"prj:<revision>:<scope>:<pct>"` i `UNIQUE (company_id, dedupe_key)`: 100 % daje **jedno**
  upozorenje, a nova revizija budžeta ga legitimno otvara ponovo.
- **Ledger je tab u projektu, ne zaseban ekran.** `/ured/troskovi-projekta` je uklonjen: trošak se
  čita u kontekstu jednog projekta, a `nav.ts` je jedina definicija menija (i to provjerava
  `nav.test.ts`).
- **Marža se ne prikazuje bez `projects.costs.view`.** Skrivanje na klijentu nije dovoljno — server
  ne šalje novac onome ko ne smije da ga vidi, a test to provjerava na listi projekata.

## Namjerno još nema

- `budget.thresholds` je isporučen u Fazi 5; ostali worker poslovi dolaze sa modulima koji traže
  svoje tabele. (`sync.purge` je isporučen u Fazi 3.)
- Email/push provajder: isporuka je `BLOCKED_NO_PROVIDER`, in-app radi bez njega.
- `report_jobs`, `daily_rollups` — tabele i kostur postoje, poslovi dolaze sa izvještajima (Faza 6).

## Dugovi

- CI job traje ~9 min; kandidat za keširanje `pnpm` store-a.
- `check-matrix-parity` upozorava na jedan `NOT_IMPLEMENTED` (tenant lista do R2) — svjesno,
  zatvara se kad Faza 1 doda tabele R3–R7.
- Maestro tokovi pokrivaju samo R0 offline tokove; „Moji uređaji“ na mobilnom još nema tok.
- Platform sesija živi 8 h i nema refresh — operator se prijavljuje ponovo (namjerno: kraće od
  radnog dana, jer mijenja firme).
- Support pristup se **upisuje** u audit firme, ali još ne otvara ekrane firme kao operator —
  pravi „impersonation“ dolazi sa podrškom u Fazi 7.
- „Moj dan“ postoji samo u mobilnoj aplikaciji; web obavještenje o razrješenju sukoba zato vodi na
  `/pregled` (`src/server/notification-hrefs.ts` + `notification-hrefs.test.ts`). Web ekran timera
  nije isporučen ni u Fazi 4 (F4 je donio kalendar zauzetosti, ne timer) — ostaje za modul koji ga
  bude tražio.
- **F4:** servisni nalog se otvara automatski, ali ga **Modul 8** puni (dobavljač, faktura,
  zatvaranje). Do tada je `service_orders` vidljiv kroz bazu i `project_cost_entries`
  `SERVICE_ORDER` put, ali nema ekrana.
- **F4:** prosječna potrošnja goriva (baseline) traži bar dva očitanja brojila u 90 dana — prva
  točenja nove mašine nemaju odstupanje i to je namjerno (inače bi svaki prvi unos tražio razlog).
- **F4:** `check-preklapanje.mjs` traži `psql` (`infra/scripts/db-apply.sh`), pa se u ovom okruženju
  ne može pokrenuti; mehanizam je zato provjeren direktnim upitom nad `gradix_fresh`
  (dodjele: 2 × `EXCLUDE`, komponente: 1 × `EXCLUDE`, bez trigera) i istim testom trke.
- **F5:** `workday-timer-service.ts` još ne knjiži trošak — sat mašine se knjiži iz
  `machine_work_log`. Spajanje traži odluku koji je izvor mjerodavan kad postoje oba; do tada nema
  tihog dvostrukog knjiženja.
- **F5:** `PATCH /api/tasks/{id}` traži `projects.manage` [OWNER, ADMIN], pa šef gradilišta i radnik
  na terenu ne mogu prebaciti status zadatka (mobilni ekran ih prikazuje). Otvorena odluka o
  dozvoli po zadatku.
- **F5:** storno na `FINISHED` projektu pada u `cost_entry_guard()`; greška se guta i vraća
  `{reversed:false}`. Pravilo „storno je dozvoljen i poslije zatvaranja“ je odluka, ne bug.
- **F5:** integracioni testovi protiv baze u ovom okruženju nisu pokrenuti (nema `psql`/PG);
  oslanjaju se na CI i lokalno se prijavljuju kao **preskočeni**, ne kao prošli.
