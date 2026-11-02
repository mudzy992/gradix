# PLAN FREEZE — Gradix v1

Datum: 2026-08-15. **Ako nije ovdje (ili u navedenoj matrici), nije u v1.**

Izmjena freeze-a = ovaj fajl + [DECISIONS.md](../../docs/DECISIONS.md) + matrica + [CHANGELOG.md](./CHANGELOG.md). Nije “usput u kodu”.

Kod: samo kad owner kaže **izvrši Fazu N**. Freeze nije odobrenje naredne faze.

## Faza 1 — LOCKED (2026-08-15)

Plan Faze 1 je zaključan: [01_phase-01-foundation.md](./01_phase-01-foundation.md).  
Šema User uključuje firstName, lastName, employeeCode. Cijeli Role + Notification enum u Prisma od dana 1. Timer close na deaktivaciji = Faza 2.

Kod Faze 1 je u `backend/` (čekaju Docker migrate/seed/e2e). Freeze nije odobrenje Faze 2.

## Faza 2 — LOCKED (2026-08-15)

Plan: [02_phase-02-core-ops-api.md](./02_phase-02-core-ops-api.md).  
machineId null do 4.1. WORKER/OP/DRIVER/MECHANIC nema listu `/projects`. Worker detalj bez budget. PM create auto-assign. Timer `startedAt` = server; close-while-pause akumulira pauzu; mutex i dok pause. `GET /timer?projectId=` za SS/PM/ADMIN. Status projekta samo ručni PATCH. Archive ne gasi timer. Dispatch = `POST /tasks` + assigneeIds. Seed `SEED_PASSWORD`.

## Faza 3 — LOCKED (2026-08-15)

Plan: [03_phase-03-frontend-shell.md](./03_phase-03-frontend-shell.md).  
Preduslov Faza 1. `/me.company` {id,name,slug}. `PATCH /api/company` za ADMIN settings. Access u memoriji; remember-me refresh storage. mustChangePassword fullscreen. Nav samo dashboard/settings/users/companies. Bell bez deep linka (deep link Faza 5). Web light-only.

## Faza 4 — LOCKED (2026-08-15)

Plan: [04_phase-04-fleet-logistics-api.md](./04_phase-04-fleet-logistics-api.md).  
machineId FK; mutex po mašini; picker bez budget; presence bez koordinata; IoT 501.

## Faza 5 — LOCKED (2026-08-15)

Plan: [05_phase-05-web-ops-ui.md](./05_phase-05-web-ops-ui.md).  
`GET /dashboard` KPI po roli; diary API ovdje; Leaflet OSM; bell deep link; Sheet `< md`.

## Faza 6 — LOCKED (2026-08-15)

Plan: [06_phase-06-mobile-expo.md](./06_phase-06-mobile-expo.md).  
Online startedAt=server; offline push klijent startedAt s boundovima. HSE online-only. Katalog 24h.

## Faza 7 — LOCKED (2026-08-15)

Plan: [07_phase-07-advanced-polish.md](./07_phase-07-advanced-polish.md).  
Convert WON; IN_SERVICE+force-close; docs warn ne blok; fiksni reporti; CI bez deploy.

## Faza 8 — LOCKED (2026-08-15)

Plan: [08_phase-08-public-site.md](./08_phase-08-public-site.md).  
`/p/:slug`; DTO bez taxId/budget/GPS; PublicAsset stream; `/` = `/login`.

## Faza 9 — LOCKED (2026-08-15)

Plan: [09_phase-09-payroll.md](./09_phase-09-payroll.md).  
Novi sessioni PENDING; SS ne sebe; mjesec TZ; pauza nije u exportu.

## Faza 10 — LOCKED (2026-08-15)

Plan: [10_phase-10-erp-lite.md](./10_phase-10-erp-lite.md).  
CostEntry unique source+sourceId; apply-stock idempotent; warehouse 3 tipa.

## Faza 11 — LOCKED (2026-08-15)

Plan: [11_phase-11-iot-fleet.md](./11_phase-11-iot-fleet.md).  
1 device/mašina; `X-Device-Key`; 501 stub obrisan; rotate key.

## U v1 (faze 1–11)

Tenant + pravna polja firme, auth (temp lozinka + force change), settings, in-app notify, upload, audit, projects/tasks/timer (pause ne teče, auto-close 12h), tanki predmjer, Vite panel, flota/ture (QR/vagar opcion)/gorivo/GPS, web ops + dnevnik, Expo + offline, tender/servis/dokumenti/fiksni reporti/CI, javni `/p/:slug`, payroll export, ERP-lite (cisterna se ne skida gorivom auto), IoT GPS.

## Van v1 (namjerno)

SMS. Whisper kao blocker. PDV/GL/e-faktura/doprinosi/bolovanje/prekovremeni koeficijent. Redis/BullMQ. User u više firmi. Report builder. Gantt actuals. Auto-deploy. Obavezni 2FA. GPS kao dokaz plata. Više IoT uređaja po mašini. HSE offline. Promjena slug-a. Ponovna upotreba emaila deaktiviranog. AI score tenders. Blok rada zbog isteka dokumenata. Auto količine iz tura. Podizvođač-ekipa na tasku. Najam mašine (`OWN`/`RENTED`). Pravni obrazac dnevnika (potpisi nadzora). Portal naručioca. Invite email kao jedini kanal. WatermelonDB. Next/Postgres/Express/Turborepo.

Opciono (ne zatvara fazu): 5.2b Gantt drag-drop, 6.5 bio/FCM/voice, 7.5 TOTP.

## Cross-cutting (od Faze 1)

| Pravilo | Vrijednost |
|---|---|
| Envelope | `{ success, data, meta }` / `{ success: false, error: { code, message } }` |
| `error.code` | Stabilan string; klijent i18n po kodu; `message` EN fallback |
| Paginacija | `page` default 1, `limit` default **20**, max **100** |
| Lozinka | min **10**; Argon2id; change → revoke **svih** refresh |
| Novi user (API) | temp lozinka **jednom** u create response; `mustChangePassword=true` |
| Reset lozinke (ADMIN) | `POST /users/:id/reset-password` → nova temp jednom + mustChangePassword + revoke all |
| Seed useri | `mustChangePassword=false` |
| Firma `isActive=false` | login svih usera firme → 401 `AUTH_COMPANY_INACTIVE`; PLATFORM_ADMIN i dalje vidi/edituje |
| Guard | `mustChangePassword` → samo `/me`, change-password, logout(s) inače 403 `AUTH_PASSWORD_CHANGE_REQUIRED` |
| Email | unique globalno; deaktiviran **zauzet** |
| Telefon | E.164 ili null; unique ako postoji; nije OTP |
| Slug | `[a-z0-9-]{3,40}` unique; **immutable** |
| Logout | `logout` = ovaj refresh; `logout-all` = svi |
| PLATFORM_ADMIN | bez headera na tenant ruti → **403**; non-platform sa headerom → **400** |
| JWT | samo `sub`; role iz DB |
| Datumi | UTC u DB; prikaz `app.timezone` |
| Novac | Decimal; `app.currency` BAM |
| Locale | `User.locale` `bs`\|`en` default `bs` |
| Ime | `firstName` + `lastName` obavezno (1–80) |
| Šifra radnika | `employeeCode` opcion, unique po firmi |

## Domen defaulti

- Gantt: samo planned start/end.
- Timer pause: **ne teče** (nije u duration / sati mašine / payroll).
- Payroll dan: cijeli session u kalendarski dan `startedAt` u TZ firme (nema splita preko ponoći).
- Korekcija timera: `Amendment` entityType `TIMER`, polje `durationMinutes`, reason obavezan; SS scoped / ADMIN. WORKER nema PUT duration.
- Zaboravljen timer: `timer.maxOpenHours` default **12** (1–24); cron 15 min → force-close + `TIMER_AUTO_CLOSED`.
- Deaktivacija usera: close open timer + revoke all. Deaktivacija **firme**: isto za sve usere + 401 `AUTH_COMPANY_INACTIVE`.
- Servis: `IN_SERVICE` + force-close open timera.
- Dokumenti istek: warn 30/15/5, ne blok.
- Reporti: fiksna lista (+ `phase-quantities`).
- Payroll: mjesec u TZ; SS/PM ne odobravaju sebe; duration bez pause.
- ERP warehouse: `SITE` \| `YARD` \| `CISTERN`. FuelEntry **ne** skida lager; Faza 10 opciono `apply-stock`.
- IoT: 1 device / mašina.
- CI: test + build; nema auto-deploy.
- Notify type zatvoren enum.
- HSE v1 online-only; max **5** foto.
- Dnevnik: max **20** foto; PDF intern (nije pravni obrazac).
- Predmjer: ručni plan/izvedeno; **ne** mijenja progress %; ture ne auto-sabiraju.
- Ture: QR i vagar **opcion**; istina = `quantity`. Gorivo: `receiptPath` opcion.
- Presence: `GET /projects/:id/presence` — UserLocation ≤30 min unutar geofence; info-only.
- Offline katalog: TTL **24h**; sync odbije DECOMMISSIONED / ON_HOLD / terminal.
- Tender: 0–N priloga (upload matrica).
- Notify primaoci: `SERVICE_DUE` → ADMIN+SUPER_ADMIN+MECHANIC; `FUEL_ANOMALY` → ADMIN+SUPER_ADMIN+ACC.
- Geofence default radius **200** m (`geofence.defaultRadiusM`).
- Projekat `code` opcion; `locality` za public; plannedStart/End na fazi i tasku (Gantt).
- `GET /projects` lista nije za WORKER/OP/DRIVER/MECHANIC. PM create → auto-assign. Worker detalj bez budget/spend/client.
- ON_HOLD: nema novi timer/dispatch/turu/gorivo; diary/HSE/qty/amendment OK; postojeći timer se ne auto-gasi (osim 12h cron).
- COMPLETED/CANCELLED/archived: write blok (`PROJECT_TERMINAL`) osim amendment, HSE, read, ADMIN qty korekcija, payroll approve historije.
- Firma: address, city, country default BA, taxId (JIB), phone, logoPath. Public **bez** taxId.
- Mašina tip: `TRUCK` `EXCAVATOR` `LOADER` `GRADER` `ROLLER` `PAVER` `DUMPER` `COMPRESSOR` `OTHER`.
- Audit action zatvoren; nema `/audit` UI u v1.

## Matrice

Postojeće + freeze: tenders, service, documents-expiry, reports, diary, fleet-status, notifications, public-site, ci-deploy.

Peglanje: [quantities](../../docs/matrices/quantities/MATRIX.md), [trips](../../docs/matrices/trips/MATRIX.md), [audit](../../docs/matrices/audit/MATRIX.md).

## Error code katalog (v1)

Auth: `AUTH_INVALID_CREDENTIALS` `AUTH_ACCOUNT_INACTIVE` `AUTH_COMPANY_INACTIVE` `AUTH_REFRESH_REUSE` `AUTH_PASSWORD_TOO_SHORT` `AUTH_PHONE_INVALID` `AUTH_EMAIL_TAKEN` `AUTH_PASSWORD_CHANGE_REQUIRED` `TENANT_HEADER_FORBIDDEN` `TENANT_HEADER_REQUIRED` `TENANT_SLUG_INVALID` `TENANT_SLUG_IMMUTABLE` `USER_PHONE_TAKEN`.

Ops: `PAGINATION_LIMIT` `VALIDATION_FAILED` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `MACHINE_IN_USE` `MACHINE_IN_SERVICE` `TIMER_ALREADY_OPEN` `TRIP_IMMUTABLE` `FUEL_PROJECT_REQUIRED` `DIARY_CONFLICT` `TENDER_INVALID_STATUS` `PAYROLL_SELF_APPROVE` `IOT_DEVICE_EXISTS` `HSE_OFFLINE` `REPORT_UNKNOWN` `PROJECT_ON_HOLD` `PROJECT_TERMINAL`.

Novi kod = izmjena ovog fajla.
