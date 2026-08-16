# Faza 6 — Mobile Expo (**LOCKED** 2026-08-15)

**Cilj:** Expo: timer, ture, gorivo, dnevnik, offline queue. Bio/FCM/voice nisu blocker.

**Status plana:** zaključano. Kod tek na „izvrši Fazu 6“.

**Preduslov:** Faze 1–4 API + diary iz 5.6. Ako diary API nedostaje, uraditi 6.0 prvo (ista matrica).

**Matrice:** `offline-sync`, `timer`, `diary`, `hse`, `screens`, `gps`, `trips`

## 6.0 / 6.0b

Diary: samo ako 5.6 nije. HSE API: [hse](../../docs/matrices/hse/MATRIX.md) **online-only** (max 5 foto, severity LOW|MEDIUM|HIGH). `HSE_OFFLINE` na klijentu, nije sqlite.

## Scaffold

- `mobile/` Expo SDK current, Router, TS, NativeWind/tokens isti, i18n BS/EN, theme **light/dark/system**
- Login email|phone; secure store (refresh); access memorija
- `mustChangePassword` → forma **prije tabova**
- Offline bar; dugmad ≥48dp, body ≥16
- `error.code` → i18n

## Tabovi (max 5)

Unija: Home, Zadaci (`tasks.timer`\|`tasks.read`), Ture (`trips.*`), Dnevnik (`diary.write`), Profil (uvijek).  
Samo DRIVER: nema Zadaci. DRIVER+WORKER: Zadaci + Ture. Višak → Profil (gorivo, HSE online).

## Features

- Home: timer, geofence label (info), counts, unread; HSE dugme samo online
- Tasks: start/stop/pause; complete samo `tasks.write`; `MACHINE_IN_USE` toast
- Trips: picker, kamion pravilo, materijal, QR/vagar **opcion**, nema edit poslije sync
- Fuel: projectId kad mašina na projektu; receipt opcion
- Diary: weather, tekst, foto ≤20

## Timer: online vs offline

- **Online:** `startedAt` = server now (Faza 2). Klijent ne šalje sat.
- **Offline push:** `startedAt` s klijenta **obavezan**. Server reject `VALIDATION_FAILED` ako `startedAt > now+5min` ili stariji od `timer.maxOpenHours` (wall clock). Close formula ista (pauseAccum). `localId` + `deviceId` unique. Idempotent push.

## Offline sync

- expo-sqlite. Queue: TimerSession, Trip, FuelEntry, DiaryEntry, photo. **Nije:** Incident, users, projects mutate, Amendment, machines write
- Unique `(companyId, userId, deviceId, localId)`
- `POST /api/sync/push` pa `POST /api/sync/pull` (since lastSyncTimestamp)
- Katalog pull: `GET /api/sync/catalog` (projects picker, machines, materials, depots); `pulledAt`; >24h banner. Server i dalje reject DECOMMISSIONED / ON_HOLD / terminal
- Synced trip/fuel: lokalni PUT zabranjen
- Foto: max 1920px JPEG 80%
- Diary konflikt = resolve UI (isti endpoint kao web)

## API (novo)

| Method | Path |
|---|---|
| POST | `/api/sync/push` `pull` `resolve-conflict` |
| GET | `/api/sync/catalog` |
| CRUD | `/api/incidents` + photos (online) |

## Error codes

`DIARY_CONFLICT` `TRIP_IMMUTABLE` `FUEL_PROJECT_REQUIRED` `MACHINE_IN_USE` `TIMER_ALREADY_OPEN` `HSE_OFFLINE` (klijent) `PROJECT_ON_HOLD` `PROJECT_TERMINAL` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED`

## Acceptance

- Airplane: tura lokalno; po mreži nestane iz pending; dupli localId = isti server id
- Offline timer start: klijent startedAt prihvaćen; startedAt u budućnosti +10 min → 400
- Online timer: body startedAt → 400 (Faza 2)
- Samo DRIVER: nema start-timer; DRIVER+WORKER: Zadaci + Ture
- mustChangePassword: nema tabova
- Airplane + HSE: disabled, nije u sqlite
- Push tura na DECOMMISSIONED → 409 i kad je cache star
- Katalog >24h banner; haptic na Evidentiraj turu
- error.code → i18n BS

## Van scope

IoT, Whisper, 6.5 bio/FCM/voice (ne zatvara), seed 50 tura, EAS store submit
