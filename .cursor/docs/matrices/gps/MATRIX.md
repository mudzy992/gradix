# GPS — matrica

Status: **locked** (Faza 4; IoT Faza 11).

## Dva identiteta

- **UserLocation:** telefon radnika/vozača/SS. Home “trenutno gradilište”, geofence enter/exit. `POST /api/locations/me`.
- **GpsRecord:** mašina. Telefon operatora (`TimerSession.machineId` ili aktivni assignment) ili IoT uređaj. `POST /api/machines/:id/location`.

Ne miješati: radnik bez mašine i dalje ima UserLocation.

## Geofence

- Zona = `Project.latitude/longitude/geofenceRadius` (krug). Default radius `geofence.defaultRadiusM` = 200. Nema odvojenog Geofence entiteta u MVP.
- `check` / `enter` / `exit`: user ili machine point vs projekti firme.
- Efekt: in-app `GEOFENCE_*`. **Ne** 403 na timer/turu/gorivo. **Nije** dokaz za payroll.

## Presence (Faza 4/5)

`GET /api/projects/:id/presence` (`projects.read` scoped ili `fleet.map`): useri čiji `UserLocation` je ≤ **30 min** i tačka u geofence krugu.  
Info-only (ime, lastSeenAt, ne tačne koordinate u listi — opciono na mapi 5.4b). Nije payroll, nije evidencija prisustva.

## IoT (Faza 11)

- `GpsDevice`: machineId unique ( **1 device / mašina** → 409 `IOT_DEVICE_EXISTS` )
- apiKey Argon2id + lookup hash; isActive; plaintext key jednom na create/rotate
- Ingest: `POST /api/iot/gps` header `X-Device-Key`. Loš/missing → 401 `AUTH_INVALID_CREDENTIALS`. Phone ostaje fallback. `source: PHONE | IOT`.
- Machine `lastGpsSource` PHONE|IOT za mapu. GET devices/machines **nema** key/hash.
- DECOMMISSIONED ili `isActive=false` → 403 `FORBIDDEN`. Decommission postavlja `isActive=false`.

## Retention

- Raw GPS 90 dana; cleanup cron Faza 7
- Saglasnost: Settings `privacy.gpsNotice` tekst; app prikazuje prije prvog share-a (nije pravni modul)

## Throttle

- Socket `machine:location` max 1 / 5s / mašina
- HTTP ingest IoT: 1 / 5s / mašina (`lastGpsAt`)
- UserLocation max 1 / 15s / user

## Izvori

- Faza 4: UserLocation + machine phone GPS
- Faza 11: IoT
