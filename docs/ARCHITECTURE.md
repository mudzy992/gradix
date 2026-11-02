# ARCHITECTURE.md — Gradix

> **Izvor istine.** Ovaj dokument opisuje kako sistem **stvarno** radi. Sve što ovdje piše
> provjereno je u kodu ili u konfiguraciji; ako nešto nije provjereno, označeno je `❓` i
> otvara se kao nalaz u odgovarajućem segmentu.
>
> Vlasnik dokumenta: audit tim. Zadnja izmjena: 2026-11-02 (FAZA 1).

---

## 1. Kontekst sistema

Gradix je **multi-tenant operativni sistem za niskogradnju** (firme, projekti, ljudi, mašine,
sati, materijal, novac). Jedna instalacija opslužuje više firmi; podaci su striktno razdvojeni
po `companyId`.

| Površina | Korisnici | Tehnologija | Dokaz |
|---|---|---|---|
| Ured / admin panel | ADMIN, SUPER_ADMIN, PM, SS, ACCOUNTANT, MECHANIC | React 19 + Vite 8 (SPA), nginx u produkciji | `frontend/` |
| Teren (mobilna) | WORKER, MACHINE_OPERATOR, DRIVER, SS | Expo SDK 57 / React Native 0.86, offline-first | `mobile/` |
| Javni one-page firme | javnost (bez prijave) | SPA ruta `/p/:slug` + javni API | `frontend/src/pages/public-site-page.tsx`, `backend/src/modules/public/` |
| API | sve površine | NestJS 11 (REST + Socket.IO) | `backend/src/` |

**Izvan sistema (v1):** SMS, fiskalizacija/PDV, GL, e-faktura, auto-deploy, 2FA kao obaveza.
Odluke: [`DECISIONS.md`](./DECISIONS.md).

---

## 2. Glosar (minimalni zajednički jezik)

| Pojam | Značenje |
|---|---|
| **Firma / tenant** | `Company`; svaki poslovni zapis nosi `companyId` |
| **Projekat** | posao za naručioca; ima faze, geofence centar, budžet |
| **Faza** | isječak projekta (iskop, cijevi, asfalt) |
| **Zadatak** | nalog za teren; više ljudi može raditi na njemu |
| **TimerSession** | jedan radni interval (start/pauza/stop) sa trajanjem bez pauze |
| **Tura** | vožnja materijala: vozač + kamion + projekat + materijal + količina |
| **Amendment** | ispravka zatvorenog timera/ture/goriva sa obaveznim razlogom |
| **Presence** | zadnji GPS ping ≤ 30 min unutar geofence — informacija, **nije** dokaz za plate |
| **Predmjer** | plan vs. izvedeno po fazi; **ne** ulazi u % progres |
| **PLATFORM_ADMIN** | operator instalacije; nije zaposlenik firme (`companyId = null`) |

---

## 3. Komponente i tok zahtjeva

```
Browser (SPA)                Mobile (Expo)               Javni posjetilac
      │                            │                            │
      │  /api, /socket.io          │  /api (Bearer)             │  /api/public/:slug
      ▼                            ▼                            ▼
┌───────────────────────────────────────────────────────────────────────┐
│ nginx (frontend kontejner)  ── proxy ──▶  NestJS backend (port 3000)  │
│  • servira statički build   • /api, /socket.io                        │
└───────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      PostgreSQL (db_net)      MinIO (gradix-net)     Redis (redis_net)
      Prisma 7 + adapter-pg    fajlovi (S3 API)       ❗ v1 ne koristi
```

- **Frontend** je statički build; u produkciji ga servira `nginx` iz `frontend/Dockerfile`,
  koji proksira `/api` i `/socket.io` na `BACKEND_URL` (`http://backend:3000`).
- **Backend** je jedini proces sa pristupom bazi; mobilna aplikacija i SPA komuniciraju samo
  preko REST-a i WebSocket-a.
- **MinIO** čuva fajlove (foto dnevnika, HSE, dokumenti, logotipi); u bazi je samo putanja.
- **Redis** je prisutan u konfiguraciji i mreži, ali ga kod **ne** koristi (`grep -rn redis
  backend/src` → 0). Vidi `docs/INFRASTRUCTURE.md` §9.

---

## 4. Slojevi backenda

```
main.ts → app.module.ts (kompozicioni korijen)
   │
   ├── globalni guardovi (redoslijed je bitan)
   │     1. OptionalThrottlerGuard   — rate limit (default 120/min)
   │     2. JwtAuthGuard             — access token, obavezan osim @Public()
   │     3. PasswordChangeGuard      — mustChangePassword gate
   │     4. TenantGuard              — X-Company-Id samo za PLATFORM_ADMIN
   │     5. PermissionsGuard         — permisije iz DB (unija rola)
   │
   ├── ValidationPipe (whitelist, forbidNonWhitelisted) → AppError(VALIDATION_FAILED)
   ├── AppExceptionFilter            — jedinstven error oblik
   └── EnvelopeInterceptor           — { success, data, meta }
```

**Moduli** (16): `prisma`, `audit`, `realtime`, `health`, `auth`, `users`, `companies`,
`settings`, `notifications`, `files`, `ops` (najveći: projekti, zadaci, timer, flota, gorivo,
GPS, dnevnik, HSE, katalog, sync), `mail`, `polish` (tenderi, servis, dokumenti, reporti),
`public`, `payroll`, `erp`.

**Cross-cutting servisi:** audit (zatvoren skup akcija), notifikacije (in-app + Socket.IO sobe
dodijeljene server-side), storage (MinIO), scope helperi (`common/scope/*`) za vidljivost
podataka po roli.

Detalji i pravila: [`BACKEND.md`](./BACKEND.md).

---

## 5. Model podataka (pregled)

Šema je podijeljena u 6 Prisma fajlova (`backend/prisma/schema/`): `foundation`, `ops`,
`fleet`, `polish`, `erp`, `public` — 1.115 linija. Jedna aktivna migracija:
`20261102130000_init_postgres` (1.333 linija SQL-a).

| Grupa | Entiteti |
|---|---|
| Tenancy i identitet | `Company`, `User`, `UserRoleAssignment`, `Device`, `Setting`, `RefreshToken` |
| Projekti i rad | `Project`, `ProjectPhase`, `Task`, `ProjectAssignment`, `TaskAssignment`, `TimerSession`, `QuantityItem`, `ProjectDocument` |
| Flota i logistika | `Machine`, `MachineAssignment`, `Trip`, `Material`, `Depot`, `FuelEntry`, `GpsRecord`, `UserLocation`, `GpsDevice` |
| Teren i ured | `DiaryEntry`, `Incident` (HSE), `Tender`, `ServiceRecord`, dokumenti (firma/radnik/mašina) |
| Novac i lager | `Partner`, `CostEntry`, `Warehouse`, `StockMovement`, `Amendment` |
| Javno | `PublicAsset`, whitelisted polja firme i projekata |
| Ostalo | `Notification`, `AuditEvent` |

Konvencije: datumi u **UTC**, prikaz u `app.timezone` firme (default `Europe/Sarajevo`);
novac `Decimal` (BAM); ID-evi `cuid()`.

---

## 6. Sigurnosni model (pregled)

| Tema | Pravilo |
|---|---|
| Autentikacija | JWT access (15 min) nosi **samo `sub`**; role i firma se čitaju iz baze na svakom zahtjevu |
| Refresh | rotacija + detekcija ponovne upotrebe ⇒ revoke svih sesija (`AUTH_REFRESH_REUSE`) |
| Lozinke | Argon2id (min 10 znakova); promjena revokuje sve refresh tokene |
| Onboarding | temp lozinka se vraća **jednom** u create/reset odgovoru + `mustChangePassword` |
| Tenant | `X-Company-Id` samo za `PLATFORM_ADMIN`; bez headera ⇒ 403, sa headerom kao ne-platform ⇒ 400 |
| Autorizacija | permisije iz DB, unija rola; liste uvijek scope-ovane (firma + dodjele) |
| Transport | Helmet, CORS whitelist (`CORS_ORIGIN`), TLS prema bazi preko CA mount-a |
| Fajlovi | putanje moraju počinjati `{companyId}/`; MIME/veličina provjereni na granici |
| Tajne | samo kroz env; `.env` se ne commituje; u repou su predlošci |

Otvoreni dugovi (u planu, ne u ovom dokumentu): validacija env-a pri startu, secret scanning u
CI-ju, strukturisano logovanje.

---

## 7. Ključni tokovi

| Tok | Sažetak | Gdje |
|---|---|---|
| Prijava | login → access (memorija) + refresh (rotacija) → `/me` | `modules/auth/` |
| Onboarding radnika | ADMIN kreira usera → temp lozinka jednom → obavezna promjena → SS dispečuje zadatak | `modules/users/`, `modules/ops/tasks*` |
| Timer | start (server `now`) → pauza (ne teče) → stop (sati mašine) → cron auto-close 12 h | `ops/timer*`, `ops/machine-hours.ts` |
| Ture i gorivo | DRIVER evidentira → sync → immutable; ispravke kroz `Amendment` | `ops/trips*`, `ops/fuel*` |
| Dnevnik | SS piše dnevnik (unique firma+projekat+dan u TZ), foto do 20, PDF intern | `ops/diary*` |
| Payroll | mjesec u TZ firme → odobravanje (SS/PM ne sebe) → `.xlsx` export | `modules/payroll/` |
| IoT | uređaj šalje GPS sa `X-Device-Key` (1 uređaj po mašini) | `ops/iot*`, `ops/gps-devices*` |
| Offline sync (mobile) | lokalni red → push → pull katalog (TTL 24 h) | `ops/sync*`, `mobile/sync/*` |
| Javni sajt | `GET /api/public/:slug` — whitelisted DTO, isti 404 za tuđi/nepostojeći slug | `modules/public/` |

---

## 8. Deployment topologija (produkcija)

| Element | Vrijednost |
|---|---|
| Orkestracija | **Coolify**, Docker Compose resurs (`docker-compose.yml`) |
| Servisi | `backend` (port 3000, `expose`), `frontend` (nginx, 80, `expose`), `minio` (9000/9001, `expose`) |
| Mreže | `gradix-net` (bridge, interna) + `db_net` + `redis_net` (`external: true`) |
| Baza | **eksterni PostgreSQL** u `db_net`; migracije pri startu kontejnera |
| Storage | MinIO, podaci na hostu `/mnt/shared-app-files/gradix/minio` |
| TLS prema bazi | CA mapiran u kontejner + preflight u entrypointu |
| Host portovi | **nijedan** — Coolify proxy routa domene (blue/green deploy) |
| Seed | ručno, jednom: `node dist/prisma/seed.js` u backend kontejneru |

Detalji, env katalog i troubleshooting: [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md).

---

## 9. Ograničenja i principi

1. **Tenant izolacija je apsolutna** — nema upita bez `companyId` scope-a.
2. **Baza je PostgreSQL** (odluka D-001); Prisma je jedini put do nje (nema ad-hoc SQL-a van
   migracija).
3. **API ugovor je stabilan**: envelope, error kodovi, paginacija. Promjena ugovora traži
   odluku vlasnika.
4. **Vidljivo ponašanje se ne mijenja bez odobrenja** (pravilo 1 iz procesa rada).
5. **Mobile je offline-first**; svaka nova akcija mora imati definisano ponašanje bez mreže.
6. **Dokumentacija je izvor istine**; kod i dokument se mijenjaju u istom commitu.
