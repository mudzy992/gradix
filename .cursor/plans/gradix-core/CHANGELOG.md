# Changelog — Gradix core plan

## 2026-08-17 (Faza 11 kod)

- **Šta:** GpsDevice 1/mašina; `POST /api/iot/gps` + `X-Device-Key`; rotate; 501 stub obrisan; mapa badge PHONE|IOT; e2e iot 3/3. Nema CAN/tachograph/više trackera.
- **Zašto:** Owner: izvrši Fazu 11.

## 2026-08-17 (Faza 10 kod)

- **Šta:** ERP-lite: Partner, CostEntry (unique company+source+sourceId), Warehouse SITE|YARD|CISTERN, StockMovement. `currentSpend` = fuel/service dok nema CostEntry tog sourceId, tad samo CostEntry; MANUAL uvijek +=. `from-payroll` idempotent po mjesecu TZ. Fuel ne skida lager; `POST /fuel/:id/apply-stock` idempotent na CISTERN. `erp.allowNegativeStock` default false. Web `/erp`. E2e 3/3. Nema IoT/GL/PDV.
- **Zašto:** Owner: izvrši Fazu 10.

## 2026-08-16 (Faza 9 kod)

- **Šta:** Payroll API + web `/payroll`. Novi timer insert `PENDING` (DB default ostaje APPROVED). SS/PM scoped, ne sebe (`PAYROLL_SELF_APPROVE`); ADMIN sebe OK. Mjesec u `app.timezone`; duration bez pause; PENDING/REJECTED nisu u zbroju; export xlsx. Satnica ostaje `PATCH /users/:id`. E2e payroll 3/3. Nema ERP/IoT/doprinosa.
- **Zašto:** Owner: izvrši Fazu 9.

## 2026-08-16 (Handoff → Faza 9)

- **Šta:** `HANDOFF.md` za novu sesiju: Faza 1–8 zatvorene; kickoff Faze 9 (payroll). Šta već postoji (`hourlyRate`, `approvalStatus` default APPROVED, jedini `timerSession.create` u `timer-create.ts`, TZ helperi, xlsx u reportima, email stub) vs što treba uraditi. Ne dirati Prisma default; PENDING u insertu. Prompt za copy-paste.
- **Zašto:** Owner: uradi handoff i pripremi Fazu 9.

## 2026-08-16 (Faza 8 kod)

- **Šta:** Javni `/p/:slug` one-page + `GET /api/public/:slug|/projects|/assets/:id`. DTO firme bez taxId; DTO projekta bez budget/spend/GPS; samo `isPublic=true`. `PublicAsset` stream po id. `PATCH /projects/:id/public` + `POST /api/public/assets` (`public.write`, WORKER 403). Throttle 60/min/IP. Isti 404 za tuđi/nepostojeći/inactive slug. Panel `/` ostaje `/login`. E2e public 3/3. Nema payroll/ERP/IoT.
- **Zašto:** Owner: izvrši Fazu 8.

## 2026-08-16 (Handoff → Faza 8)

- **Šta:** `HANDOFF.md` za novu sesiju: Faza 1–7 zatvorene; kickoff Faze 8 (public `/p/:slug`, DTO whitelist, PublicAsset stream, `/` = `/login`). Šta već postoji (`isPublic`, `public.*` settings, `@Public()`, `public.write`) vs što treba uraditi. Prompt za copy-paste.
- **Zašto:** Owner: napravi handoff za Fazu 8.

## 2026-08-16 (Faza 7 kod)

- **Šta:** Tender convert WON (ista firma, prilozi ostaju); IN_SERVICE + force-close timer + 409 MACHINE_IN_SERVICE; docs warn 30/15/5 bez bloka; fiksni reporti + diary PDF; CI lint+test+build + Playwright login, nema deploy. Seed MECHANIC + ACCOUNTANT. `features.email=false` ⇒ 0 SMTP. 7.5 TOTP nije. E2e polish 5/5.
- **Zašto:** Owner: izvrši Fazu 7.

## 2026-08-16 (Handoff → Faza 7)

- **Šta:** `HANDOFF.md` za novu sesiju: Faza 1–6 zatvorene; kickoff Faze 7 (tender convert WON, IN_SERVICE+force-close, docs warn, fiksni reporti, CI bez deploy). Šta već postoji (IN_SERVICE enum, notify types, pdfUrl kolona) vs što treba uraditi. Prompt za copy-paste.
- **Zašto:** Owner: napravi handoff za Fazu 7.

## 2026-08-16 (Faza 6 kod)

- **Šta:** Expo `mobile/` + `POST /api/sync/push|pull` + `GET /api/sync/catalog`. Online startedAt=server; offline push klijent startedAt s boundovima. HSE online-only. Katalog TTL 24h. E2e sync 3/3. 6.5 bio/FCM/voice nije. Nema IN_SERVICE / tender / payroll.
- **Zašto:** Owner: izvrši Fazu 6.

## 2026-08-16 (Handoff → Faza 6)

- **Šta:** `HANDOFF.md` za novu sesiju: Faza 1–5 zatvorene; kickoff Faze 6 (Expo + sync push/pull/catalog). Diary/incidents API već postoje — ne ponavljati 6.0/6.0b na backendu. Prompt za copy-paste.
- **Zašto:** Owner: napravi handoff za sljedeću sesiju.

## 2026-08-16 (Faza 5 kod)

- **Šta:** Web ops UI + diary/dashboard/HSE API. `GET /dashboard` po roli; `DiaryEntry` unique dan/TZ; `DIARY_CONFLICT` + resolve A/B/MERGE; incidents lista + SS Sheet. Nav projects/tasks/fleet/map/logistics/diary/hse. Leaflet OSM. Bell deep link. Gantt planned-only. WORKER nema `/projects`. E2e 38/38. Nema mobile/ / IN_SERVICE / 5.2b drag-drop.
- **Zašto:** Owner: izvrši Fazu 5.

## 2026-08-16 (Handoff → Faza 5)

- **Šta:** `HANDOFF.md` kickoff Faze 5: dashboard/diary/HSE API, ukidanje `/projects` redirecta, Leaflet, bell deep link, Sheet `< md`. Prompt za novu sesiju.
- **Zašto:** Owner: handoff + prompt prije Faze 5 u novoj sesiji.

## 2026-08-16 (Faza 4 kod)

- **Šta:** Fleet/logistics API: Machine/Trip/Fuel/UserLocation/GpsRecord, picker, presence, geofence info-only, IoT 501, machineId FK + mutex, TRIP/FUEL amendments. E2e 34/34. Nema fleet UI / Leaflet / IN_SERVICE.
- **Zašto:** Owner: izvrši Fazu 4.

## 2026-08-16 (Handoff → Faza 4)

- **Šta:** `HANDOFF.md` + canvas status: Faza 1–3 zatvorene; kickoff Faze 4 (fleet API, bez UI). Prompt za novu sesiju.
- **Zašto:** Owner: update canvas + handoff prije Faze 4 u novoj sesiji.

## 2026-08-16 (Faza 3 kod)

- **Šta:** Vite SPA `frontend/`: login, layout Sheet, settings, users, companies, bell, Socket.IO. Access u memoriji. Light-only. Backend: `GET /company`, users `?role=`, `/me.company` uz platform header, geofence min/max u registry.
- **Zašto:** Owner: izvrši Fazu 3.

## 2026-08-16 (Handoff → Faza 3)

- **Šta:** `HANDOFF.md` ažuriran za novu sesiju: Faza 1+2 zatvorene, kickoff Faze 3 (Vite shell, bez ops UI).
- **Zašto:** Owner: handoff urađenog + priprema sljedeće sesije.

## 2026-08-16 (Faza 2 kod + Faza 1 e2e)

- **Šta:** Faza 2 API (projects/tasks/timer/quantities/TIMER amendments) + migracija + seed PM/SS/WORKER. Faza 1 e2e zatvoren (Swagger prefix, email unique meta, MinIO test stub, Prisma CJS). E2e 29/29.
- **Zašto:** Owner: checklist + kompletiraj Fazu 1 pa pređi na Fazu 2.

## 2026-08-16 (Faza 1 kod + vanjski MySQL)

- **Šta:** Faza 1 implementirana (`backend/`). Compose samo MinIO. MySQL vanjski `DATABASE_URL`. Migracija + seed applied na `gradix`.
- **Zašto:** Owner: izvrši Fazu 1; MySQL nije Docker.

## 2026-08-15 (Faze 4–11 LOCKED)

- **Šta:** Lock svih preostalih faza: šema/API/acceptance. 4 picker+mutex mašine; 5 dashboard+diary; 6 offline startedAt; 7 convert/IN_SERVICE/reporti/CI; 8 public DTO; 9 PENDING payroll; 10 CostEntry unique + apply-stock; 11 X-Device-Key + rotate.
- **Zašto:** Owner: review + rupe prije koda.

## 2026-08-15 (Faza 3 LOCKED)

- **Šta:** Shell rute, tokeni u memoriji, `PATCH /api/company`, `/me.company`, mustChangePassword fullscreen, bell bez deep linka, web light-only, forgot/reset UI, PLATFORM_ADMIN switcher. Faza 1 ugovor dopunjen.
- **Zašto:** Owner: lock Faze 3 prije koda.

## 2026-08-15 (Faza 2 LOCKED)

- **Šta:** + close-while-pause formula; ručni project status; PLANNING↛ON_HOLD; archive s open timerom; assignee 409 ako radi; PENDING start 409; complete s ASSIGNED; `GET /timer?projectId=`; socket join na assign; plannedEnd/geofenceRadius; sort createdAt desc; SS plannedQty 403; `SEED_PASSWORD`; mutex u migraciji.
- **Zašto:** Owner: sve preostale rupe Faze 2 u lock.

## 2026-08-15 (Faza 1 LOCKED)

- **Šta:** Review Faze 1: firstName/lastName, employeeCode, company.email, cuid, refresh hash, cijeli Role+Notification enum, cijeli permission katalog, throttle brojevi, forgot 200, timer-close no-op do Faze 2, hourlyRate samo payroll.write. Plan Faze 1 zaključan. Kod nije krenuo.
- **Zašto:** Owner: dovesti Fazu 1 do max i lock prije implementacije.

## 2026-08-15 (peglanje 2)

- **Šta:** TIMER amendment duration; payroll dan = startedAt TZ; Company.isActive blokira login; ADMIN reset-password; fuel receiptPath; presence ≤30 min; SERVICE_DUE/FUEL_ANOMALY primaoci; offline katalog 24h + server reject; tender prilozi.
- **Zašto:** Drugi sloj prijedloga (payroll/auth mine + ops evidencija). Bez application koda.

## 2026-08-15 (peglanje freeze)

- **Šta:** Temp lozinka + force change. Pause ne teče. Auto-close 12h. Predmjer ručni (ne dira %). QR/vagar opcion. Fuel ne skida cisternu (apply-stock Faza 10). Pravna polja firme; public bez JIB. Project code + write lock ON_HOLD/terminal. Audit/trips/quantities matrice. Amendment whitelist. Machine type enum. Diary max 20 / HSE max 5 foto.
- **Zašto:** Owner: dopuniti kompletnu app, ne samo Fazu 1; ispeglati predložene rupe.

## 2026-08-15 (planning freeze)

- **Šta:** `PLAN_FREEZE.md` (ako nije ovdje, nije v1). Faza 1 ugovor (Argon2id, email zauzet, E.164, slug immutable, error.code, 20/100, logout-all, 403 bez headera). Nove matrice: tenders, service, documents-expiry, reports, diary, fleet-status, notifications, public-site, ci-deploy. Faze 3–11: segment + API + acceptance + error codes. Defaulti: Gantt planned-only, IN_SERVICE force-close, docs warn, fiksni reporti, payroll TZ + no self-approve, warehouse 3 tipa, 1 IoT/mašina, CI bez CD, zatvoren notify enum, HSE online-only.
- **Zašto:** Owner traži kompletan plan prije koda. Faza 1 se ne izvršava dok freeze nije upisan — sada je.

## 2026-08-15 (handoff)

- **Šta:** Puni HANDOFF za novu sesiju: stanje dokumenata, odluke, sljedeći korak = planning freeze (ne kod).
- **Zašto:** Chat kontekst dug; owner nastavlja u novoj sesiji.

## 2026-08-15

- **Šta:** SMS izbačen. X-Company-Id samo PLATFORM_ADMIN. File path guard. Socket rooms server-side. Refresh reuse revoke. Timer mutex po mašini + sati iz sessiona; complete samo tasks.write. Trip/fuel immutable + Amendment. Fuel projectId pravilo. DRIVER picker. Dashboard po roli. Public DTO whitelist. HSE Faza 6. Prvi user firme = SUPER_ADMIN. hourlyRate: svoja vidljiva. ADMIN payroll.write. GPS nije dokaz plata. Diary konflikt = manual i na webu.
- **Zašto:** Owner review: nelogičnosti, sigurnost, mutne tačke.

## 2026-08-14 (spec freeze)

- **Šta:** DECISIONS + DOMAIN; data-scope, GPS, spend-progress, permissions, screens, tenant, payroll, upload; faze 8–11 (public, plate, ERP-lite, IoT); JWT sub-only; Company od Faze 1. Nije više “nije ERP / nije javni sajt / nije multi-firma / nije IoT” — to je u planu, fazirano.
- **Zašto:** Owner želi pun proizvod u zadatku; šema tenanta i timer pravila moraju biti fiksirani prije koda.

## 2026-08-14 (multi-role)

- **Šta:** N:M uloge, unija permisija.
- **Zašto:** Isti nalog admin + teren.

## 2026-08-14

- **Šta:** Inicijalni plan 1–7 i baseline.
- **Zašto:** Greenfield.
