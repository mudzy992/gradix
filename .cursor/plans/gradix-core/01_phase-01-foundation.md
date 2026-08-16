# Faza 1 — Foundation (**LOCKED** 2026-08-15)

**Cilj:** Nest + MySQL + tenant + auth + settings + in-app notifications + upload + audit. Nema frontend/mobile, nema Project/Timer.

**Status plana:** zaključano. Izmjena = PLAN_FREEZE + ova faza + matrica + CHANGELOG. Kod tek na „izvrši Fazu 1“.

**Matrice:** `tenant`, `auth`, `rbac`, `permissions`, `settings`, `data-scope`, `upload`, `notifications`, `audit`

## Segmenti

### 1.1 Docker + Nest

- `docker-compose.yml`: MySQL 8 + MinIO (jedan bucket)
- `.env.example`: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MINIO_*`, `CORS_ORIGIN`, `SEED_PASSWORD`
- Nest strict, prefix `/api`, `GET /api/health` (process + MySQL ping)
- Helmet, CORS iz `CORS_ORIGIN`, `.gitignore`, Swagger `/api/docs` Bearer
- Throttle: login **5/min/IP**, refresh **20/min/IP**

### 1.2 Prisma 7

`backend/prisma.config.ts`. ID: `String @id @default(cuid())`. `createdAt`/`updatedAt` na svim.

- **Company:** name, slug `[a-z0-9-]{3,40}` unique immutable, isActive, legalName?, address?, city?, country default `BA`, taxId?, phone E.164?, email?, logoPath?
- **User:** firstName, lastName (1–80, obavezno), employeeCode? `@@unique([companyId, employeeCode])` `[A-Z0-9-]{1,20}`, email unique (i inactive), phone E.164 unique?, passwordHash Argon2id, companyId? (null samo PLATFORM_ADMIN), hourlyRate Decimal?, isActive, mustChangePassword, locale `bs`|`en` default `bs`. **Nema** `role` kolone.
- **UserRoleAssignment** `@@unique([userId, role])`. Role enum **cijeli v1:** PLATFORM_ADMIN, SUPER_ADMIN, ADMIN, PROJECT_MANAGER, SITE_SUPERVISOR, MACHINE_OPERATOR, DRIVER, WORKER, MECHANIC, ACCOUNTANT
- **RefreshToken:** tokenHash, expiresAt, revokedAt, userId (plaintext samo u response)
- **Device** `@@unique([userId, deviceId])` fcmToken?, lastSeenAt
- **Setting** `@@unique([companyId, key])` value Json, scope PUBLIC|PRIVATE|SECRET
- **Notification:** type = **cijeli v1 enum** (notifications matrica), title, message, data, isRead, readAt
- **AuditEvent:** action string iz audit kataloga Faze 1

Seed: Company `demo` (name+city); PLATFORM_ADMIN `platform@gradix.local` (ime Platform / Admin); SUPER_ADMIN `admin@gradix.local` u demo (ime Demo / Admin). Lozinke env, min 10, `mustChangePassword=false`. Default settings keys za demo.

### 1.3 Settings

Registry + DB. Secret GET masked. Socket `settings:updated`. Seed ključevi: currency BAM, timezone Europe/Sarajevo, dateFormat, features.email/push false, privacy.gpsNotice, public.* prazni, timer.maxOpenHours 12, geofence.defaultRadiusM 200. Nema SMS.

### 1.4–1.8

Auth/JWT/users/notify/upload/envelope: vidi API + matrice. Deaktivacija usera/firme: revoke refresh; **force-close timera no-op dok nema TimerSession (Faza 2).**

Argon2id (OWASP): memory 19456 KiB, time 2, parallelism 1. Access 15m (`sub` only). Refresh 30d, body JSON, hash u DB, reuse → revoke all.

Login: nepoznat user i loša lozinka → isti `AUTH_INVALID_CREDENTIALS`. Forgot/reset: uvijek 200 (nema enumeracije); SMTP stub.

`hourlyRate` write: samo `payroll.write`. PATCH `/me`: firstName, lastName, locale (ne email, role, rate, employeeCode). `/me` uključuje `company: { id, name, slug } | null`. `PATCH /api/company` (`settings.write`): pravna polja + logoPath; ne slug.

## API

| Method | Path | Auth |
|---|---|---|
| GET | `/api/health` | no |
| POST | `/api/auth/login` `refresh` `logout` `logout-all` `change-password` | vidi auth |
| POST | `/api/auth/forgot` `reset` | no (stub) |
| GET/PATCH | `/api/me` | yes |
| PATCH | `/api/company` | settings.write |
| PUT | `/api/me/fcm-token` | yes |
| GET/POST | `/api/users` | users.* |
| GET/PATCH | `/api/users/:id` | users.* |
| POST | `/api/users/:id/reset-password` | users.write |
| GET/POST | `/api/companies` | platform.companies |
| PATCH | `/api/companies/:id` | platform |
| GET/PUT | `/api/settings` | settings.* |
| GET | `/api/settings/public?slug=` | no |
| GET/PATCH | `/api/notifications` (+ read, read-all) | yes |
| POST/GET | `/api/files` | yes |

Liste: `page` default 1, `limit` 20 max 100, `sort`, `order`, `q` na users. Envelope + `error.code`. Access: `Authorization: Bearer`. Refresh: JSON body.

## Error codes

`AUTH_INVALID_CREDENTIALS` `AUTH_ACCOUNT_INACTIVE` `AUTH_COMPANY_INACTIVE` `AUTH_REFRESH_REUSE` `AUTH_PASSWORD_TOO_SHORT` `AUTH_PHONE_INVALID` `AUTH_EMAIL_TAKEN` `AUTH_PASSWORD_CHANGE_REQUIRED` `USER_PHONE_TAKEN` `TENANT_HEADER_FORBIDDEN` `TENANT_HEADER_REQUIRED` `TENANT_SLUG_INVALID` `TENANT_SLUG_IMMUTABLE` `PAGINATION_LIMIT` `VALIDATION_FAILED` `FORBIDDEN` `NOT_FOUND`

## Acceptance

`/me` = names, roles, permissions, companyId, company {id,name,slug}, own rate, mustChangePassword, locale, employeeCode; PLATFORM_ADMIN bez headera 403; WORKER+header 400; inactive email 409; password 9 → 400; create bez firstName → 400; temp password jednom; mustChangePassword blok; company inactive 401; reset-password; slug PATCH 409; ADMIN PATCH `/company` 200; forgot uvijek 200; refresh reuse revoke; logout ≠ logout-all; limit 101 → 400; `../` path 400; JWT bez role claim; cross-tenant 404/403; prazan roles 400; WORKER 403 POST users; WORKER+ADMIN 201; hourlyRate PATCH kao WORKER+users 403, ADMIN 200; health + Swagger.

## Van scope

Projects/tasks/timer, frontend, mobile, SMTP/FCM real, IoT, `/audit` UI
