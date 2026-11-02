# Gradix — zaključane odluke

Datum: 2026-08-15. Promjena ⇒ ovaj fajl + CHANGELOG plana + relevantna matrica.  
V1 granica: [PLAN_FREEZE.md](../plans/gradix-core/PLAN_FREEZE.md).

## Četiri pitanja

1. **Vidljivost projekata.** ADMIN, SUPER_ADMIN, ACCOUNTANT, PLATFORM_ADMIN (izabrana firma): svi projekti firme. PM i SITE_SUPERVISOR: samo `ProjectAssignment`. `GET /projects` lista **nije** za WORKER/OP/DRIVER/MECHANIC (403). WORKER/OP: `GET /tasks` + detalj projekta ako assigned (DTO bez budget/spend/client). DRIVER: vlastite ture + dodijeljene mašine (picker Faza 4). MECHANIC: sve mašine firme.
2. **Zadatak ↔ mašina.** Opciono na **start timer** (`TimerSession.machineId`). Max **jedan open session po mašini** (409 `MACHINE_IN_USE`). Na close: `Machine.currentWorkingHours += durationHours` (duration **bez** pause).
3. **Više ljudi na tasku.** IN_PROGRESS dok postoji bilo koji open session. COMPLETED samo `tasks.write` (SS/PM/ADMIN) — zatvara sve open sessione + notifikacija assigneeima. WORKER/OP samo stop/pause **svog** sessiona.
4. **Geofence.** Info + in-app. Default radius **200 m**. **Ne** blokira rad. **Nije** dokaz za plate (kontrola = odobrenje Faza 9).

## SMS — isključeno

Nema SMS, Twilio, `features.sms`, SMS kanala. Telefon = samo login identifikator (kao email), ne OTP. Reset lozinke samo email (`features.email`). Prvi ulaz: temp lozinka u create response, ne SMS/email invite.

## Tenant

- `Company` + `companyId` na poslovnim tabelama.
- Polja firme: name, slug, legalName?, address?, city?, country default `BA`, taxId (JIB)?, phone E.164?, email?, logoPath?.
- User: **firstName + lastName** obavezno; **employeeCode** opcion unique po firmi.
- Jedan user = jedna firma. Email unique globalno (uključuje `isActive=false` — **zauzet**).
- Slug: regex `[a-z0-9-]{3,40}`, unique, **immutable** (`TENANT_SLUG_IMMUTABLE`).
- `PLATFORM_ADMIN`: `companyId` null. Header `X-Company-Id` **samo** ako caller ima PLATFORM_ADMIN; inače 400 `TENANT_HEADER_FORBIDDEN`. PLATFORM_ADMIN bez headera na tenant ruti → 403 `TENANT_HEADER_REQUIRED`.
- Nova firma: PLATFORM_ADMIN kreira Company + prvog usera kao **SUPER_ADMIN** (`mustChangePassword=true`, temp lozinka jednom u response).
- `SUPER_ADMIN` ostaje unutar firme.
- `Company.isActive=false`: login usera firme → 401 `AUTH_COMPANY_INACTIVE`. PLATFORM_ADMIN i dalje GET/PATCH firmu. Deaktivacija firme: revoke all refresh; force-close timera od Faze 2.

## Auth / sigurnost

- JWT access: samo `sub`. Role/firma iz DB.
- Lozinka: min 10; Argon2id. Promjena → revoke **svih** refresh.
- API create user: temp lozinka **jednom** u response (kao IoT key); `mustChangePassword=true`. GET nikad ne vraća lozinku.
- `POST /api/users/:id/reset-password` (`users.write`): nova temp jednom, `mustChangePassword=true`, revoke all. Nije self-reset (to je change-password). Nema SMS.
- Seed: `mustChangePassword=false`.
- Dok `mustChangePassword`: samo `/me`, `change-password`, logout(s); ostalo 403 `AUTH_PASSWORD_CHANGE_REQUIRED`.
- Deaktivacija: force-close open timer + revoke all; login 401 `AUTH_ACCOUNT_INACTIVE`.
- Telefon: E.164 ili null. Unique ako set.
- Refresh rotacija; reuse → revoke svih (`AUTH_REFRESH_REUSE`).
- `POST /auth/logout` = trenutni refresh; `POST /auth/logout-all` = svi.
- `User.locale` `bs`|`en` default `bs`.
- Throttle `/login` i `/refresh`. Envelope `{ code, message }`.
- Liste: page default 1, limit default 20, max 100.
- Socket rooms server-side. Fajlovi `{companyId}/`. 2FA opciono Faza 7+.
- `/me` uključuje `company: { id, name, slug } | null`.
- ADMIN/SUPER_ADMIN edituje firmu: `PATCH /api/company` (`settings.write`); slug immutable. PLATFORM_ADMIN: `PATCH /companies/:id`.
- Web panel Faza 3: access token u memoriji; refresh sessionStorage (remember-me localStorage); samo light.
- Offline timer (Faza 6 push): klijent `startedAt` uz boundove; online `/timer/start` i dalje server now.
- IoT: header `X-Device-Key`; 1 device / mašina.

## Timer

- Timer: pause ne teče; na close/resume ako je pauza → `pauseAccum += now−pausedAt`; running = closedAt null ∧ pausedAt null; mutex = closedAt null (`TIMER_ALREADY_OPEN`, i dok pause); `startedAt` server UTC; Faza 2 `machineId` null; auto-close 12h; deaktivacija force-close. `GET /timer?projectId=` SS/PM/ADMIN.
- Payroll dan = kalendarski dan `startedAt` u `app.timezone` (cijeli session, nema splita preko ponoći).
- Korekcija zatvorenog sessiona: Amendment `TIMER` / `durationMinutes` (SS scoped, ADMIN). Reason obavezan. Recalc task + machine hours delta. Faza 9: ako je bio APPROVED → nazad PENDING.
- `timer.maxOpenHours` default 12; cron 15 min → close + `TIMER_AUTO_CLOSED`.
- ON_HOLD ne gasi postojeći session (cron i dalje vrijedi).

## Ture / gorivo

- DRIVER bira kamion: tip TRUCK + (aktivna dodjela njemu ili IDLE/ACTIVE na tom projektu).
- `GET /api/projects/picker` za DRIVER.
- QR deponije i vagar **opcion**. Istina ture = `quantity`.
- FuelEntry.projectId obavezan ako mašina ima aktivnu dodjelu (`FUEL_PROJECT_REQUIRED`).
- `receiptPath` opcion (foto računa); immutable poslije sync.
- FuelEntry **ne** skida `CISTERN` lager. Faza 10: opciono `apply-stock`.
- Nakon sync: DRIVER nema PUT (`TRIP_IMMUTABLE`). Ispravka = `Amendment` (uključujući TIMER duration).

## Freeze defaulti (v1)

- Gantt: samo planned start/end (polja na projektu/fazi/tasku od Faze 2).
- Servis start: `IN_SERVICE` + force-close (`TIMER_FORCE_CLOSED`).
- Dokumenti istek: warn, ne blok.
- Reporti: fiksna lista uključujući `phase-quantities`.
- Payroll: mjesec u TZ; SS/PM ne odobravaju sebe.
- Warehouse: SITE | YARD | CISTERN.
- IoT: 1 device / mašina.
- CI bez auto-deploy.
- Notify enum zatvoren (+ `TIMER_AUTO_CLOSED`).
- HSE online-only, max 5 foto.
- Predmjer ručni; ne dira progress %; ture ne auto-sabiraju.
- Project code opcion unique po firmi (uppercase).
- PM s `PROJECT_MANAGER` kreira projekat → auto `ProjectAssignment` role PM. Čisti ADMIN bez te uloge: bez auto-assign.
- Public DTO: ime, grad, adresa, telefon, logo, tagline, projekti whitelist. **Bez** taxId, budžeta, GPS.
- Presence widget: zadnji ping ≤30 min u geofence (nije payroll).
- Offline katalog TTL 24h; sync reject DECOMMISSIONED/ON_HOLD.
- Tender prilozi 0–N fajlova.

## Ostalo

- Dnevnik: unique (firma, projekat, datum TZ); max 20 foto; konflikt manual; PDF intern.
- `hourlyRate`: user vidi **svoju** stopu; tuđu samo `payroll.read`. Write samo `payroll.write` (polje u šemi od Faze 1).
- Dashboard KPI po roli (worker bez budget).
- Progress = sredina faza. Količine su odvojen tab.
- Audit: zatvoren action; bez `/audit` UI u v1.
- Email + FCM flagovani. SMS ne.
