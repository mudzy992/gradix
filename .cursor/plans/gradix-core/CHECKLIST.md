# Gradix — master checklist

Dokumenti:

- [x] Baseline + plan 1–11 + DECISIONS/DOMAIN
- [x] Matrice uključujući amendments, hse; SMS izbačen
- [x] **Planning freeze** — [PLAN_FREEZE.md](./PLAN_FREEZE.md)
- [x] **Peglanje 2** — timer amend, ponoć/TZ, company inactive, reset lozinke, fuel receipt, presence, notify primaoci, offline TTL, tender prilozi

- [x] **Faza 1 plan LOCKED** — [01_phase-01-foundation.md](./01_phase-01-foundation.md)
- [x] **Faza 1 kod** — Nest API; vanjski MySQL migrate+seed OK; e2e nije pokrenut
- [x] **Faza 2 plan LOCKED** — [02_phase-02-core-ops-api.md](./02_phase-02-core-ops-api.md)
- [x] **Faza 3 plan LOCKED** — [03_phase-03-frontend-shell.md](./03_phase-03-frontend-shell.md)
- [x] **Faze 4–11 plan LOCKED** — `04` … `11_phase-*.md`

Kod se **ne** radi dok owner ne kaže „izvrši Fazu N“.

## Faza 1 — Foundation

- [x] 1.1 Docker, Nest, health, throttle login/refresh
- [x] 1.2 Company (pravna polja + email), User (firstName/lastName, employeeCode, mustChangePassword, locale), roles, Device, Setting, Notification enum v1, AuditEvent, seed
- [x] 1.3 Settings per company (nema features.sms; timer.maxOpenHours; geofence.defaultRadiusM)
- [x] 1.4 Auth JWT sub-only, Argon2id min 10, temp lozinka jednom, force change, reset-password, refresh reuse revoke, logout/logout-all, E.164, email inactive zauzet, company inactive 401, X-Company-Id 400/403
- [x] 1.5 Users + PermissionsGuard (cijeli katalog) + company scope; slug immutable; deaktivacija revoke (timer close Faza 2)
- [x] 1.6 In-app + zatvoren type enum + Socket.IO server-side rooms
- [x] 1.7 Upload path guard
- [x] 1.8 Envelope `error.code`, paginacija 20/100, Swagger, tests cross-tenant + path traversal

## Faza 2 — Core ops API

- [ ] 2.1 Projects + phases + assignments + documents (scoped lista; WORKER 403; PM auto-assign; planned dates; locality)
- [ ] 2.2 Tasks, dispatch (`assigneeIds`), attachments, FS dependencies; nema DELETE
- [ ] 2.3 Timer: server startedAt, pause-close formula, mutex u migraciji, machineId null, auto-close 12h, deactivate hook, `GET /timer?projectId=`
- [ ] 2.4 Socket `project:{id}` server-side join
- [ ] 2.5 QuantityItem + TIMER amendment + progress recalc; nema `/dashboard`
- [ ] Seed PM/SS/WORKER + acceptance iz faznog dokumenta

## Faza 3 — Frontend shell

- [ ] 3.1 Vite + tokens + i18n + proxy + light-only
- [ ] 3.2 Login/forgot/reset + access memory + remember-me + silent refresh + logout-all tabs
- [ ] 3.3 Layout Sheet `< md`; nav dashboard/settings/users/companies; mustChangePassword fullscreen
- [ ] 3.4 Settings registry + `PATCH /company` + logo upload
- [ ] 3.5 Users Sheet + temp lozinka jednom + hourlyRate samo payroll.write
- [ ] 3.6 Bell + socket handshake JWT; klik bez deep linka
- [ ] PLATFORM_ADMIN company switcher; `/projects` URL → dashboard

## Faza 4 — Fleet / logistics / GPS

- [ ] Machines IDLE/ACTIVE/DECOMMISSIONED; jedna aktivna dodjela; hours += timer
- [ ] Trips + picker + amendment whitelist; QR/vagar opcion; fuel projectId; fuel ne skida lager
- [ ] UserLocation + geofence info-only; IoT 501

## Faza 5 — Web ops

- [ ] Dashboard po roli (worker bez budget) + presence widget
- [ ] Projects + količine tab + dnevnik + dokumenti; diary conflict resolve
- [ ] Gantt samo planned dates
- [ ] HSE lista `/hse` za SS

## Faza 6 — Mobile

- [ ] Tabs unija, timer/ture/fuel/diary
- [ ] Offline sync; katalog TTL 24h; synced trip/fuel immutable
- [ ] 6.0b HSE online-only (ne blokira close)
- [ ] 6.5 bio/FCM/voice ne blokira

## Faza 7 — Tender / servis / docs / reporti / CI

- [ ] Tender convert WON + prilozi; usporedba nije score
- [ ] Servis IN_SERVICE + force-close timer
- [ ] Docs warn 30/15/5, ne blok
- [ ] Fiksni report slugovi (+ phase-quantities); CI test+build bez auto-deploy
- [ ] 2FA opciono

## Faza 8 — Public

- [ ] DTO whitelist (bez taxId/budget/GPS) + PublicAsset; `/p/:slug`; panel `/login`

## Faza 9 — Payroll

- [ ] Mjesec u TZ; dan = startedAt; SS ne odobrava sebe; pause nije u satima; GPS nije dokaz; xlsx

## Faza 10 — ERP-lite

- [ ] Partneri; CostEntry bez duplog spend; warehouse SITE|YARD|CISTERN; apply-stock opciono

## Faza 11 — IoT

- [ ] 1 device/mašina; ingest; no key in GET
