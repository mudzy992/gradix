# STATUS — Gradix v2

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Faze 0–8: završene; F9: završni checkpoint** · **Tag:** `phase-9` · **CI:** rezultat provjeriti na završnom commitu

Faza 9 dodaje mobilni dnevnik, incident s učesnicima i offline foto red te Toolbox, uz postojeću
bazu, domen i web. Redoslijed i oporavak starih offline zapisa, autorizacija potpisa i fotografija
opisani su u `IZVJESTAJ-FAZA-9.md`. Lokalni puni test jednom je pronašao dvije greške NUL registra;
ciljana provjera nakon popravke prolazi. Završni GitHub CI ne treba poistovjećivati sa starijim
zelenim runovima. Faza 10 ostaje sljedeći zaseban zadatak.

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
| K0 | Šef gradilišta: dozvola **`tasks.update_status`** (status samo na svojim projektima, komentari bez `projects.manage`); **timer → `FOREMAN_CONFIRMED` sada knjiži trošak rada** i u grupnoj potvrdi; `PROJECT_CLOSED` na stornu je 422, ne 500; `FINISHED` guard ostaje uz `reopen_reason` | ✅ |
| 5.6 | Worker `budget.thresholds` (`*/15 * * * *`, 80/100 %, dedupe 3 sloja, PM + OWNER); provjere: `pnpm test` 639 prošlo, typecheck 6/6, lint čist, `next build`, OpenAPI ažuran, `check-tenant-sql` 769 upita ✓ | ✅ |

| 6.1 | Baza: `pay_periods` (`OPEN→CALCULATED→APPROVED→LOCKED` uz `pay_period_transition_guard`), `payroll_components`, `payroll_parameters` (bez preklapanja važenja), `payroll_runs`/`payroll_run_lines`/`payroll_line_sources` (zamrznuti `payroll_freeze_guard`), `worker_advances`, `pay_corrections` + `workdays_open_correction` triger; `companies.overtime_basis`/`overtime_weekly_threshold` | ✅ |
| 6.2 | Domena: klasifikacija sati **bez dvostrukog plaćanja** (`PRAZNIK > NEDJELJA > NOĆNI > PREKOVREMENI > REDOVNI`), noćni prozor preko ponoći bez gubitka minute, dnevni/sedmični osnov prekovremenog, izostanci kao dani — **25 zlatnih testova** | ✅ |
| 6.3 | API: **16 ruta** — periodi (lista/otvaranje/izračun/odobrenje/zaključavanje/linije/raspis/izvoz XLSX+CSV), komponente i parametri, akontacije i pozajmice, korekcije, `me/payroll`; 4 nove dozvole, 8 novih kodova grešaka; OpenAPI **182 putanje** | ✅ |
| 6.4 | Servis obračuna: satnica **na dan rada**, koeficijent, `RATE_MISSING`/`PARAMETER_MISSING` (linija bez iznosa, nikad nula), odbici do nule sa ostatkom, `SELF_APPROVAL_FORBIDDEN`, korekcije u naredni period, **trošak rada u `cost_entries`** (jednom po danu, idempotentno) | ✅ |
| 6.5 | UI: `/ured/obracun-sati` (periodi + spremnost), `/ured/obracun-sati/[period]` (radnik × komponente, blokade, Izračunaj/Odobri/Zaključaj, XLSX/CSV, **raspis**), `/ured/obracun-sati/postavke` (komponente + važenja parametara), `/ured/obracun-sati/sati` (izvoz sirovih sati), tab „Obračun“ na kartici radnika, mobilni `/moj-obracun`, podsjetnik na `/pregled` poslije 5. | ✅ |
| 6.6 | Provjere: `payroll-period.integration.test.ts` — **17 zlatnih testova novca protiv prave baze** (svi iz §5 specifikacije), `payroll-ui.test.ts` (11), `payroll-reminder.test.ts` (2), NUL-sweep pokriva sve F6 rute; `pnpm test` **658 prošlo**, typecheck 6/6, OpenAPI ažuran | ✅ |

| 7.1 | Baza: 9 novih tabela (`tenders` dobija 9-statusni tok i `converted_project_id`; `tender_boq_items`, `tender_resources`, `tender_calculation_items`, `tender_price_revisions` + `tender_price_approvals`, `tender_checklist_templates`/`items`, `tender_phases`, `tender_team`, `tender_outcomes`), `obligations.tender_id` u `obligations_one_scope`, `TENDER_DEADLINE`/`TENDER_QUESTIONS` tipovi obaveza, triger imutabilnosti revizije — **48 migracija, 98 tabela** | ✅ |
| 7.2 | Domena (`packages/domain/tender-calculation.ts`): direktni trošak, marža/rezerva/popust, marža u procentu ponuđenog, prag odobrenja (`>5 %` ili marža `< min_markup_pct`), kompletnost kontrolne liste i blokirajuće stavke — 17 zlatnih testova | ✅ |
| 7.3 | API: **24 nove rute** — tenderi (lista/unos/izmjena/odluka/kopija/konverzija), predmjer, resursi i predlog cijene, obračun, revizije i odobrenje, kontrolna lista, garancije i povrat, ishod, uspješnost, šabloni liste; 3 nove dozvole, 6 novih kodova + `ALREADY_CONVERTED`; OpenAPI **199 putanja** | ✅ |
| 7.4 | Servisi: `tender-service` (kapije u `changeStatus`), `tender-pricing` (revizije append-only, odobrenje), `tender-checklist-service` (šifarnik, garancije), `tender-outcome-service` (ishod + `tenderPerformance`), `tender-copy`, `tender-convert` (atomska konverzija sa claim-om) | ✅ |
| 7.5 | UI: `/ured/tenderi` (tabela + kanban, filteri, novi tender sa kopiranjem predmjera), `/ured/tenderi/[id]` sa 7 tabova (pregled/odluka, kalkulacija, dokumenti, prilozi, ishod, tim, konverzija), `/ured/tenderi/uspjesnost`, `/ured/tenderi/kalendar`; worker podsjetnici vode tenderske rokove na tender | ✅ |
| 7.6 | Provjere: `tender-lifecycle`/`convert`/`convert-race`/`pricing` integracioni testovi (27 protiv prave baze), `tender-status.test.ts` parity nad `.cursor/docs/matrices/tenders/MATRIX.md` (76 prelaza), NUL-sweep pokriva svih 20 novih ruta, `pnpm test` **1 178 prošlo u 6 paketa**, typecheck 6/6, lint čist, matrix parity 0 grešaka, preflight iz nule 0 problema, OpenAPI **202 putanje** | ✅ |

| 8.1 | Baza: `service_orders` puni životni ciklus (`PLANNED → APPROVED → IN_PROGRESS → WAITING_PARTS → DONE/CANCELLED`) + `version`, `maintenance_templates`/`maintenance_plans` (osnov `HOURS`/`KM`/`DAYS`, `tolerance_pct`), `stock_items`/`stock_movements` (append-only, `warehouse_id` nullable za F10), `service_order_events`, `service_order_parts`; `companies.block_on_overdue_maintenance` i `service_approval_threshold_cents` (default 500 KM); `approval_requests.subject_type` proširen na `service_order`; sve nove tabele u `TENANT_TABLES` sa FORCE RLS + grantovima u `bootstrap/grants.sql` — **49 migracija, 105 tabela (96 tenant)** | ✅ |
| 8.2 | Domena (`service-maintenance.ts`): statusi i prelazi, `serviceCost` (sati × satnica, pola-naviše, `total = labor + parts + external`), `machineReliability` (MTTR u minutama, MTBF = radni sati / **kvarovi** — `isFault` čuva preventivne naloge van brojača), `evaluateMaintenance` (prag = `nextDue − interval × tolerance%`), `stockOnHand` (Σ IN − Σ OUT), `serviceApprovalCheck` (strogo `>`) — **20 testova** | ✅ |
| 8.3 | API: **23 rute** — nalozi (lista/detalj/unos/izmjena/start/wait-parts/finish/odobri/odbij/parts), planovi i šabloni, zalihe (artikli, kretnje), MTBF/MTTR; OpenAPI **219 putanja**, `check-openapi` ažuran | ✅ |
| 8.4 | Knjiženje: trošak naloga ide **ili na projekat ili samo na mašinu — nikad oboje** (`source_type = SERVICE_ORDER`, jedan red po izvoru); garancija upisuje red sa iznosom **0** (posao je vidljiv, drugi trošak ne nastaje); bez iznosa `PENDING`; knjiženje **poslije** commit-a naloga; ustaljeni trošak ulazi u komponentu `SERVICE` stope mašine preko prosjeka, uz čuvanje starih snapshotova | ✅ |
| 8.5 | Worker `reminders.scan` proširen na preventivu (datum **i** sati rada), idempotentno po `(maintenance_plan_id, planned_for)`; `SERVICE_ORDER` seed u `ensureCostCategories` (dopuna, ne samo prazan šifarnik) | ✅ |
| 8.6 | UI: `/ured/servis` (red čekanja po prioritetu, filter „čekaju dijelove“, radnje stanja u listi), `/ured/servis/[id]` (sati, dijelovi, tok, trošak — `total_cost` je prikaz, nikad unos), `/ured/servis/planovi`, `/ured/dijelovi` (stanje bez polja za unos), tab „Održavanje“ na `/ured/masine/[id]`, kartica „Servis“ na `/pregled` (isti `dueMaintenancePlans` kao worker) | ✅ |
| 8.7 | Mobilno: `/servisni-nalozi` za mehaničara — offline-first kroz R4 outbox (`service_order_action`), jedna glavna radnja iz stanja naloga, sati/dio u redu čekanja; `outbox`/`sync_events` podignuti na `user_version = 2` sa prenosom redova bez gubitka; mete ≥ 56 dp | ✅ |
| 8.8 | Provjere: `f8-service-orders` (12) + `f8-service-sync` (6) + `f8-isolation` (3) protiv prave baze, `service-order-sync` (8) i `servis-model` (13) domenski, `migrations` (5) za v2 prenos; `pnpm test` **1 221 prošao** (web 691, domain 296, mobile 118), typecheck 6/6, lint čist, `db:types:check` sinhron, `check-tenant-sql` 96/96, matrix parity 0 grešaka, preflight SQL 001/002 prolazi, `check-cycles` 0 ciklusa | ✅ |

| 9.1 | Baza: 12 novih tabela — `site_diaries` (`DRAFT → SIGNED → LOCKED`, unique `(company, project, diary_date)`, `auto_snapshot`, `version`), `site_diary_items` (`MANUAL`/`HAUL`/`BOQ`), `site_diary_delays` (`hours ≤ 24`), `site_diary_revisions`, `site_diary_templates` (`format_confirmed_at`), `hse_incidents` (+`client_local_id`, `NEAR_MISS` bez izgubljenih dana), `hse_incident_updates`, `hse_investigations`, `hse_actions`, `hse_inspections` (+`prohibition_lifted_at`), `hse_trainings` + prisustvo, `*_attachments`; trigeri `site_diaries_locked_guard` (potpis i zaključavanje), `hse_incidents_facts_guard`, `site_diary_revisions_immutable`, `hse_incident_updates_immutable`, delete-guard — **50 migracija, 119 tabela (110 tenant)** | ✅ |
| 9.2 | Domena (`site-diary-hse.ts`): prelazi `DRAFT→SIGNED→LOCKED`, `validDiarySignature`, `unsignedDiaryIsOverdue`, zastoji (zbir + `≤ 24 h`), `canCloseIncident` (istraga + nijedna otvorena mjera), `ltifr` (`ozljede × 10⁶ / sati`, `null` bez sati), `nearMissCount` odvojeno, `hseOnTimeRate`, `isActiveProhibition`, `validToolboxInput` — **20 testova**; `r6-diary-hse-sync.ts` — offline ugovor + 5 validatora | ✅ |
| 9.3 | API: **30 ruta** — dnevnik (lista/unos/detalj/izmjena/potpis/zaključavanje/revizija/stavke/zastoji/PDF), šabloni, incidenti (lista/prijava/detalj/dopuna/istraga/zatvaranje), mjere (lista/nova/završi/otkaži), obuke + prisustvo, inspekcije + podizanje zabrane, statistika, HSE PDF; 5 dozvola (`diary.*`, `hse.*`), 8 novih kodova (`DIARY_ALREADY_LOCKED`…), OpenAPI **241 putanja** | ✅ |
| 9.4 | Servisi: `diary-service` (auto-sekcije, sekcijsko spajanje u sync-u, `baseVersion` sukob, revizija sa sadržajem PRIJE izmjene), `diary-template-service`, `hse-service` (+`*Tx` jezgra za sync), `diary-pdf-service`/`hse-report-pdf-service` (PDF bez biblioteke), `diaryAttention`/`hseAttention` za Pregled | ✅ |
| 9.5 | UI: `/ured/dnevnik` (lista + traka nepotpisanih), `/ured/dnevnik/[id]` (auto sekcije read-only, ručni unos, količine, zastoji, potpis/zaključavanje/revizija, PDF sa `DRAFT_FORMAT`), `/ured/hse` (zabrana rada prva, mjere koje kasne, statistika), `/ured/hse/[id]` (činjenice bez forme za izmjenu, dopune, istraga, mjere, zatvaranje sa objašnjenjem šta nedostaje), `/ured/hse/inspekcije` (lift zabrane), `/ured/hse/obuke` (prisustvo kao potpis); kartica „Zaštita na radu“ na `/pregled`; navigacija: „Dnevnik građenja“ i „Zaštita na radu“ u grupi Evidencija | ✅ |
| 9.6 | Mobilno: `LOCAL_SCHEMA_VERSION = 3` — `outbox`/`sync_events` primaju pet F9 tipova (`site_diary`, `site_diary_item`, `hse_incident`, `hse_action`, `hse_training`) uz prenos redova u JEDNOJ transakciji; `queueSiteDiary`/`queueSiteDiaryItem`/`queueHseIncident`/`queueHseAction`/`queueHseTraining` sa validacijom PRIJE upisa; `baseVersion` je obavezan (bez njega nema smislenog sukoba) | ✅ |
| 9.7 | Provjere: `f9-diary-hse` (13) + `f9-sync` (8) protiv prave baze, `safe-text` sweep proširen na F9 šeme, `nul-guard` HANDLERS pokriva svih 30 ruta, `migrations` (6) za v3, `r4-outbox` (7) za pet tipova i odbijanje prije upisa, `rbac` tačna lista radnikovih dozvola; `pnpm test` **1 265 prošlo** (web 712, domain 316, mobile 111, db 70, contracts 21, worker 25), typecheck 6/6, lint čist, `check-cycles` 0, OpenAPI ažuran, `check-tenant-sql` 110/110 | ✅ |

## Korak 0 — S3 bundler (naknadna popravka)

- `serverExternalPackages` ostavlja AWS SDK i presigner Node-u; ESM esbuild dijagnostika dobija
  `createRequire` banner za CJS `node:https`. Stari bundle je reprodukovao Coolify grešku;
  novi je prošao S3 zahtjeve na lokalnom lažnom serveru. Next produkcijski build, standalone
  server `/api/health` i standalone SDK HEAD/PUT/GET/presigned GET prošli su lokalno.
- CI `45703972559` na `e5b0a7f` je zelen i izgradio Docker image te izvršio obje S3 provjere
  unutar slike. Korisnik je naknadno potvrdio Coolify produkciju: `s3.bucket_object` i
  `s3.browser_cors` su `PASS`.

## Faza 9 — mobilna isporuka i sigurnosne provjere

- SQLite v5 čuva incident i foto bajtove atomski, partitionirano po firmi/korisniku; nastavak
  nakon potvrđenog incidenta provjerava aktivni nalog i čuva bajtove do potvrde servera.
- Potpis uspoređuje verziju i prikazani automatski presjek, provjerava `diary.sign` i piše audit.
  Fotografija koristi staging ključ, provjeru sadržaja i checksum, zaseban trajni ključ te dozvole.
- Zavisne stavke/mjere čekaju roditelja, a potpis čeka stavke. Potvrđeno odbijena stara količina
  dobija eksplicitno odabran poslovni dan i novi ID; original ostaje sačuvan.
- Mobilni ekran prikazuje radnike/sate, mašine, ture, kvarove, ručne unose, količine i potpise;
  HSE bira učesnike, slike i toolbox potpise. Screen testovi su mockirani, emulator nije pokrenut.
- Jednokratni puni test: **1 312 prošlo, 2 pala** u NUL registru; ispravka je naknadno prošla
  ciljano 9/9. F9 PG testovi 34/34, mobile 145/145, lint/typecheck/cycles i db tipovi prolaze.
  Tenant katalog 111/111 uz admin URL; matrix parity ima ranije R1 upozorenje. SQL preflight
  prolazi preko `pg` kao app rola, ali `run.sh` nije pokrenut bez `psql`. Detalji i ograničenja:
  `IZVJESTAJ-FAZA-9.md`.

## Faza 10 — početak (nije isporučena)

- `warehouse-purchase.ts`: samostalne formule za stanje po skladištu, potpisanu popisnu razliku,
  prosječnu vrijednost izlaza, prag nabavke i situacije podizvođača; sedam domenskih testova.
  Formule još nisu povezane sa bazom ili API-jem.
- Migracija, cisterna, transakcije, dozvole, servisi, interfejs i integracioni testovi tek slijede.
  Posebno treba uskladiti F8 `stockOnHand` (koji ignoriše `COUNT`) s potpisanim razlikama F10,
  bez promjene postojećeg ponašanja prije migracije i zamjene svih čitalaca.
- Specifikacija predviđa knjiženje i odobrenog računa i izlaza materijala: prije integracije treba
  dokazati da isti materijal ne uvećava projektni trošak dvaput, uključujući slučaj kada račun već
  ima `project_id`. Nije riješeno samim domenskim formulama.

## Faza 9 — odluke koje se ne smiju izgubiti

- **Dnevnik je jedan po `(projekt, dan)`, i to u BAZI.** Ponovni `POST` ne pravi drugi red nego
  vraća `DIARY_EXISTS` sa ID-em postojećeg dana (status 200) — šef nastavlja isti dan. Duplikat po
  šefu bi značio dva PDF-a za isti dan, pa inspektor dobija dva dokumenta sa različitim brojevima.
- **Automatske sekcije se ne prepisuju ručno.** Radnici, sati, mašine, ture i kvarovi dolaze iz
  Modula 3/5 i na ekranu su read-only; ispravka se radi u evidenciji, a dnevnik je pokazuje.
- **Potpis je granica, ne ukras.** Triger `site_diaries_locked_guard` brani izmjenu sadržaja i u
  `SIGNED` i u `LOCKED`; jedini dozvoljen put je RED u `site_diary_revisions` sa
  `base_version = OLD.version`. Dokaz revizije je taj red (sa sadržajem PRIJE izmjene), a ne
  parametar pozivaoca — `SET LOCAL` bi bio zaobilaz.
- **Revizija čuva sadržaj prije izmjene, ne samo razlog.** Bez starog sadržaja revizija ne
  dokazuje šta se promijenilo; bez razloga (≥10 znakova) je samo trag da se nešto mijenjalo.
- **Zastoj > 24 h je greška unosa, ne zastoj.** Provjera je u servisu (poruka čovjeku) I u bazi
  (`CHECK hours <= 24`). Ranije je `CHECK` vraćao 500 — nađeno F9 testom.
- **Činjenice incidenta se ne prepisuju — ni kroz rutu, ni kroz SQL.** Nema `PATCH` rute za opis;
  `hse_incidents_facts_guard` odbija `UPDATE` vrste, težine, vremena, opisa i povrijeđenog. Dopuna
  je NOVA izjava u `hse_incident_updates` (dva svjedoka, ne neslaganje verzija).
- **Incident nema `baseVersion` i nikad nije konflikt.** Nema šta da se pregazi; isti klijentski ID
  daje `DUPLICATE`, a ne drugu prijavu. Dva telefona bez signala tako ne prave dva incidenta.
- **`HSE_REPORT` obaveza nastaje u ISTOJ transakciji kao prijava.** Da nastaje kasnije (u workeru),
  prijava bi mogla postojati bez zakonskog roka, a rok bez prijave. Rok je `occurredAt + 3 dana`.
- **Mjera bez odgovornog ili bez roka nije mjera.** Odbija je domena, servis, ruta (422 sa
  `HSE_ACTION_RESPONSIBLE_REQUIRED` / `HSE_ACTION_DUE_REQUIRED`) i baza. `OVERDUE` se **računa**
  pri čitanju, nikad ne čuva — upisano stanje bi u ponedjeljak lagalo o petku.
- **`NEAR_MISS` ne nosi izgubljene dane ni povrijeđenog.** Provjera je u domeni i u ruti: takav
  zapis je „accident sa pogrešnom etiketom“ i statistika bi lagala na obje strane. U statistici se
  `NEAR_MISS` broji **odvojeno**.
- **`PROHIBITION` zaustavlja gradilište.** Obavještenje ide odmah vlasniku (`CRITICAL`) i nalaz je
  prvi na ekranu; zabrana prestaje SAMO kroz `prohibition_lifted_at` sa razlogom ≥5 znakova. Nema
  brisanja nalaza.
- **Prisustvo na obuci je POTPIS, ne checkbox.** `signature_name` + `signed_at` po radniku, upisuje
  ih server uz audit. Isti radnik dvaput je greška unosa (odbijeno u domeni), a toolbox bez teme
  nije obuka — to je sastanak bez zapisa.
- **LTIFR bez sati je `null`, ne nula.** Nula bi tvrdila „nema ozljeda na milion sati“; `null`
  kaže da imenilac ne postoji.
- **PDF ne tvrdi da je zakonski obrazac dok ga vlasnik nije potvrdio.** Svaki izvoz nosi
  `DRAFT_FORMAT` do `format_confirmed_at`; potvrda ide SAMO kroz `confirmFormat`, jer je to jedina
  tačka gdje sistem tvrdi da je obrazac potvrđen.
- **Telefon šalje NAMJERU, ne izračun.** `site_diary_item` sa `BOQ` stavkom uvećava
  `quantity_executed` na serveru u istoj transakciji — napredak projekta ima jedan izvor, a dva
  telefona ne mogu dati dva procenta završenosti.
- **`baseVersion` je ono što je šef VIDIO.** Starija verzija je `DIARY_VERSION_CONFLICT` sa
  obavještenjem šefu, a ne tihi prepis tuđeg teksta. Sekcijsko spajanje (`weather`, `temperatureC`,
  `workedHours`, `description`, `visitors`, `events`) popunjava samo PRAZNO polje.
- **Radnik ima `hse.view` i `hse.report`.** Prijava opasnosti nije privilegija: bez nje se
  `NEAR_MISS` ne prijavljuje, a statistika počinje lagati. `hse.investigate` (istraga, mjere,
  zatvaranje) ostaje šefu/PM-u/vlasniku.
- **`meter_start` ne postoji.** `machine_work_logs` čuva samo završno očitanje (`meter_end`, R5.1),
  pa je raspon brojila u dnevniku najmanje→najveće očitanje DANA. Ranije je upit bacao
  `column mwl.meter_start does not exist` — nađeno F9 integracionim testom.

## Faza 8 — odluke koje se ne smiju izgubiti

- **Stanje zaliha je zbir kretnji, nikad kolona.** Nema `UPDATE quantity`; i popis (`COUNT`) ulazi
  kao kretnja razlike. Zato `stockOnHand` = Σ IN − Σ OUT, a `TRANSFER`/`COUNT` su neutralni u tom
  zbiru. Dupli izvor (`source_type`, `source_id`, `item_id`) je unikat — `STOCK_ALREADY_POSTED`.
- **Trošak servisa ide ili na projekat ili na mašinu.** Nalog sa projektom knjiži `project_id`;
  nalog bez projekta knjiži `project_id = NULL` uz `machine_id`. Jedan izvor = jedan red, pa isti
  rad ne može biti u projektu i u trošku mašine istovremeno.
- **Garancija ne briše trag.** Popravka u garantnom roku upisuje red sa iznosom `0` i napomenom —
  posao je vidljiv u historiji, a firma ne plaća drugi put. Preskakanje reda bi značilo da
  garancijska popravka ne postoji, pa bi trošak po satu rada bio lažno manji.
- **Istek preventive je upozorenje, ne blokada.** `block_on_overdue_maintenance` (default `false`)
  uključuje strogu blokadu dodjele i radnih sati; **gorivo se ne blokira** nikad — mašina koja
  stoji zbog papira ne smije ostati bez goriva na gradilištu.
- **Odobrenje je drugi par očiju, ne mehaničarev.** Prag je `service_approval_threshold_cents`
  (default 500 KM, **odvojen** od praga kvara) i poređenje je **strogo `>`**. Vanjski servis iznad
  praga traži ponudu prije odobrenja — odobrava se iznos koji je neko ponudio.
- **MTBF broji KVAROVE, ne naloge.** Preventivni nalog nije kvar; `ReliabilityOrder.isFault`
  filtrira u domeni (ne u SQL-u), jer bi preventiva inače oborila MTBF i pokvarila odluku o
  zamjeni mašine. MTTR je u minutama, MTBF u satima — jedinice su u natpisu, ne u glavi čitaoca.
- **Tolerancija pomjera prag, ne rok.** Sa 10 % tolerancije na interval 250 h upozorenje počinje
  oko 225 h; stanje je tada `DUE_SOON`, a `OVERDUE` nastupa tek prelaskom roka.
- **Telefon ne računa trošak.** Sync stavka nosi namjeru (sati, dio), a `labor_cost`, `total_cost`
  i zaliha nastaju na serveru — istim funkcijama kao web. Dva uređaja tako ne mogu dati dva troška
  za isti rad; `actionId` je ključ idempotencije.
- **`NULLS LAST` u izboru kategorije troška.** `OSTALO` ima `default_for_source_type = NULL`, a
  Postgres u `DESC` poretku stavlja NULL prve — bez `NULLS LAST` bi svaki trošak (i servis) tiho
  završio u „Ostalo“. Nađeno testom `f8-service-sync`, ne u produkciji.
- **`ensureCostCategories` dopunjava, ne samo puni prazno.** Firma sa šifarnikom iz F5 nema
  `SERVIS`; rano vraćanje na „ima ijednu kategoriju“ bi ostavilo servis bez svoje kategorije.

## Faza 7 — odluke koje se ne smiju izgubiti

- **Devet statusa, nikad `DRAFT`.** Novi tender je `OPPORTUNITY`; `DRAFT` je ukinut i u matrici,
  registru i UI-u. Prelazi su **jedan izvor** (`tender-status.ts`) i parity test ih poredi sa
  `.cursor/docs/matrices/tenders/MATRIX.md` — dodat status u matricu bez koda pada CI.
- **Kapije su uslov prelaza, ne savjet na ekranu.** `PREPARATION` traži `participate = true`,
  `SUBMITTED` traži rok dostave **i** kompletnu kontrolnu listu, a izlazni statusi (`WON`/`LOST`/
  `WITHDRAWN`/`CANCELLED`) traže zapisan ishod koji se **poklapa** sa statusom. Sve četiri
  provjere su u `changeStatus` i testirane protiv prave baze.
- **Revizija cijene je append-only i odobrenje je odvojeno pravo.** Triger u bazi odbija UPDATE
  (`TENDER_PRICE_REVISION_IMMUTABLE`); prag odobrenja je `|promjena| > 5 %` ili marža ispod
  `companies.min_markup_pct`. Prva revizija nema prethodnu vrijednost, pa prag promjene nema od
  čega da se mjeri — odobrenje tada traži samo marža.
- **Popust je u stotinkama procenta, ne u procentima.** `discountPct: "10"` je 10 %;
  `paidValue` formula `base × (1 − discount)` radi u `bigint` centima, bez `float`.
- **ACCOUNTANT ne dobija kalkulaciju ni u podacima ni u UI-u.** `markupPct` je `null` u odgovoru,
  a `GET …/calculation` vraća `FORBIDDEN`; tab „Kalkulacija“ se ne prikazuje. Sakriti broj u
  ekranu, a poslati ga u JSON-u, nije skrivanje.
- **Konverzija je „sve ili ništa“ i ide tačno jednom.** Claim je `UPDATE … WHERE converted_project_id
  IS NULL` uz `ConvertClaimLost`; dva istovremena zahtjeva ostavljaju **jedan** projekat, a drugi
  dobija `ALREADY_CONVERTED`. Prilozi se **ne premještaju**: nastaju nove veze na isti `object_key`.
- **Kontrolna lista se puni iz šifarnika lenjo, ne u migraciji.** `ensureChecklistTemplates` je
  idempotentan; `ATTACHED` bez priloga i `NOT_APPLICABLE` bez razloga ne prolaze, jer bi inače
  „kompletno“ značilo samo „neko je kliknuo“.
- **Tenderski rok vodi na tender, ne na `/rokovi/:id`.** Worker podsjetnik za `TENDER_*` obavezu
  nosi `href = /ured/tenderi/{id}` i labelu „Tender — naslov“; bez toga bi podsjetnik glasio
  „firma“ i vodio na ekran koji tender ne poznaje.

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

## Korak 0 (prije Faze 6) — šef gradilišta, timer i strogi `FINISHED`

Tri odvojena nalaza; sva tri su bila **tiha** (ekran zelen, podatak pogrešan), pa ih čuvaju testovi.

| # | Nalaz | Popravka |
|---|---|---|
| 1 | `SITE_SUPERVISOR` nije mogao potvrditi status zadatka (`PATCH /api/tasks/{id}` je tražio `projects.manage`, koji šef nema). Davanje pune dozvole bilo bi pogrešno: šef bi mogao preusmjeriti tuđi zadatak. | Nova dozvola **`tasks.update_status`** [OWNER, ADMIN, PM, SITE_SUPERVISOR]. Ruta bira dozvolu **prema sadržaju zahtjeva**: samo `status` → `tasks.update_status`, bilo šta drugo → `projects.manage`. Servis (`saveTask`) ponavlja provjeru (odbija `title`/`projectId`/`phaseId`/`dueOn`/`priority`/`assignee*` → `FORBIDDEN`) i provjerava opseg preko `visibleProjectIds` — šef mijenja status **samo na projektima na koje je raspoređen**; zadatak bez projekta ostaje u redu ureda. |
| 2 | **Grupna potvrda šefa (`bulkConfirm`) nije knjižila trošak rada** — samo je mijenjala status dana. Tok mobilnog timera ide baš kroz nju, pa su sati potvrđeni „jednim klikom“ ostajali bez troška, a dan je bio zelen. | `bulkConfirm` sada zove `bookWorkdayCost`, isto kao pojedinačna potvrda. Idempotentno: `PENDING` bez satnice ostaje `PENDING` (iznos `NULL`, ne nula), ponovni poziv ne pravi drugi red. |
| 3 | Storno na `FINISHED` projektu vraćao je **500** (guard u bazi baca `PROJECT_CLOSED`, ruta ga nije mapirala). | Ruta `POST /api/costs/{id}/reverse` mapira `PROJECT_CLOSED` → **422** sa porukom „storno traži ponovno otvaranje uz razlog“. Guard se **zadržava**: nema storna ni novog knjiženja dok se projekat eksplicitno ne otvori (`reopen_reason` ≥10 znakova, `project.reopened` u auditu). |

**Komentari i prilozi** ostaju na `projects.view` — komentar je append-only zapis, ne izmjena
zadatka; šef ga time ima bez `projects.manage`.

Testovi: `task-service.test.ts` (+4), `workday-timer-cost.integration.test.ts` (3, prava baza),
`project-close-storno.integration.test.ts` (2, prava baza).

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
pnpm test       639 prošlo, 338 preskočeno bez baze (web 277 + domain 226 + mobile 93 + contracts 21 + worker 22)
                SA bazom (REQUIRE_DB_TESTS=1): **1072 testa** — web 627/627 (107/107 fajlova),
                domain 226, mobile 103, contracts 21, worker 25, db 70 — nula preskočenih
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

## Faza 6 — odluke koje se ne smiju izgubiti

- **Sat se nikad ne plaća dvaput.** Kategorija je JEDNA po minuti, po prioritetu
  `PRAZNIK > NEDJELJA > NOĆNI > PREKOVREMENI > REDOVNI`. Noćni sat preko praga ostaje `NOCNI`, a
  zbir kategorija je uvijek jednak ukupnim satima — to i testira `payroll-hours.test.ts`.
- **Nema izmišljenog noćnog prozora.** Firma bez `night_from`/`night_to` nema noćnih sati; ne
  postoji „default 22:00–06:00“. Isto važi za svaku stopu: **nijedan zakonski procenat nije u
  kodu**, sve su `payroll_parameters` sa datumom važenja.
- **`OVERTIME_MULTIPLIER = 1.0` je neutralni množilac, ne stopa.** Dolazi s firmom (u
  `ensureComponents()`), jer bi bez njega svaki prekovremeni sat bio `PARAMETER_MISSING` — a to
  nije nedostatak podatka, nego odsustvo uvećanja. Uvećanje unosi računovodstvo.
- **Nedostajuća satnica ili parametar daje liniju BEZ iznosa, nikad nulu.** `RATE_MISSING` /
  `PARAMETER_MISSING` blokiraju odobrenje, a ekran prikazuje crticu i razlog; djelimičan zbir se
  ne prikazuje (`null`, ne zbir „ostalih“).
- **Satnica se čita NA DAN RADA**, iz `worker_rates` po važenju — ne trenutna. Promjena satnice
  zato ne prepisuje stari obračun.
- **Izračun je nova revizija, ne prepisivanje.** `payroll_runs`/`payroll_run_lines` su zamrznuti
  `payroll_freeze_guard`-om; stara revizija ostaje čitljiva sa istim iznosima.
- **Zaključan period se NE preračunava.** Izmjena dana u `LOCKED` periodu otvara `pay_corrections`
  red (triger `workdays_open_correction`) koji se primjenjuje u NAREDNOM periodu.
- **Odbici ne stvaraju negativan obračun.** Naplaćuje se do nule, ostatak ostaje u
  `worker_advances.remaining_cents`. Granica se mjeri prema zaradi TOG radnika — ne prema zbiru
  firme, jer tuđa zarada nije njegov dug.
- **Trošak rada nastaje jednom po danu i projektu.** Knjiži se kroz postojeći `bookWorkdayCost`
  (izvor `WORKDAY` + `workday_id:project`), pa ponovni izračun samo preskače postojeći red.
  Greška u knjiženju ne obara obračun — novac radnika je važniji od šifarnika kategorija.
- **Samoodobravanje je zabranjeno** (`SELF_APPROVAL_FORBIDDEN`) — računovođa koji je i radnik u
  obračunu ne odobrava svoj period.
- **Radnik vidi svoje, tuđe nikad.** `payroll.own.view` daje sate po danu uvijek, a iznose tek kad
  je period `APPROVED`/`LOCKED`; tuđi ID perioda vraća **prazan skup**, a ne `NOT_FOUND` (razlika
  bi odala da period postoji u drugoj firmi).
- **Šifarnik komponenti nastaje LENJO** (`ensureComponents`), ne u migraciji: `created_by` je
  NOT NULL i pokazuje na stvarnog korisnika, pa bi popunjavanje unaprijed držalo RESTRICT veze ka
  `users`/`companies` za firme koje obračun nikad nisu otvorile.
- **Izvoz je default samo `LOCKED`.** XLSX nosi dva lista (`OBRAČUN` + `RASPIS`) i
  `export_format_version = OBRACUN-1`; „provizorno“ (uključi `FOREMAN_CONFIRMED`) je eksplicitno i
  označeno u zaglavlju, da se isti dan ne izveze dvaput kroz dva statusa.

## Namjerno još nema

- `budget.thresholds` je isporučen u Fazi 5; ostali worker poslovi dolaze sa modulima koji traže
  svoje tabele. (`sync.purge` je isporučen u Fazi 3.)
- Email/push provajder: isporuka je `BLOCKED_NO_PROVIDER`, in-app radi bez njega.
- `report_jobs`, `daily_rollups` — tabele i kostur postoje, poslovi dolaze sa izvještajima (Faza 7).
- **Bruto→neto** (doprinosi, porez, olakšice, platni listić PDF, uplatni nalozi, bankovni izvoz) je
  **van opsega F6** po spec 07 §5 — traži pisanu potvrdu računovođe i paralelni probni obračun.
  `payroll_run_lines.gross_cents`/`net_cents`/`contributions` ostaju prazni u MVP-u.

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
