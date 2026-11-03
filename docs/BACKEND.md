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

Globalno 120 req/min (`ThrottlerModule`), po ruti preciznije:

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
| `realtime` | `/socket.io` | JWT handshake, sobe `project:{id}` (server-side) |
| `health` | `/api/health` | `SELECT 1` → `{ process, postgres }` |
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
- **Dug (B12):** iznos se računa **trenutnom** satnicom korisnika, ne satnicom koja je važila kada
  je posao rađen — poslije povišice mijenjaju se i stari mjeseci.

### 4.7 Sync (mobile)
- Unique `(companyId, userId, deviceId, localId)` — idempotentnost push-a.
- Katalog TTL **24 h**; sync odbija `DECOMMISSIONED` mašine i `ON_HOLD` projekte.

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

### 4.10 Javni sajt
- Whitelisted DTO: naziv, grad, adresa, telefon, logo, tagline, javni projekti.
  **Bez** `taxId`, budžeta i GPS-a.
- Isti `404` za tuđi i nepostojeći slug (bez enumeracije).

---

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
- ✅ **Neočekivane greške se loguju** (`console.error` sa stack-om na serveru), a klijent dobija
  generički `500 INTERNAL_ERROR` — bez detalja implementacije.
- ⚠️ **Dug:** nema strukturisanog logovanja (JSON) ni korelacionog ID-a — INF-04 (pino).

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
`SEED_PASSWORD` i `REDIS_*` se **ne** čitaju u `src/` (seed je zaseban proces; Redis koristi
infrastruktura). `JWT_REFRESH_SECRET` više ne postoji kao varijabla (D-029).

---

## 7. Poznati dugovi (ulaze u BE segmente)

| # | Dug | Segment |
|---|---|---|
| B1 | Email je stub (`trySend` samo inkrementira brojač); zato je `POST /auth/reset` 501 | BE-02 (ostaje; pravi tok = novi segment) |
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
| B12 | **Satnica u payrollu nije istorijska**: iznos se računa `user.hourlyRate` u trenutku čitanja, pa povišica retroaktivno mijenja starije mjesece. Preporuka: `hourlyRateSnapshot` na `TimerSession` (upis pri zatvaranju sesije), payroll koristi snapshot uz fallback na trenutnu satnicu. Traži odluku (koji trenutak je mjerodavan) + migraciju | BE-14 |

---

## 8. Kako dodati novi endpoint (checklist)

1. DTO sa `class-validator` dekoratorima (+ `PaginationQueryDto` za liste).
2. Servis: scope-ovan upit (`companyId` iz tenanta), transakcija gdje ima više zapisa.
3. `@RequirePermissions(...)` + `@TenantRoute()` gdje je tenant ruta.
4. Novi error kod u katalog (ako treba) — i u ovom dokumentu.
5. e2e test (sretan put + 1 negativan) u `backend/test/`.
6. Ažurirati `docs/BACKEND.md` §3 (tabela modula) u istom commitu.
