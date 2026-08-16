# Changelog — Gradix core plan

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
