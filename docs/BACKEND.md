# BACKEND.md — Gradix API

> **Izvor istine za backend.** Konsoliduje pravila iz penzionisanih `DECISIONS.md`,
> `PLAN_FREEZE.md` i matrica koja su i dalje važeća. Gdje pravilo nije provjereno u kodu
> označeno je `❓` (ulazi u odgovarajući BE segment).

**Stack:** NestJS 11, TypeScript (strict), Prisma 7 + `@prisma/adapter-pg`, PostgreSQL,
Argon2id, MinIO SDK, Socket.IO, Swagger.
**Obim:** 16 modula, 40 kontrolera, **166** HTTP ruta, ~16.000 LOC u `src/`.

---

## 1. Struktura

```
backend/src/
  main.ts                 — bootstrap (listen na PORT)
  app.module.ts           — kompozicioni korijen + globalni guardovi
  app.setup.ts            — prefiks api, Helmet, CORS, ValidationPipe, filter, envelope, Swagger
  common/
    constants.ts          — sve poslovne konstante (limitovi, TTL, cron izrazi)
    decorators/           — @Public, @CurrentUser, @RequirePermissions, @TenantRoute, @SkipEnvelope
    dto/                  — PaginationQueryDto
    errors/               — AppError + ERROR_CODES (zatvoren katalog)
    filters/              — AppExceptionFilter
    guards/               — 5 globalnih guardova
    interceptors/         — EnvelopeInterceptor
    rbac/                 — role, permisije, mapiranje rola → permisije
    scope/                — vidljivost podataka (po firmi / po dodjeli)
    settings/             — registry podešavanja firme + defaulti
    utils/                — pagination, password, phone, slug, storage-path, decimal-input
  modules/
    auth users companies settings notifications files audit health mail realtime
    ops/  (projects, tasks, timer, phases, assignments, quantities, amendments, trips,
           fuel, machines, gps, locations, diary, incidents, catalog, sync, dashboard, iot)
    payroll  polish (tenders, service, documents, reports)  public  erp  prisma
```

---

## 2. API ugovor (ne mijenja se bez odluke vlasnika)

### 2.1 Envelope

```jsonc
// uspjeh
{ "success": true, "data": { /* … */ }, "meta": { "page": 1, "limit": 20, "total": 42 } }
// greška
{ "success": false, "error": { "code": "TIMER_ALREADY_OPEN", "message": "Timer already open" } }
```

- `code` je **stabilan string** (klijent prevodi po kodu), `message` je EN fallback.
- Katalog kodova: `src/common/errors/error-codes.ts`. **Novi kod = izmjena kataloga + ovog docs-a.**

### 2.2 Paginacija i filtriranje

| Param | Pravilo | Dokaz |
|---|---|---|
| `page` | default `1`, mora biti ≥ 1 | `common/utils/pagination.ts` |
| `limit` | default `20`, max `100` | `common/constants.ts:6-7` |
| `sort`, `order` (`asc`/`desc`), `q` | opciono | `common/dto/pagination-query.dto.ts` |
| prekoračenje | `400 PAGINATION_LIMIT` | `pagination.ts:26-31` |

### 2.3 Autentikacija i autorizacija

- `Authorization: Bearer <access>` — access traje **15 min** (`ACCESS_TTL`), refresh **30 dana**.
- JWT nosi **samo `sub`**; role/permisije/firma se čitaju iz baze.
- **Refresh token je neproziran** (48 slučajnih bajtova, base64url); u bazi stoji samo `sha256`
  hash (`RefreshToken.tokenHash`), pa `JWT_REFRESH_SECRET` ne postoji (D-029).
- **Rotacija na svaki refresh:** stari token se opoziva, izdaje se novi par. Ponovna upotreba već
  opozvanog tokena gasi **sve** sesije korisnika (`401 AUTH_REFRESH_REUSE`) — znak krađe.
  Uslovni opoziv i kreiranje zamjene su jedna transakcija, pa isti token ne može izdati dva
  nasljednika. Izdavanje, rotacija i opoziv koriste zajednički PostgreSQL row lock korisnika;
  reuse i opoziv su u istoj transakciji. Nova ispravna prijava poslije opoziva je dozvoljena.
  Pojedinačni logout opoziva porodicu tokena iste prijave, uključujući potomke nakon rotacije,
  bez odjave drugih prijava. Postojećim aktivnim tokenima porodica se dodjeljuje pri prvoj
  rotaciji; stari već rotirani tokeni bez veze s potomkom ne mogu se retroaktivno povezati.
  Čišćenje starih redova uklanja mogućnost odjave preko obrisanog pretka; stari serveri
  u miješanom deploymentu ne prate porodicu ni zajednički lock. Ponovna upotreba opozvanog
  tokena i dalje opoziva sve sesije. Promjena lozinke i administratorski reset atomski
  mijenjaju hash i opozivaju sesije pod user lockom; promjena lozinke provjerava i da
  prethodno potvrđeni hash nije promijenjen dok se čekao lock. Deaktivacija korisnika i
  opoziv njegovih refresh tokena također su jedna transakcija; naknadno zatvaranje timera
  i audit nisu dio te transakcije. Ponovljeni zahtjev za deaktivaciju ponovo pokušava
  zatvoriti timere. Deaktivacija firme i opoziv njenih refresh sesija su u jednoj
  transakciji s ekskluzivnim lockom firme; izdavanje i rotacija uzimaju dijeljeni lock
  firme prije korisnika. Status firme se provjerava nakon locka. Ovaj protokol traži
  kooperativne servere iste verzije; audit i zatvaranje timera ostaju izvan transakcije,
  a access JWT traje do isteka. Postojeće pravilo dozvoljava PLATFORM_ADMIN-u refresh
  i kada mu je povezana firma deaktivirana.
- Refresh se odbija i kad je korisnik deaktiviran, firma ugašena ili korisnik ostane bez rola
  (`evaluateRefreshToken`, `auth-token-rules.ts`). Dnevni cron u 03:00 briše istekle tokene i
  opozvane starije od `REFRESH_RETENTION_DAYS` (7 dana).
- `POST /auth/reset` vraća **501 `AUTH_RESET_NOT_AVAILABLE`** — reset preko emaila nije implementiran
  (nema modela reset tokena ni prave dostave); ADMIN resetuje lozinku kroz `POST /users/:id/reset-password`.
- `@Public()` isključuje `JwtAuthGuard` (health, login, refresh, forgot/reset, javni sajt, IoT ingest).
- Permisije: `@RequirePermissions('…')`, efektivno = **unija** permisija svih rola korisnika.
- **Pisanje po projektu:** vidjeti projekat (npr. preko dodjele na zadatak) nije isto kao
  pisati po njemu — svaka izmjena traži `assertScopedWrite` (dodjela na projekat ili
  company-wide rola). Količine (`executedQty`) su do BE-05 bile izuzetak.
- **Novac i količine** stižu kao string i validiraju se (`common/utils/decimal.ts`) — `"abc"` je
  `400`, a ne 500 iz Prisma `Decimal`.
- **Hijerarhija (D-030):** `users.write` ne dozvoljava upravljanje nalogom sa višom rolom — samo
  `SUPER_ADMIN`/`PLATFORM_ADMIN` diraju SUPER_ADMIN naloge, a `PLATFORM_ADMIN` se ne dodjeljuje
  kroz tenant rute (`common/rbac/role-hierarchy.ts`).
- Tenant: `@TenantRoute()` + header `X-Company-Id` — **samo** za `PLATFORM_ADMIN`.
- `mustChangePassword` ⇒ dozvoljeni su samo `/me`, change-password i logout(i); ostalo
  `403 AUTH_PASSWORD_CHANGE_REQUIRED`.

### 2.4 Rate limiting

Globalno 120 req/min (`ThrottlerModule`), po ruti preciznije (INF-07: brojač je u Redisu kad je
`REDIS_HOST` zadat — limit važi između replika; bez Redisa/memorijski i dalje radi, D-039):

| Ruta | Limit |
|---|---|
| `POST /auth/login` | 5/min |
| `POST /auth/refresh` | 20/min |
| `POST /locations` (GPS telefona) | 1 / 15 s po korisniku |
| `POST /machines/:id/gps` | 1 / 5 s |
| `POST /iot/gps` | 1 / 5 s |
| `GET /public/*`, `GET /settings/public` | 60/min |

---

## 3. Moduli — odgovornosti

| Modul | Ruta (prefiks) | Odgovornost |
|---|---|---|
| `auth` | `/api/auth` | login, refresh (rotacija + reuse detekcija), logout/logout-all, change-password, forgot/reset |
| `users` | `/api/users` | CRUD, role (hijerarhija D-030), temp lozinka (jednom), reset-password, deaktivacija (gasi timer + revoke) |
| `companies` | `/api/companies`, `/api/company` | tenant CRUD (PLATFORM_ADMIN); `GET /company` traži `settings.read`, `PATCH /company` traži `settings.write`; slug immutable |
| `settings` | `/api/settings` | registry podešavanja firme (`PUT` je atomski: validacija svih ključeva pa jedna transakcija); javni `GET /settings/public` maskira `SECRET` |
| `notifications` | `/api/notifications` | in-app lista, read; emisija preko Socket.IO |
| `files` | `/api/files` | upload/download (MinIO), path guard `{companyId}/`, MIME sniffing + veličina, download nosi `Content-Type`/`Content-Length`/`nosniff`; pristup je **po firmi** (bez ACL-a po fajlu — D-032) |
| `ops` | `/api/projects`, `/tasks`, `/timer`, `/trips`, `/fuel`, `/machines`, `/diary`, `/hse`, `/catalog`, `/sync`, `/dashboard`, `/iot` … | jezgro operacija na terenu; zadaci: `?status=` iz zatvorene liste (`400` na nepoznat), duplikat dodjele/zavisnosti je `409`; timer: zatvaranje/pauza/nastavak su transakcije (sesija + minuti + status zadatka), `/timer/me` i `GET /timer` ne vraćaju `deviceId`/`localId`, `GET /timer` daje `elapsedMinutes`; ispravke (`/amendments`): `entityType` iz zatvorene liste, primjena + zapis ispravke su jedna transakcija; flota: koordinate se validiraju (`-90..90`/`-180..180`), jedna otvorena dodjela po mašini (`409`), GPS tačka + pozicija mašine su jedna transakcija; logistika: ture/gorivo/šifarnici — koordinate ture i depoa se validiraju, gorivo + `currentSpend` su jedna transakcija, offline identitet se upisuje u istom `create`; tura i gorivo su **nepromjenjivi** (`complete` je jedina izmjena ture; ispravke idu kroz `/amendments`) |
| `payroll` | `/api/payroll` | obračun po mjesecu, approve/reject, export `.xlsx` |
| `polish` | `/api/tenders`, `/services`, `/documents`, `/reports` | tenderi, servis mašina, istek dokumenata, fiksni izvještaji |
| `erp` | `/api/partners`, `/costs`, `/warehouses`, `/stock` | partneri, troškovi, lager |
| `public` | `/api/public` | javni one-page (whitelisted DTO, keš 60 s) |
| `audit` | — | `AuditEvent` (zatvoren skup akcija); **best-effort**: pad upisa se loguje i ne ruši zahtjev (D-031) |
| `realtime` | `/socket.io` | JWT handshake; sobe `user:{id}`, `company:{id}`, `companywide:{id}`, `project:{id}` (server-side) |
| `health` | `/api/health`, `/api/ready` | liveness (bez baze) vs readiness (Postgres + MinIO + migracije, `503` kad nešto nije spremno); ravan JSON bez envelope-a, detalj greške se ne vraća (§4.14) |
| `mail` | — | **stub** (vidi §7) |

---

## 4. Poslovna pravila (konsolidovano, važeća)

### 4.1 Tenant i firme
- Svaki poslovni zapis nosi `companyId`; liste su **uvijek** scope-ovane.
- Firma: `name`, `slug` (`[a-z0-9-]{3,40}`, unique, **immutable**), `legalName`, `address`,
  `city`, `country` (default `BA`), `taxId`, `phone`, `email`, `logoPath`.
- `Company.isActive=false` ⇒ login usera firme `401 AUTH_COMPANY_INACTIVE`; PLATFORM_ADMIN i
  dalje vidi/uređuje firmu.
- Email korisnika je globalno unique, **uključujući deaktivirane** (ostaje zauzet).

### 4.2 Vidljivost projekata
| Rola | Šta vidi |
|---|---|
| ADMIN, SUPER_ADMIN, ACCOUNTANT, PLATFORM_ADMIN (izabrana firma) | svi projekti firme |
| PROJECT_MANAGER, SITE_SUPERVISOR | samo projekti gdje ima `ProjectAssignment` |
| WORKER, MACHINE_OPERATOR, DRIVER, MECHANIC | **bez** `GET /projects` liste; detalj samo ako je dodijeljen (DTO bez budžeta/troška/klijenta) |
| MECHANIC | sve mašine firme |

### 4.3 Timer
- Jedan otvoren session **po korisniku** (`409 TIMER_ALREADY_OPEN`, važi i dok je pauza) i
  **po mašini** (`409 MACHINE_IN_USE`).
- `startedAt` = server `now` (online); offline (mobile) klijent šalje uz dozvoljene boundove.
- **Pauza ne teče**: trajanje = `closedAt - startedAt - pauseAccum`.
- Zatvaranje zadatka (`tasks.write`) zatvara sve otvorene sesije + notifikacija.
- Cron `*/15 * * * *`: sesije otvorene > `timer.maxOpenHours` (default **12 h**) se
  force-zatvaraju (`TIMER_AUTO_CLOSED`).
- Na close: `Machine.currentWorkingHours += duration` (bez pauze).
- Korekcija zatvorenog sessiona ide kroz `Amendment` (`entityType=TIMER`, `durationMinutes`,
  obavezan razlog ≥ 5 znakova) — SS scoped / ADMIN.

### 4.4 Ture i gorivo
- DRIVER bira kamion: `TRUCK` + aktivna dodjela njemu (ili IDLE/ACTIVE na projektu).
- QR deponije i vagar su **opcioni**; istina je `quantity`.
- Poslije sync-a tura/gorivo su **immutable** (`TRIP_IMMUTABLE`); ispravke samo `Amendment`.
- `FuelEntry.projectId` obavezan ako mašina ima aktivnu dodjelu (`FUEL_PROJECT_REQUIRED`);
  `receiptPath` opcion.
- Gorivo **ne** skida `CISTERN` lager automatski (opciono `apply-stock` u ERP-u).
- Anomalija goriva: odstupanje > `FUEL_ANOMALY_PCT` (25 %) ⇒ notifikacija ADMIN/SUPER_ADMIN/ACC.

### 4.5 Dnevnik i HSE
- Dnevnik: unique `(companyId, projectId, datum u TZ firme)`; konflikt se rješava ručno;
  max **20** foto; PDF je interni dokument.
- HSE: **online-only**, max **5** foto, GPS (oba ili nijedan) + opis.
- HSE vidljivost (D-033): `hse.read` = firma ili dodijeljeni projekti; `hse.write` bez `hse.read`
  (WORKER, DRIVER, MACHINE_OPERATOR) = **samo vlastite prijave**, i smiju ih ACK/CLOSE; tuđa
  prijava je `404` (ne otkriva postojanje).

### 4.6 Payroll
- Mjesec se računa u **TZ firme**; dan = kalendarski dan `startedAt` (nema splita preko ponoći).
- SS/PM **ne** odobravaju sebe (`PAYROLL_SELF_APPROVE`); radnik ne vidi platu (`403`).
- Odluka (odobri/odbij) je **atomska**: `updateMany` sa uslovom `approvalStatus = PENDING`;
  druga odluka na istu sesiju je `409 CONFLICT` (nikad tiho prepisivanje). Zapis ide u audit
  (`PAYROLL_APPROVED`/`PAYROLL_REJECTED`).
- Period: `year`+`month` (1970–2999) ili `from`+`to`; **najviše 366 dana** po zahtjevu.
  Neispravan kalendarski datum (`2026-02-31`) je `400`, ne tiho prebacivanje na mart.
- U satima **nema** pauze. Export `.xlsx` (ExcelJS), ime nosi period
  (`payroll-2026-11-01_2026-11-30.xlsx`); u tabeli su **samo** odobrene sesije, a `TOTAL` je
  suma odobrenih sati i iznosa.
- **Satnica je istorijska (B12, odluka D-035 = opcija A):** pri **zatvaranju** sesije
  `TimerSession.hourlyRateSnapshot` pamti tada važeću satnicu korisnika; iznos se od tada
  računa **isključivo** snapshotom (`payrollRate()`), pa povišica više ne mijenja starije mjesece.
  Snapshot piše jedina tačka zatvaranja (`TimerForceCloseService.closeSession` — stop, force,
  auto, sync replay). `null` (sesije iz perioda prije migracije) pada na trenutnu satnicu.
  Snapshot vrijedi i za `POST /cost-entries/from-payroll`.

### 4.7 Sync (mobile)
- Unique `(companyId, userId, deviceId, localId)` — idempotentnost push-a.
- `POST /api/sync/push` prima **najviše 200** itema (`SYNC_PUSH_MAX_ITEMS`); više je `400
  VALIDATION_FAILED` za cijeli batch. Klijent šalje u rezovima od 200 (`mobile/sync/engine.ts`).
- Item se obrađuje **po redu** (TIMER → TRIP → FUEL → DIARY → PHOTO zavisi od klijentskog reda);
  `PHOTO` prije svog `DIARY` zapisa je `404 'Diary entry not synced yet'` — namjerno.
- Greška jednog itema **ne obara batch** (`results[]` nosi `ok/code/message` po itemu). Poznate
  Prisma greške: unique (`P2002`) → `409`, nestali zapis (`P2025`) → `404`; paralelni replay
  istog `localId` se ponavlja jednom i vraća pobjednikov `serverId` (nema `500`, nema duplikata).
- `POST /api/sync/pull` vraća najviše **1000** redova **po kolekciji** (`SYNC_PULL_LIMIT`);
  `lastSyncTimestamp` je najmanji zadnji `updatedAt` među kolekcijama koje su nešto vratile
  (inače nepromijenjen `since`) — red na granici se šalje ponovo, nijedan se ne preskače;
  `serverTime` je trenutak odgovora. `since` u budućnosti ili neispravan datum → `400`.
- Katalog TTL **24 h**; sync odbija `DECOMMISSIONED` mašine i `ON_HOLD` projekte. Katalog je
  whitelist (`id/name/…`), bez `companyId` i vremenskih oznaka.

### 4.8 IoT
- **1 uređaj po mašini** (`IOT_DEVICE_EXISTS`); ključ se čuva kao Argon2id + SHA-256 lookup,
  plaintext se vraća **jednom** (create/rotate).
- `POST /api/iot/gps` sa `X-Device-Key`; nevažeći ključ `401`, deaktiviran uređaj `403`.
- GPS telefona ostaje `source=PHONE`, IoT je `source=IOT`.

### 4.9 Dashboard i prisustvo
- Jedan `GET /api/dashboard`; ko ga dobija zavisi **samo od rola**, po redu najširi → najuži:
  firma (`admin`) → PM/SS → DRIVER → WORKER/MACHINE_OPERATOR → MECHANIC (D-034).
  Korisnik sa više rola dobija dashboard **šire** role (prije je prva grana „upadala“).
- Prisustvo (`presence`) je „zadnja lokacija po korisniku“ u zadnjih **30 min** (`PRESENCE_MAX_MS`),
  jednim `DISTINCT ON` upitom (indeks `(companyId, userId, recordedAt)`); bez koordinata u odgovoru.
- **Dashboard** prikazuje svakoga iz firme ko je u geofence-u aktivnog projekta;
  **`GET /projects/:id/presence`** prikazuje samo **dodijeljene** tom projektu.
- `expiring`: dokumenti unutar `DOC_WARN_WINDOWS` (30/15/5 dana) **i istekli do 90 dana unazad**
  (negativan `daysLeft`), najviše 100 stavki, sortirano po hitnosti.

Napomena o planiranim datumima projekata, zadataka i faza: nepostojeći ISO kalendarski
datum (npr. `2026-02-31`, uključujući ISO datum s vremenom) vraća `400`, umjesto
JavaScript normalizacije u drugi mjesec. Ostali ranije prihvaćeni formati nisu mijenjani.

### 4.10 Ured (tenderi, servis, dokumenti, izvještaji)
- **Tender:** `DRAFT → SUBMITTED → WON|LOST`, `DRAFT|SUBMITTED → WITHDRAWN`; terminalni statusi i
  „preskakanje koraka“ su `409 TENDER_INVALID_STATUS`. Ime `submittedAt` mora biti ISO datum
  (`YYYY-MM-DD` ili datum i vrijeme) — neispravan kalendarski datum, i unutar vremenske oznake, je `400`, ne `500`.
- **Konverzija tendera** je atomska: projekat + (PM dodjela) + `convertedProjectId` idu u jednoj
  transakciji, a tender se zaključava `updateMany`-em (`status WON`, `convertedProjectId null`).
  Dva paralelna klika ⇒ **jedan** projekat, drugi dobija `409` (prije su nastajala dva).
- **Servis mašine:** životni ciklus je `PLANNED|SCHEDULED → IN_PROGRESS → COMPLETED|CANCELLED`;
  svaki prelaz je atomski claim (`updateMany` sa uslovom) u transakciji sa promjenom statusa mašine
  (`IN_SERVICE`, pa nazad `ACTIVE`/`IDLE` prema otvorenoj dodjeli) i `recalcSpend`. Dupli
  `complete`/`cancel` je `409`, mašina ne ostaje zaglavljena u `IN_SERVICE`.
- `projectId`/`templateId` servisa moraju pripadati **istoj firmi** (`400` inače) — prije je bila
  moguća cross-tenant referenca.
- **Dokumenti (compliance):** `expiresAt` prima datum `YYYY-MM-DD` ili datum i vrijeme; nepostojeći kalendarski datum, uključujući u vremenskoj oznaci, je `400` (prije se tiho
  pretvarao u `null`, pa je dokument bez roka izgledao kao trajan). Kreiranje/izmjena idu u audit
  (`DOCUMENT_CREATED`/`DOCUMENT_UPDATED`). Cron šalje `DOCUMENT_EXPIRING` u 08:00 lokalno, jednom
  po prozoru (30/15/5) i dokumentu — bez ponavljanja istog prozora.
- **Izvještaji:** fiksni slugovi (`project-spend`, `machine-hours`, `fuel-summary`, `trips-summary`,
  `tender-comparison`, `phase-quantities`); nepoznat slug je `404 REPORT_UNKNOWN`.
  `from`/`to` su kalendarski (TZ firme), default je **tekući mjesec**; obrnut period i period duži
  od **366 dana** su `400`. Export je `.xlsx` sa periodom u imenu
  (`report-<slug>-<from>_<to>.xlsx`). Svi izvještaji poštuju scope korisnika (`machine-hours` se
  filtrira preko projekta zadatka) — prije je PM vidio sate mašina sa svih projekata firme.
- Audit: `TENDER_CREATED/UPDATED/ATTACHMENT_ADDED/CONVERTED`, `SERVICE_CREATED/STARTED/COMPLETED/CANCELLED`,
  `SERVICE_TEMPLATE_CREATED/UPDATED`, `DOCUMENT_CREATED/UPDATED`.

### 4.11 Javni sajt
- Whitelisted DTO: naziv, grad, adresa, telefon, logo, tagline, javni projekti.
  **Bez** `taxId`, budžeta, potrošnje, koordinata i internih id-eva (unit test čuva listu polja).
- Isti `404` za tuđi i nepostojeći slug (bez enumeracije); neaktivna firma je takođe `404`.
- Javne slike (`LOGO`/`COVER`) idu kroz `GET /api/public/assets/:id` (ne kroz `?path=`):
  `Content-Type`/`Content-Length` iz MinIO-a, `X-Content-Type-Options: nosniff`,
  `CSP sandbox`, `Cache-Control: public, max-age=3600`; greška streama ruši odgovor umjesto da visi.
- `POST /api/public/assets` validira projekat **prije** uploada — nepostojeći projekat ne ostavlja
  orphan fajl/zapis. Dozvoljeni tipovi: `image/jpeg|png|webp` (provjera po potpisu, ne po imenu).
- Javni GET-ovi su ograničeni throttlerom (`PUBLIC_GET_LIMIT`/`PUBLIC_GET_TTL_MS`).

### 4.12 Notifikacije i realtime
- Notifikacije su in-app (`GET /api/notifications`, `PATCH /:id/read`, `POST /read-all`) i uvijek
  su **vlasništvo korisnika** (`userId` iz tokena, ne iz URL-a).
- `notifyRoles` za N korisnika radi jedan `createManyAndReturn` (nije više N `INSERT`-ova u nizu),
  pa po jedan `notification:new` emit po korisniku.
- Socket.IO (`/socket.io`) traži JWT u handshake-u (`auth.token` ili `Authorization: Bearer`);
  nevažeći/istekli token ili deaktivirana firma ⇒ odmah `disconnect`.
- Sobe: `user:{id}`, `company:{id}`, `companywide:{id}` (firma-wide role) i `project:{id}`.
  CORS gateway-a se ravna po **istom** pravilu kao REST (D-018) — prije je `origin: true`
  dozvoljavao svaki origin.
- Novi projekat dodaje firma-wide korisnike jednim `socketsJoin` nad sobom `companywide:{id}`
  (prije je iterirao **sve** socket-e procesa).

### 4.13 Email (B1, D-013)
- **SMTP transport ne postoji.** `features.email` je samo pripremljen flag; `EmailService.trySend`
  uvijek vraća `false` i loguje (debug) da poruka nije poslana — nijedan tok ne prijavljuje lažni
  uspjeh. `POST /auth/forgot` i dalje vraća `200 {"ok":true}` radi **anti-enumeracije**, ali je u
  dokumentaciji jasno da email nije poslan; `POST /auth/reset` je `501 AUTH_RESET_NOT_AVAILABLE`.
- Pravi email tok (SMTP kredencijali + reset token model) je zaseban posao, ne „popravka“ ovog.

---

### 4.14 Health (infrastrukturni ugovor)
- `GET /api/health` — **liveness**: `{ status: 'ok', uptimeSeconds }`, **ne** dira bazu. Na ovo je
  vezan Docker/Coolify `HEALTHCHECK`; pad baze zato ne pravi restart-loop žive aplikacije.
- `GET /api/ready` — **readiness** (INF-05): tri provjere, svaka sa tvrdim limitom **2 s**
  (`HEALTH_PROBE_TIMEOUT_MS`):
  - `postgres` — `SELECT 1`; `status:'ok'|'error'`, `latencyMs`, `error:'unreachable'`;
  - `storage` — MinIO `bucketExists` (isti kredencijali kao upload); uz `MINIO_SKIP=true` vraća
    `status:'ok', detail:'skipped'` (testovi/lokalno bez MinIO-a);
  - `migrations` — broj **završenih** redova u `_prisma_migrations` vs broj foldera u
    `prisma/migrations` u slici: `ok` (jednako ili više), `pending` (manje — `migrate deploy` još
    radi), `unknown` (folder ne postoji ili baza nedostupna).
  Odgovor: `200 { status:'ok', uptimeSeconds, checks:{…} }`, a ako je bilo koja provjera `error`
  ili `pending` → `503` sa `status:'error'` (tijelo nosi detalje provjera, ne konekcijske stringove).
- Obje rute su `@Public` (bez tokena) i **bez envelope-a** (`{status}` a ne `{data:{status}}`) —
  orchestration/monitor čita ravan JSON; greška se ne baca kao izuzetak nego kao status.
- Rute nisu izuzete iz globalnog throttle-a (120 zahtjeva/min po IP): healthcheck svakih 30 s je
  2/min, pa dozvola ostaje na snazi i za javne pozivaoce.

## 5. Validacija, greške i logging

- Validacija je **na granici** (DTO + `class-validator`), `whitelist` + `forbidNonWhitelisted`
  ⇒ nepoznata polja su `400 VALIDATION_FAILED`.
- Domenske greške: `throw new AppError(ERROR_CODES.X, message, status)`.
- `AppExceptionFilter` normalizuje sve u envelope; Neočekivane greške: `500 INTERNAL`.
- ⚠️ **Dug:** Prisma greške (`P2002` unique, `P2025` not found) se ne mapiraju centralno u
  domenske kodove — provjera po modulu u BE segmentima.
- ✅ **Env validacija (BE-01):** `backend/src/config/env.ts` se izvršava kroz
  `ConfigModule.forRoot({ validate })` **prije** nego što se podigne ijedan modul. Sve greške
  idu odjednom, sa imenom varijable; aplikacija ne starta sa pola konfiguracije.
- ✅ **Neočekivane greške se loguju** (JSON red sa imenom, porukom i skraćenim stack-om), a klijent
  dobija generički `500 INTERNAL_ERROR` — bez detalja implementacije.

### 5.1 Strukturisano logovanje (INF-04, D-038)

- **Jedan zapis = jedan JSON red** na stdout: `{ ts, level, context, msg, requestId?, …meta }`.
  Coolify/Docker `json-file` drajver ga parsira; `level` je `error|warn|info|debug`.
- **Korelacioni ID:** svaki zahtjev dobija `x-request-id` (validan klijentski/nginx ID se
  prihvata, inače `randomUUID`), vraća se u odgovoru i putuje kroz async lanac
  (`AsyncLocalStorage`), pa ga svaki log red u tom zahtjevu nosi kao `requestId`.
- **Bez PII i tajni:** log linija zahtjeva sadrži **samo** `method`, `path` (bez query stringa),
  `status`, `durationMs`; tijelo, headeri (osim validnog `x-request-id`), IP i query se ne loguju.
  Meta objekti prolaze kroz `redact()` — ključevi kao `password`, `token`, `authorization`,
  `cookie`, `apiKey`, `databaseUrl`, `email`, `phone`, `name`, `lat/lng` postaju `[redacted]`
  (i ugniježđeno), a dugački stringovi se skraćuju.
- **Nivo:** `LOG_LEVEL` (`error|warn|info|debug`); prazno = `info` u produkciji, `debug` u
  razvoju, `error` u testovima. Neispravna vrijednost je greška pri startu (validacija env-a).
- **Probe rute** (`/api/health`, `/api/ready`) se na uspjeh loguju kao **`debug`** — Docker/Coolify
  ih pogađa svakih 30 s, pa bi na `info` nivou proizvele ~2.900 identičnih linija dnevno; greška
  (5xx) ostaje `error`.
- Nest `Logger` u cijeloj aplikaciji piše kroz isti logger (`app.useLogger(new JsonLogger())`), pa
  nema „drugog“ formata; `console.log/debug` je i dalje zabranjen guardrail-om.
- **Zašto bez `pino`:** isti izlaz (JSON red + nivo) uz ~150 linija koda i **nula** novih
  zavisnosti (P6/D-006); ako zatreba transport/rotacija, `pino` se dodaje uz obrazloženje (D-038).

### 5.2 Redis: throttle storage i fail-open (INF-07, D-039)

- `RedisService` (`src/common/redis/`) drži **jedan** `ioredis` klijent za proces: TLS sa CA iz
  `REDIS_TLS_CA_FILE`, ACL korisnik `REDIS_USER` (default `gradix`), `lazyConnect` — start
  aplikacije ne čeka Redis. `onApplicationShutdown` radi `quit()`.
- `FailoverThrottlerStorage` zamjenjuje memorijski storage u `ThrottlerModule`: po zahtjevu
  `INCR` + `PEXPIRE NX` + `PTTL` u jednom `MULTI` nad ključem
  `<REDIS_PREFIX>throttle:<throttler>:<hash>`; rezultat se mapira u `totalHits/timeToExpire/
  isBlocked/timeToBlockExpire`.
- **Fail-open:** prazan `REDIS_HOST` ⇒ storage odmah koristi memoriju; greška u Redisu ⇒ isto,
  uz jedno `warn` logovanje. Nema `500` zbog Redisa i nema retry-petlje koja drži zahtjev.
- `/api/ready` dodaje `checks.redis` (`disabled` bez hosta, `ok`/`error` sa hostom) i **ne**
  vraća `503` zbog Redisa — on nije zavisnost bez koje API ne može.
- Redis se koristi **samo** za brojač; nikakvi poslovni podaci tamo ne idu (D-039).

---

## 6. Konfiguracija

Sve kroz env (katalog: [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) §5). **Validira se pri startu**
(`backend/src/config/env.ts`): obavezno u razvoju `DATABASE_URL`, `JWT_ACCESS_SECRET` (min 32) i
MinIO varijable (osim uz `MINIO_SKIP=true`); u produkciji **nema dodatne obavezne tajne** (refresh
token je hashiran u bazi, D-029); prazan
`CORS_ORIGIN` u produkciji znači **same-origin** (nikakav strani origin), a u razvoju „dozvoli sve“. `PORT` i `MINIO_PORT`
moraju biti cijeli brojevi 1–65535, `MINIO_USE_SSL`/`MINIO_SKIP`/`ENABLE_API_DOCS` su bool.
Swagger je u produkciji isključen osim `ENABLE_API_DOCS=true`.

Trenutno se čita:
`DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `MINIO_*`, `JWT_ACCESS_SECRET` (auth,
realtime), `MINIO_SKIP` (testovi), `JEST_WORKER_ID` (isključivanje cronova pod testovima).
`SEED_PASSWORD` se **ne** čita u `src/` (seed je zaseban proces). `REDIS_*` se čitaju od INF-07
(`RedisService`; grupa je validirana — host bez lozinke je greška pri startu). `JWT_REFRESH_SECRET`
više ne postoji kao varijabla (D-029).

---

## 7. Poznati dugovi (ulaze u BE segmente)

| # | Dug | Segment |
|---|---|---|
| B1 | ~~Email je lažni uspjeh~~ — ✅ djelimično (D-013, BE-16): `trySend` je sada iskren (`false` uz log, bez obzira na `features.email`), pa nijedan tok ne tvrdi da je poslano; `POST /auth/reset` ostaje `501`. **Prava dostava** (SMTP transport + reset token model) je zaseban posao | BE-16 / novi segment |
| B2 | Nema centralnog mapiranja Prisma grešaka | BE-03 |
| B3 | ~~Nema env validacije pri startu~~ — ✅ riješeno (BE-01, `config/env.ts` + 17 testova) | BE-01 |
| B4 | Samo 1 unit test (`timer-math.spec.ts`); nema coverage praga | TEST-01 |
| B5 | `common/scope/*` ponašanje nije pokriveno testovima | BE-04 |
| B6 | Swagger šeme nisu provjerene u CI-ju (nema „contract“ testa) | BE-05 |
| B7 | Nema `audit` UI-a u v1 (svjesno), ali `AuditEvent` se piše | — |
| B8 | ~~`AuditAction` bez akcija za projekat/dodjelu/fazu/dokument/količinu/zadatak~~ — ✅ riješeno (BE-08: 19 novih akcija + pozivi u `projects`, `assignments`, `phases`, `documents`, `quantities`, `tasks`, `task-assignees`, `task-dependencies`) | BE-08 |
| B9 | ~~`PATCH/DELETE /trips/:id` i `PATCH/DELETE /fuel/:id` su mrtve rute~~ — ✅ riješeno (BE-10, odluka vlasnika: **opcija A**) — rute, servisne metode i `Patch*Dto` uklonjeni; zapis je nepromjenjiv, ispravke idu kroz `/amendments` | BE-10 |
| B10 | ~~Flota, GPS uređaji, ture, gorivo i šifarnici nisu u auditu~~ — ✅ riješeno (BE-10: 17 novih akcija u migraciji `20261103160000_be10_fleet_audit_actions` + pozivi u `machines`, `gps-devices`, `trips`, `fuel`, `catalog`) | BE-10 |
| B11 | ~~Dnevnik, HSE i fajlovi nisu u auditu~~ — ✅ riješeno (BE-13: `DIARY_CREATED/UPDATED/PHOTO_ADDED/PDF_GENERATED`, `INCIDENT_CREATED/STATUS_CHANGED` u migraciji `20261103180000_be13_diary_hse_audit_actions`) | BE-13 |
| B12 | ~~Satnica u payrollu nije istorijska~~ — ✅ riješeno (BE-14, odluka vlasnika **D-035 = opcija A**: mjerodavan je trenutak rada/zatvaranja). `TimerSession.hourlyRateSnapshot` u migraciji `20261103190000_be14_payroll_snapshot_erp_audit`; `payrollRate()` = `snapshot ?? user.hourlyRate` | BE-14 |

---

## 8. Kako dodati novi endpoint (checklist)

1. DTO sa `class-validator` dekoratorima (+ `PaginationQueryDto` za liste).
2. Servis: scope-ovan upit (`companyId` iz tenanta), transakcija gdje ima više zapisa.
3. `@RequirePermissions(...)` + `@TenantRoute()` gdje je tenant ruta.
4. Novi error kod u katalog (ako treba) — i u ovom dokumentu.
5. e2e test (sretan put + 1 negativan) u `backend/test/`.
6. Ažurirati `docs/BACKEND.md` §3 (tabela modula) u istom commitu.

### PATCH opcionih polja projekta

Za `code`, `locality`, `client` i `plannedBudget` izostavljeno polje ostavlja postojeću vrijednost; `null`, prazan string ili samo razmaci brišu je u bazu kao `null`. Budžet `0` je valjan; negativne i nevažeće decimalne vrijednosti nisu. Kod se normalizuje postojećim pravilima.

### Projektni dokumenti — sigurniji retry povezivanja

`POST /api/projects/:id/documents` prihvata opcioni `idempotencyKey` (UUID v4). Ista kombinacija projekta i ključa s istom putanjom i nazivom vraća postojeći dokument i pod paralelnim zahtjevima; promjena putanje ili naziva za isti ključ vraća `409 CONFLICT`. Ključ nije dio odgovora ni liste. Stari klijenti bez ključa zadržavaju postojeće ponašanje. Migracija dodaje nullable kolonu i jedinstveni indeks bez izmjene starih redova. Prava, zaključavanje projekta i provjera company prefiksa izvršavaju se i pri retryju.

Ovo štiti **povezivanje**, ne atomarnost MinIO uploada i baze: nepoznat ishod uploada, gubitak ključa pri reloadu i replay nakon brisanja još nisu riješeni (F-CI-05-15).
