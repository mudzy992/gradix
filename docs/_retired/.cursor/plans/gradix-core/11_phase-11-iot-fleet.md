# Faza 11 — IoT flota (**LOCKED** 2026-08-15)

**Status:** zaključano. Kod tek na „izvrši Fazu 11“.

**Matrice:** `gps`, `fleet-status`  
**Preduslov:** Faza 4 GpsRecord phone.

## Šema

- **GpsDevice:** machineId **unique**, name, apiKeyHash, isActive default true, lastSeenAt?. Plaintext key **jednom** u create response (kao temp lozinka).

## Pravila

- 1 device / mašina → 409 `IOT_DEVICE_EXISTS`. Nema drugog trackera u v1.
- `POST /api/iot/gps` header **`X-Device-Key`**. Loš/missing key → 401 `AUTH_INVALID_CREDENTIALS` (nema enumeracije mašine). Key se **ne** loguje, nije u GET.
- Ingest → GpsRecord `source=IOT` + machine lastLat/lng/lastGpsAt. Throttle 1/5s / mašina (isti kao phone).
- DECOMMISSIONED ili `isActive=false` → 403 `FORBIDDEN`.
- Faza 4 stub `501` na ovom pathu **obrisati**.
- Phone GPS ostaje; mapa badge PHONE|IOT.
- PATCH device: isActive, name. Nema GET plaintext. Rotate = novi POST (prvo deaktiviraj stari — unique machineId: PATCH isActive false pa... unique i dalje drži red. Rotate: ADMIN `POST .../devices/:id/rotate` → novi plaintext jednom, stari hash invalid.
- GET `/machines` i GET devices: **nema** key ni hash.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/machines/:id/devices` | fleet.write |
| GET | `/api/machines/:id/devices` | fleet.read (bez key) |
| PATCH | `/api/machines/:id/devices/:deviceId` | fleet.write |
| POST | `/api/machines/:id/devices/:deviceId/rotate` | fleet.write |
| POST | `/api/iot/gps` | `X-Device-Key` |

## Error codes

`IOT_DEVICE_EXISTS` `AUTH_INVALID_CREDENTIALS` `FORBIDDEN` `NOT_FOUND` `CONFLICT`

## Acceptance

- Pogrešan key 401; key nije u GET ni logu
- Druga naprava na istoj mašini 409 `IOT_DEVICE_EXISTS`
- Rate limit ingest; phone i IoT oba GpsRecord
- 501 stub nestao; DECOMMISSIONED ingest 403
- Rotate vraća novi key jednom

## Van scope

CAN bus, tachograph, više trackera po mašini, Redis geo
