# Faza 4 — Fleet + logistics API (**LOCKED** 2026-08-15)

**Cilj:** machines, trips, fuel, UserLocation, geofence info-only. Nema web mape.

**Status plana:** zaključano. Kod tek na „izvrši Fazu 4“ (poslije Faze 2).

**Matrice:** `gps`, `fleet-status`, `data-scope`, `spend-progress`, `amendments`, `timer`, `trips`

**Preduslov:** Faza 2. Od 4.1 `TimerSession.machineId` FK → Machine (ukida se 400-null). Close += `currentWorkingHours` (bez pause). Mutex po mašini `MACHINE_IN_USE`. Amendment TRIP/FUEL write prestaje biti 404.

## Šema

Svi + `companyId`, cuid, timestamps.

- **Machine:** name 1–80, code? uppercase `[A-Z0-9-]{1,20}` unique po firmi, type `TRUCK|EXCAVATOR|LOADER|GRADER|ROLLER|PAVER|DUMPER|COMPRESSOR|OTHER`, status default IDLE, currentWorkingHours Decimal default 0, lastLat/lng?, lastGpsAt?. Nema OWN/RENTED.
- **MachineAssignment:** machineId, projectId, userId?, startedAt, endedAt?. Jedna aktivna (`endedAt` null) po mašini. Migracija unique: `UNIQUE (machineId, (IF(endedAt IS NULL, 1, NULL)))`.
- **Material:** name, unit (quantities enum + `L`), isActive default true. Soft: isActive=false ako ima Trip.
- **Depot:** name, qrToken unique, lat/lng?, isActive.
- **Trip:** driverId, projectId, machineId, materialId, quantity Decimal >0, originText, originLat/lng?, destDepotId?, destLat/lng?, weighTicketPath?, weighQty?, notes?, loadedAt default now, unloadedAt?, isSynced default true, localId?, deviceId?.
- **FuelEntry:** machineId, userId, projectId?, liters >0, unitPrice Decimal, totalCost generated liters×price, notes?, receiptPath?, isSynced default true, localId?, deviceId?.
- **UserLocation:** userId, lat, lng, recordedAt, accuracyM?.
- **GpsRecord:** machineId, lat, lng, recordedAt, source `PHONE` default (IOT Faza 11).

Timer: `machineId` nullable FK. Unique open mašina: `UNIQUE (companyId, (IF(closedAt IS NULL AND machineId IS NOT NULL, machineId, NULL)))`.

## Pravila

- DELETE machine = DECOMMISSIONED. Nema hard delete. DECOMMISSIONED: timer/trip/fuel/assign → 409 `CONFLICT`.
- IDLE ↔ ACTIVE preko assignment. `IN_SERVICE` nije u 4 (Faza 7).
- Timer start s `machineId`: FK postoji; nije DECOMMISSIONED; ACTIVE na **istom** projektu kao task **ili** IDLE u firmi; slobodna → inače `MACHINE_IN_USE`. Bez machineId i dalje OK.
- **Picker** `GET /api/projects/picker`: DRIVER/OP; DTO `{ id, name, code, locality, status }` **bez** budget/spend/client.
- Trip: DRIVER create `driverId=me`; kamion TRUCK + (dodjela njemu ili IDLE/ACTIVE na projektu). QR/vagar/dest GPS **opcion**. Complete: `unloadedAt`; dest GPS s depota ako ima. Nakon isSynced: DRIVER nema PUT (`TRIP_IMMUTABLE`).
- Fuel: `projectId` obavezan ako mašina ima aktivnu dodjelu (`FUEL_PROJECT_REQUIRED`). Ne StockMovement. Recalc `currentSpend`. receiptPath opcion; poslije sync immutable.
- Materials/depots write: `trips.write` ili `settings.write`.
- Presence: `GET /projects/:id/presence` — UserLocation ≤30 min u krugu; **ime + lastSeenAt, bez lat/lng**. `projects.read` scoped ili `fleet.map`.
- Geofence: `GEOFENCE_*` in-app; **ne** 403 na timer/trip/fuel.
- Throttle: machine GPS 1/5s, user 1/15s.
- IoT ingest **501** (Faza 11). Amendment POST TRIP/FUEL OK (whitelist).

## API

| Method | Path |
|---|---|
| CRUD | `/api/machines` (DELETE=DECOMMISSIONED) |
| POST | `/api/machines/:id/assign` `unassign` |
| POST | `/api/machines/:id/location` |
| GET | `/api/projects/picker` |
| CRUD | `/api/trips` |
| POST | `/api/trips/:id/complete` |
| CRUD | `/api/fuel` |
| POST | `/api/locations/me` |
| GET | `/api/projects/:id/presence` |
| GET | `/api/locations/geofence-check` |
| CRUD | `/api/materials` `/api/depots` |
| POST | `/api/iot/gps` → **501** |

Amendment: postojeći `/api/amendments` (Faza 2).

## Error codes

`MACHINE_IN_USE` `TRIP_IMMUTABLE` `FUEL_PROJECT_REQUIRED` `PROJECT_ON_HOLD` `PROJECT_TERMINAL` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` `CONFLICT` `PAGINATION_LIMIT`

## Acceptance

- start s machineId (postojeća IDLE) 200; smeće id 400; dva usera ista mašina 409 `MACHINE_IN_USE`
- Close s machineId: hours += duration/60 **bez** pause
- Trip bez quantity 400; ON_HOLD 409; complete bez dest GPS 200
- DRIVER PUT synced 403 `TRIP_IMMUTABLE`; amend quantity SS 200; amend driverId 400
- Fuel bez projectId uz aktivnu dodjelu 400 `FUEL_PROJECT_REQUIRED`; spend raste; receipt opcion
- DECOMMISSIONED start/trip/fuel 409
- Picker DRIVER 200 bez budget; WORKER picker 403
- Presence 31 min nije u listi; 5 min jeste; payload bez koordinata
- Geofence ne 403 timer; IoT 501

## Van scope

Service IN_SERVICE, IoT keys, Leaflet, `/dashboard`
