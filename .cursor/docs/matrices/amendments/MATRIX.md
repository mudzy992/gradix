# Amendments — ture, gorivo, timer

Status: **locked** (TIMER Faza 2; TRIP/FUEL Faza 4).

Šema od Faze 2: entityType `TIMER`|`TRIP`|`FUEL`. Write TRIP/FUEL → 404 do Faze 4.

Nakon `isSynced=true` (ili server create online): DRIVER/OP **ne smije PUT/DELETE**.

Ispravka: `Amendment` { entityType TRIP|FUEL|TIMER, entityId, field, oldValue, newValue, reason (≥5), actorId, companyId }.

Dozvoljena polja TRIP: `quantity`, `notes`, `weighQty`, `destDepotId` (ne driverId, machineId, projectId).  
FUEL: `liters`, `unitPrice`, `notes`, `projectId` (ne `receiptPath`). `totalCost` se računa.  
TIMER: samo `durationMinutes` (integer ≥0) na **zatvorenom** sessionu. Recalc task + machine hours delta. Faza 9: APPROVED → PENDING. Open session → 409 `CONFLICT`.

- Write **i GET**: SS scoped, ADMIN, SUPER_ADMIN. WORKER/DRIVER 403.
- `GET /api/amendments?entityType=&entityId=` oba obavezna; 400 bez njih.
- Recalc spend / trip / timer totals nakon amend
- Notify `AMENDMENT_CREATED` vlasniku sessiona / vozaču / operatoru

Offline: lokalni edit prije prvog uspješnog push-a je OK (još nije server record).
