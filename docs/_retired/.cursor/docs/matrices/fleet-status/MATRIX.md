> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Fleet status — matrica

Status: **locked** (Faza 4.1; `IN_SERVICE` Faza 7.2).

## Statusi

| Status | Značenje |
|---|---|
| `IDLE` | Nema aktivne project dodjele |
| `ACTIVE` | Ima aktivnu `MachineAssignment` |
| `IN_SERVICE` | Servis `IN_PROGRESS` (Faza 7) |
| `DECOMMISSIONED` | Terminal (DELETE API) |

Jedna aktivna dodjela po mašini. Tip (zatvoren): `TRUCK` `EXCAVATOR` `LOADER` `GRADER` `ROLLER` `PAVER` `DUMPER` `COMPRESSOR` `OTHER`. Nema OWN/RENTED u v1 (sve “svoje”).

## Prelazi

- `IDLE` ↔ `ACTIVE` preko assignment create/end
- `IDLE` \| `ACTIVE` → `IN_SERVICE` na service start (pamti previous)
- `IN_SERVICE` → restore previous na service complete/cancel
- bilo koji osim `DECOMMISSIONED` → `DECOMMISSIONED` (ADMIN)
- `DECOMMISSIONED`: nema timer, ture, gorivo, IoT ingest, nova dodjela (409 `CONFLICT`)

## Timer

- Open session: max 1 po mašini → 409 `MACHINE_IN_USE`
- `IN_SERVICE`: start → 409 `MACHINE_IN_SERVICE`; postojeći open = force-close (service matrica)
- Close session: `currentWorkingHours += durationHours`

## IoT

1 `GpsDevice` po mašini. DECOMMISSIONED uređaj `isActive=false`.
