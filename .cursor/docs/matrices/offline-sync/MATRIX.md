# Offline sync — matrica

Status: **locked** (Faza 6.4).

## Entiteti (offline write)

TimerSession, Trip, FuelEntry, DiaryEntry, photo (upload queue)

## Identitet

- Client generiše `localId` (UUID)
- Server unique `(companyId, userId, deviceId, localId)`
- Ponovljeni push = isti `serverId` (idempotent)

## Tok

1. Push unsynced (`POST /api/sync/push`) — timer smije `startedAt` s klijenta (matrica timer)
2. Map localId → serverId
3. Pull since `lastSyncTimestamp` (`POST /api/sync/pull`)
4. Katalog: `GET /api/sync/catalog` (picker, machines, materials, depots); TTL 24h
5. Photos: compress → upload → entity sa path

## Konflikti

- Default: last-write-wins (`updatedAt`)
- DiaryEntry: ne overwrite automatski; `conflictData` + `POST /api/sync/resolve-conflict` (isti tok na webu ako dva SS pišu isti dan)

## Van queue-a

Projects, users, machines, materials, depots = pull-only cache. TTL **24h** (`pulledAt`). Isteklo → banner “osvježi katalog”; push i dalje ide, **server** odbije:
- mašina `DECOMMISSIONED` → 409 `CONFLICT`
- projekat ON_HOLD / terminal → `PROJECT_ON_HOLD` / `PROJECT_TERMINAL`

Incident/HSE **nije** offline. Trip/Fuel nakon sync nisu u mutate queue (Amendment).

## Izvori u kodu

- (Faza 6) `mobile/` sync engine + `backend/src/modules/sync/`
