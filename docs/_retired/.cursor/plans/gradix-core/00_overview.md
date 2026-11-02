> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Gradix — plan projekta (overview)

## Identitet

- **Produkt:** Gradix — operacije niskogradnje + ured + javni sajt firme + ERP-lite + plate + IoT
- **Slug:** `gradix`
- **Plan:** `.cursor/plans/gradix-core/`
- **Domen:** [DOMAIN.md](../../docs/DOMAIN.md) · **Odluke:** [DECISIONS.md](../../docs/DECISIONS.md)

## Zaključano (2026-08-15)

- Više firmi (`Company` + `companyId`); jedan user = jedna firma; PLATFORM_ADMIN kreira firme
- Nema SMS (telefon = login id). Email + FCM flagovani
- N:M uloge, unija permisija; JWT samo `sub`; X-Company-Id samo PLATFORM_ADMIN
- PM/SS: samo assigned projekti; ADMIN/ACC: cijela firma; WORKER nema `GET /projects` listu
- Timer: mutex po useru (`TIMER_ALREADY_OPEN`); machineId null do 4; pause ne teče; complete samo `tasks.write`
- Ture/gorivo immutable poslije sync; Amendment; DRIVER picker
- Javni one-page `/p/:slug` (Faza 8), panel ostaje `/login`
- GPS: UserLocation + GpsRecord; IoT Faza 11 (isti zapis)
- Spend/progress: jedna formula (matrica); plate nisu spend dok ERP ne uveze
- i18n BS+EN; boje construction slate; MySQL 8 `gradix`; Prisma 7; Socket.IO

## Faze

- [01](./01_phase-01-foundation.md) Foundation (**LOCKED**) — tenant, auth, settings, notify, upload, audit
- [02](./02_phase-02-core-ops-api.md) Projects / tasks / timer (**LOCKED**)
- [03](./03_phase-03-frontend-shell.md) Vite shell (**LOCKED**)
- [04](./04_phase-04-fleet-logistics-api.md) Fleet / ture / fuel / GPS (**LOCKED**)
- [05](./05_phase-05-web-ops-ui.md) Web ops + dnevnik + šifarnici (**LOCKED**)
- [06](./06_phase-06-mobile-expo.md) Expo + offline (**LOCKED**)
- [07](./07_phase-07-advanced-polish.md) Tender, servis, dokumenti, reports, CI (**LOCKED**)
- [08](./08_phase-08-public-site.md) Javni sajt firme (**LOCKED**)
- [09](./09_phase-09-payroll.md) Obračun sati (**LOCKED**)
- [10](./10_phase-10-erp-lite.md) Partneri, troškovi, lager (**LOCKED**)
- [11](./11_phase-11-iot-fleet.md) IoT GPS (**LOCKED**)

Kod faze samo kad owner kaže da se izvrši ta faza. Freeze: [PLAN_FREEZE.md](./PLAN_FREEZE.md).

## Šema (obavezno)

- Company (+ pravna polja), Device, AuditEvent, UserRoleAssignment, Settings per company
- User: firstName, lastName, employeeCode?, mustChangePassword, locale
- Task nema machineId; TimerSession.machineId null do 4; pauseAccumMinutes; Amendment šema od Faze 2
- Trip.materialId + quantity; QR/vagar opcion; unique aktivna machine assignment
- Sync unique (companyId, userId, deviceId, localId)
- ProjectDocument; Diary unique (companyId, projectId, date)
- UserLocation ≠ GpsRecord

## Kasnije (nije odbačeno)

Whisper, PDV/GL/e-faktura/doprinosi, Redis/BullMQ kad cron ne staže, user u više firmi (membership), podizvođač-ekipa, najam mašine, pravni dnevnik, portal naručioca. **SMS se ne vraća.** Auto količine iz tura se ne vraćaju u v1.

Status: [CHECKLIST.md](./CHECKLIST.md) · [HANDOFF.md](./HANDOFF.md) · [PLAN_FREEZE.md](./PLAN_FREEZE.md)
