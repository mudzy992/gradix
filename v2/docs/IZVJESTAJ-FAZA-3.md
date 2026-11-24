# Izvještaj — Faza 3: Evidencija rada (radno vrijeme + radnici)

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Spec:** `03-radno-vrijeme-sync.md`, `04-radnici.md`

Faza 3 je isporučena kao **kompletna vertikala**: baza → domena → ugovor → API → web → mobilni →
worker → testovi. Nijedan sloj nije ostavljen kao „doći će poslije“.

---

## 1. Šta je napravljeno

### 1.1 Baza (2 migracije: `20261124140000_f3_1_workdays_workers`, `20261124150000_f3_2_notification_href`)

| Tabela | Promjena | Zašto |
|---|---|---|
| `workdays` | `+ day_kind`, `absence_note`, `assignment_warning`; CHECK: izostanak **mora** imati napomenu | Izostanak bez objašnjenja je nedokaziv; baza ga ne prima ni kroz rupu u aplikaciji |
| `work_entries` | `+ tz_offset_minutes`, `segment_source` | Vrijeme segmenta se pamti sa zonom u kojoj je nastalo; `MANUAL`/`TIMER`/`SYNC` se razlikuju, jer ručni unos nije mjerenje |
| `work_entries` | `one_open_per_worker` → **`one_open_per_worker_per_day`** | Radnik ne može imati dva otvorena segmenta **istog dana**, a može imati otvoren jučerašnji (koji čeka odgovor) i današnji |
| `sync_conflicts` | `+ entity_type`, `entity_id` + backfill | Sukob do sada poznavao samo `work_entry_id`; sada pokriva svih 7 terenskih entiteta |
| `work_week_approvals` | `+ reviewed_snapshot` (JSONB) | Odluka o sedmici mora nositi **stanje u trenutku odluke**; bez toga se poslije ne može dokazati šta je odobreno |
| `worker_rates` *(novo)* | `EXCLUDE` po `(company_id, worker_id, rate_kind)` + triger `worker_rate_immutable_amount` | Dvije važeće satnice istog tipa su nemoguće; iznos se **ne mijenja** — cijena se zatvara i otvara nova |
| `worker_leave_entitlements` *(novo)* | `(company_id, worker_id, year)` unique | Saldo je po godini, ne jedan broj |
| `worker_issuances` *(novo)* | `returned_at`, `condition`, `returned_to` | Zaduženje se **ne briše**; povrat je datum |
| `ppe_templates` *(novo)* | `items` JSONB + `ppe_templates_items_guard()` | Postgres ne dopušta podupit u CHECK-u, pa validacija stavki ide u triger |
| `worker_history` *(novo)* | čitljiva vremenska linija | `audit_events` je pravni trag, ovo je UX sloj — dvoslojno namjerno |

Sve nove tabele: `FORCE ROW LEVEL SECURITY` + `tenant_isolation`, grantovi u `bootstrap/grants.sql`,
5 novih redova u `privilege-matrix.tsv`, `TENANT_TABLES` +5 u `check-tenant-sql`.

### 1.2 Domena (`packages/domain/src/workdays.ts`) — 20 testova

- `roundSegmentMinutes` / `sumSegmentMinutes` — **zaokruživanje po segmentu**, ne po zbiru dana.
- `forgottenDayOutcome` — tri izbora (`TIME` / `LAST_PING` / `UNKNOWN`), `UNKNOWN` **ne izmišlja** vrijeme.
- `workdayReviewState` → `OK | FORGOTTEN | UNKNOWN_END | OPEN_TODAY`.
- `consumesLeave` — samo `VACATION` ulazi u saldo; `HOLIDAY` je izostanak bez trošenja dopusta.

### 1.3 API — 23 rute (`ROUTES`, OpenAPI regenerisan)

**Radno vrijeme (6):** `POST /api/workdays/timer`, `GET /api/me/day`,
`POST /api/workdays/close-forgotten`, `GET /api/workdays/week`,
`POST /api/workdays/confirm-bulk`, `PATCH /api/workdays/{id}/kind`.

**Radnici (17):** kartica (`GET|PATCH /profile`), cijene (`GET|POST /rates`, `PATCH /rates/{id}/close`),
dopust (`GET|POST /leave`), zaduženja (`GET|POST /issuances`, `PATCH /issuances/{id}/return`),
OZO šabloni (`GET|POST /ppe-templates`, `PATCH|DELETE /{id}`), historija, odlazak, masovne izmjene.

**8 novih dozvola:** `workers.sensitive.view`, `workers.rates.view/manage`, `workers.leave.view/manage`,
`workers.issuances.view/manage`, `workdays.kind`.

**7 novih kodova greške:** `WORKDAY_ALREADY_OPEN`, `WORKDAY_FORGOTTEN`, `WORKDAY_LOCKED`,
`WORKER_SENSITIVE_FORBIDDEN`, `WORKER_HAS_ACTIVE_ISSUANCES`, `RATE_OVERLAP`.

### 1.4 Web

- `/ured/radnici/[id]` — kartica u 5 sekcija; **dozvola po sekciji**, a ne po stranici: `workers.view`
  otvara karticu, ali cijene traže `workers.rates.view`, a lični podaci `workers.sensitive.view`.
  Osjetljivo je `null`, ne prazan objekat — korisnik bez prava ne saznaje ni da polja postoje.
- `/ured/radni-dani/sedmica` — tabela radnik × dan, sume, CSV izvoz, grupna potvrda šefa.
  **Prazna ćelija nije nula**: dan bez podataka je prazan, izostanak ima naziv.
- Link sa liste radnika na karticu.

### 1.5 Mobilni — „Moj dan“ timer-first

- Jedno veliko dugme (`touchTarget = 56 dp`), akcija se izvodi iz stanja (`mainAction`).
- Početak/pauza/nastavak/kraj; **ručni unos iza „Unesi ručno“** — forma na vrhu bi pojela timer.
- Zaboravljen dan ide **prvi** i nudi tri odgovora.
- Crvena traka (`assignmentWarning`) **ne blokira** unos sati.
- Model razdvojen (`moj-dan-model.ts`) → 11 testova bez uređaja.

### 1.6 Worker

- **`sync.purge`** — briše `received_payload` razriješenih sukoba po retenciji. `OPEN` sukob se nikad
  ne čisti; briše se tijelo, red i odluka ostaju. `payload_purged_at` upisuje **baza** kroz namjenski
  prolaz guarda, ne posao.
- **Obavještenje radniku** pri razrješenju sukoba (`workday.conflict_resolved`), u istoj transakciji.
- **Filter sukoba po `entity_type`** (7 tipova).

---

## 2. Kapije (lokalno, 2026-11-23)

```
pnpm test            962 testa, sve prolazi
                     web 572 · domain 178 · mobile 86 · db 67 · contracts 21 · worker 21 · mobile-ekran 10
                     PostgreSQL integracijski: 326 (web) + 67 (db) izvršeno, 0 preskočeno
pnpm typecheck       6/6
pnpm lint            6/6 (0 error, 0 warning)
pnpm test:a11y       113 testa (axe, WCAG 2.1 AA, obje teme)
pnpm check-tenant-sql  606 upita / 58 tabela ✓
pnpm db:types:check  OK — 66 tabela u tipovima, sinhrono (67 u bazi; `schema_migrations` se ne generiše)
pnpm check-cycles    nema ciklusa
pnpm check-contrast  ✓   pnpm check-ui ✓   pnpm check-privacy ✓
pnpm check-expo      ✓   pnpm check-maestro ✓
pnpm --filter @gradix/contracts check   openapi.json ažuran (136 putanja / 172 metode)
preflight 001+002    OK
```

**Nove provjere koje su uhvatile stvarne greške u toku rada:**
- `nul-guard.integration.test.ts` (A1) — pao jer 23 nove rute nisu bile u `HANDLERS`; dodate.
- `nav.test.ts` (A4a) — pao jer `/ured/radni-dani/sedmica` nije bila dosegljiva; dodan link i izuzetak s razlogom.
- `check-tenant-sql` — pao na dinamičkom `WHERE` u `loadDayBy`; prepisano u dvije grane da `company_id` bude **vidljiv u tekstu** upita.

---

## 3. Odgovor za Coolify ENV

**Nema novih obaveznih varijabli.** Faza 3 ne uvodi nijednu novu ENV varijablu ni u web ni u worker.

### 3.1 Šta mora biti postavljeno (nepromijenjeno iz F2)

| Varijabla | Web | Worker | Napomena |
|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ | Aplikacijska rola `gradix_app`; `?sslmode=verify-full&sslrootcert=/etc/ssl/certs/coolify-ca.crt` |
| `DATABASE_ADMIN_URL` | ✅ (`RUN_MIGRATIONS=true`) | ⚠️ jako preporučeno | Workeru treba za `pgboss` šemu; migracije F3 idu kroz ovu konekciju |
| `AUTH_SECRET` | ✅ | ➖ | 48+ bajtova base64; **ne mijenjati** — rotacija obara 2FA i sve sesije |
| `RUN_MIGRATIONS` | `true` | ➖ | **Potrebno za ovaj deploy**: primjenjuje `20261124140000_f3_1_workdays_workers` i `20261124150000_f3_2_notification_href` (prepisuje stare `href='/moj-dan'`) |
| `BOSS_DATABASE_URL` | ➖ | ➖ | Samo ako je baza reda odvojena |
| `REMINDER_INTERVAL_MINUTES` | ➖ | ➖ | Nepromijenjeno; `sync.purge` ima **fiksni** raspored `30 3 * * *` (UTC) |

### 3.2 Šta deploy mora uraditi prije prve prijave

1. `RUN_MIGRATIONS=true` i jedan deploy — nova migracija se primjenjuje (idempotentno).
2. **Grantovi:** migracija sama ne mijenja prava. Ako deploy ne pokreće `bootstrap/grants.sql`
   automatski, pokrenuti ga jednom (`gradix_app` mora dobiti SELECT/INSERT/UPDATE na
   `worker_rates`, `worker_leave_entitlements`, `worker_issuances`, `worker_history`, i
   SELECT/INSERT/UPDATE/DELETE na `ppe_templates`). Simptom ako se preskoči:
   `permission denied for table worker_rates` na kartici radnika.
3. **Provjera:** preflight (`packages/db/preflight-checks/run.sh`) mora dati `OK 001` i `OK 002`.
   Ako padne na „tabela nije u matrici“, grant je izvan `privilege-matrix.tsv` — ne popravljati
   grant, nego matricu (matrica je izvor istine).
4. `db:types:check` u CI-ju mora biti zelen; lokalno je bio **crven** dok tipovi nisu regenerisani
   poslije migracije.

### 3.3 Šta NE treba dirati

- `AUTH_SECRET` — rotacija odjavljuje sve i ruši TOTP tajne.
- `DATABASE_URL` — F3 ne traži promjenu rola ni šema.
- Nema nove tajne, nema novog servisa, nema novog bucketa.

---

## 4. Odluke koje se ne smiju izgubiti

1. **Zaokruživanje je po segmentu.** `8 + 8` min uz `NEAREST 15` = **30** min, ne 15. Zaokruživanje
   zbira je „optimizacija“ koja mijenja novac; test to čuva (`zaokruživanje ide PO SEGMENTU`).
2. **Izostanak nije nula sati — izostanak je dan bez vremena.** Prelazak u izostanak sa otvorenim
   segmentom se **odbija** (`CONFLICT`), ne čisti tiho: brisanje bi izgubilo dokaz da je radnik
   tog dana ipak nešto radio.
3. **`UNKNOWN_END` je priznanje, ne greška.** Radnik koji ne zna kada je prestao dobija dan koji
   ured provjerava; sistem ne upisuje osam sati da bi polje bilo popunjeno.
4. **Cijena se ne mijenja, cijena se zatvara.** Novi iznos = novi red sa `validFrom`; stari dobija
   `valid_to`. Baza to brani trigerom, ne samo servis.
5. **Zaduženje se ne briše.** Povrat je `returned_at`; otpis je `condition = 'DAMAGED'` + razlog u historiji.
   „Radnik odlazi“ odbija radnika sa nerazduženom opremom (`WORKER_HAS_ACTIVE_ISSUANCES`).
6. **Upozorenje ne blokira.** Rad bez važeće dodjele i istekao ljekarski su **crvena traka**, ne
   blokada prijave dana — radnik je fizički na gradilištu i mora moći da upiše sate. Zato
   `WORKDAY_NOT_ASSIGNED` **nije** kod greške (nema ga u `ERROR_CODES`).
7. **`sync.purge` poštuje guard.** `payload_purged_at` piše baza, ne posao; posao šalje samo
   `received_payload = NULL` i to samo kad je `payload_purge_after` istekao.
8. **`OPEN` sukob se nikad ne čisti**, ma koliko star bio.
9. **Isto pravilo u bazi ima JEDAN mehanizam, i to onaj koji server može podnijeti.** Svako
   `EXCLUDE USING gist` traži `btree_gist`; ako ga nema, migracija ne smije pasti nego ostaviti
   triger sa `pg_advisory_xact_lock`. R3 je to poštovala za `project_assignments`, F3 nije za
   `worker_rates` — i to je oborilo korak „Preklapanje dodjela" na CI runu `45454051757`. Zato
   `check-preklapanje` od sada tvrdi mehanizam za **obje** tabele i da su isti, a servis prepoznaje
   oba oblika greške (`23P01` i `RATE_OVERLAP`). Migracija `20261124140000_f3_1_workdays_workers`
   je zato izmijenjena na mjestu: stara verzija je padala prije upisa u `schema_migrations`, pa
   naknadna migracija nije imala gdje da se primijeni; F3 nije bila van ove grane.
10. **`href` obavještenja je web ekran, ne mobilni.** Razrješenje sukoba je prvo pisalo
   `href: "/moj-dan"`; `/moj-dan` postoji **samo u mobilnoj aplikaciji**, pa je web inbox
   (`<Link>` + prefetch) pravio 404 u konzoli i oborio WORKER smoke na desktopu i mobilu.
   Putanje sada žive u `src/server/notification-hrefs.ts`, a `notification-hrefs.test.ts` traži
   da svaka ima `page.tsx` i da ta stranica ne vraća `/nemate-pristup` (primalac može biti svaka
   rola). Poruka radniku zato vodi na `/pregled` — jedini web ekran koji svaka rola otvara;
   „Moj dan“ ostaje mobilni ekran do Faze 4 (web verzija istog ekrana).

---

## 5. Dugovi (svjesno ostavljeni)

| Dug | Zašto nije sada | Kada |
|---|---|---|
| `budget.thresholds` posao | traži tabele budžeta | Faza 5/6 |
| Email/push provajder | isporuka je `BLOCKED_NO_PROVIDER`; in-app radi | kad se odabere provajder |
| Masovne izmjene nemaju UI | API i testovi postoje; radnika je 80, pa je prioritet bio timer i kartica | Faza 4 (UX prolaz) |
| `reviewed_snapshot` se puni, ali ga UI još ne prikazuje | podatak je tu za dokaz | Faza 4 |
| Maestro tok za „Moj dan“ timer | tok traži emulator u CI-ju | noćni workflow |
| `enrollmentRedirect` u `tenant-context.ts` neiskorišten | postojeći dug iz F1 | Faza 4 |
| „Moj dan“ nema web ekran | timer je mobilni (spec 03 §1.1.1); web obavještenje zato vodi na `/pregled` | Faza 4 |

---

## 6. Sljedeće

**Faza 4** po `docs/IMPLEMENTATION_PLAN.md`. Prije nje nema otvorenih kapija: sve gore navedeno je zeleno.

> **Ispravke poslije CI prolaza (2026-11-23).** Dva odvojena uzroka, oba popravljena na izvoru:
>
> 1. **Run `45450231464`** — E2E smoke pao samo za WORKER, 404 u konzoli zbog `href: "/moj-dan"`
>    (§4.9). Popravka: `workday-resolve.ts` + `notification-hrefs.ts` + kapija
>    `notification-hrefs.test.ts` + integracioni test koji čita stvarni red obavještenja + migracija
>    `20261124150000_f3_2_notification_href` (prepisuje stare redove).
> 2. **Run `45454051757`** — E2E je zelen (52 passed), ali je pao korak „Preklapanje dodjela — oba
>    mehanizma" jer je F3 migracija dodala **bezuslovni** `EXCLUDE USING gist` nad `worker_rates`:
>    na bazi bez `btree_gist` (ili pod prekidačem `gradix.bez_btree_gist`) migracija puca sa
>    „data type text has no default operator class for access method gist". R3 je za dodjele imala
>    fallback; F3 ga nije. Popravka: isti `DO $$ … $$` obrazac (EXCLUDE **ili** triger sa
>    `pg_advisory_xact_lock`, nikad oba), hvatanje oba mehanizma u servisu (`isRateOverlapError`),
>    jedinični `rate-overlap.test.ts`, integracioni test da baza odbija preklapanje i kad servis nije
>    taj koji provjerava, i `check-preklapanje` sada tvrdi mehanizam i za `worker_rates`.
>
> Broj testova: **962** (web 572; prije F3 popravki 562).
