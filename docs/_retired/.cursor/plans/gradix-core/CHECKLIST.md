# Gradix — master checklist (implementacija)

Ažurirano: 2026-08-17. Plan 1–11 **LOCKED**.

**Ukupno implementacija: 100%** (11/11 faza). **Ponderisano (41 segment): 100%.** **Plan: 100%.**

| Faza | Plan | Kod | Segmenti | % |
|---|---|---|---|---|
| 1 Foundation | LOCKED | done | 8/8 | 100% |
| 2 Core ops API | LOCKED | done | 6/6 | 100% |
| 3 Frontend shell | LOCKED | done | 7/7 | 100% |
| 4 Fleet / logistics | LOCKED | done | 3/3 | 100% |
| 5 Web ops | LOCKED | done | 4/4 | 100% |
| 6 Mobile Expo | LOCKED | done | 4/4 | 100% |
| 7 Tender/servis/docs/CI | LOCKED | done | 5/5 | 100% |
| 8 Public site | LOCKED | done | 1/1 | 100% |
| 9 Payroll | LOCKED | done | 1/1 | 100% |
| 10 ERP-lite | LOCKED | done | 1/1 | 100% |
| 11 IoT | LOCKED | done | 1/1 | 100% |

Vizuelni prikaz: canvas pored chata.

Dokumenti:

- [x] Baseline + plan 1–11 + DECISIONS/DOMAIN
- [x] Matrice uključujući amendments, hse; SMS izbačen
- [x] **Planning freeze** — [PLAN_FREEZE.md](./PLAN_FREEZE.md)
- [x] **Peglanje 2**
- [x] **Faze 1–11 plan LOCKED**
- [x] **Faza 1 kod + e2e**
- [x] **Faza 2 kod + e2e**
- [x] **Faza 3 frontend shell**
- [x] **Faza 4 fleet/logistics API + e2e**
- [x] **Faza 5 web ops UI + diary/dashboard/HSE API**
- [x] **Faza 6 mobile Expo + sync push/pull/catalog**
- [x] **Faza 7 tender/servis/docs/reporti/CI**
- [x] **Faza 8 public `/p/:slug`**
- [x] **Faza 9 payroll**
- [x] **Faza 10 ERP-lite**
- [x] **Faza 11 IoT**

## Faza 1 — Foundation — 100%

- [x] 1.1 Nest, health, throttle (MySQL vanjski — owner override; Docker samo MinIO)
- [x] 1.2 Company, User, roles, Device, Setting, Notification enum v1, AuditEvent, seed
- [x] 1.3 Settings per company
- [x] 1.4 Auth JWT sub-only, Argon2id, temp lozinka, force change, reset, refresh reuse
- [x] 1.5 Users + PermissionsGuard + company scope
- [x] 1.6 In-app + Socket.IO rooms
- [x] 1.7 Upload path guard
- [x] 1.8 Envelope, paginacija, Swagger `/api/docs`, e2e zelen

## Faza 2 — Core ops API — 100%

- [x] 2.1 Projects + phases + assignments + documents
- [x] 2.2 Tasks, dispatch, attachments, FS dependencies
- [x] 2.3 Timer: server startedAt, pause-close, mutex SQL, machineId FK od Faze 4, auto-close cron, deactivate
- [x] 2.4 Socket `project:{id}` server-side join
- [x] 2.5 QuantityItem + TIMER amendment + progress recalc
- [x] Seed PM/SS/WORKER + acceptance e2e

## Faza 3 — Frontend shell — 100%

- [x] 3.1 Vite + tokens + i18n + proxy + light-only
- [x] 3.2 Login/forgot/reset + access memory + remember-me
- [x] 3.3 Layout Sheet `< md`; nav; mustChangePassword fullscreen
- [x] 3.4 Settings registry + `PATCH /company` + logo
- [x] 3.5 Users Sheet + temp lozinka + hourlyRate
- [x] 3.6 Bell + socket JWT; klik bez deep linka
- [x] PLATFORM_ADMIN company switcher; `/projects` → dashboard

## Faza 4 — Fleet / logistics / GPS — 100%

- [x] Machines IDLE/ACTIVE/DECOMMISSIONED; jedna aktivna dodjela; hours += timer
- [x] Trips + picker + amendment whitelist; QR/vagar opcion; fuel projectId
- [x] UserLocation + geofence info-only; IoT 501

## Faza 5 — Web ops — 100%

- [x] Dashboard po roli + presence widget
- [x] Projects + količine tab + dnevnik + dokumenti
- [x] Gantt samo planned dates
- [x] HSE lista `/hse` za SS

## Faza 6 — Mobile — 100%

- [x] Tabs unija, timer/ture/fuel/diary
- [x] Offline sync; katalog TTL 24h
- [x] 6.0b HSE online-only
- [x] 6.5 bio/FCM/voice ne blokira

## Faza 7 — Tender / servis / docs / reporti / CI — 100%

- [x] Tender convert WON + prilozi ostaju na tenderu
- [x] Servis IN_SERVICE + force-close timer; novi start 409 MACHINE_IN_SERVICE
- [x] Docs warn 30/15/5, ne blok login/timer
- [x] Fiksni report slugovi; GET /reports/custom → REPORT_UNKNOWN; CI lint+test+build + Playwright login, nema deploy
- [x] 2FA/TOTP opciono (ne zatvara)

## Faza 8 — Public — 100%

- [x] DTO whitelist + PublicAsset stream po id; `/p/:slug` one-page; panel `/` = `/login`; WORKER 403 PATCH public; isti 404 za tuđi/nepostojeći slug

## Faza 9 — Payroll — 100%

- [x] Mjesec u TZ; dan = startedAt; SS ne sebe; pause nije u satima; xlsx

## Faza 10 — ERP-lite — 100%

- [x] Partneri; CostEntry unique source+sourceId; warehouse SITE\|YARD\|CISTERN; apply-stock opciono

## Faza 11 — IoT — 100%

- [x] 1 device/mašina; ingest; no key in GET
