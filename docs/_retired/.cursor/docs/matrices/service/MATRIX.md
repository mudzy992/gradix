# Service — matrica

Status: **locked**. Faza 7.2. Status mašine: [fleet-status](../fleet-status/MATRIX.md).

## Entiteti

- `ServiceTemplate`: companyId, machineType, intervalHours, title
- `ServiceRecord`: companyId, machineId, projectId nullable, templateId?, status, scheduledAt, startedAt, completedAt, totalCost Decimal nullable, note

## Statusi recorda

`PLANNED` → `SCHEDULED` → `IN_PROGRESS` → `COMPLETED`  
`PLANNED` / `SCHEDULED` → `CANCELLED`

## Start (`IN_PROGRESS`)

Jedan korak `POST /api/services/:id/start` (`services.write`):

1. Mašina → `IN_SERVICE` (pamti prethodni IDLE|ACTIVE za restore).
2. Ako postoji open `TimerSession` na toj mašini: force-close (duration do now), task recalc, notifikacija `TIMER_FORCE_CLOSED` vlasniku.
3. Novi start-timer na toj mašini → 409 `MACHINE_IN_SERVICE`.

## Complete

Mašina restore IDLE ili ACTIVE (ima li aktivnu dodjelu). `currentSpend` projekta += totalCost ako `projectId` set (inače nije u spend). Vidi [spend-progress](../spend-progress/MATRIX.md).

## Cron

Svakih 6h (app clock UTC): mašine gdje preostalo do intervala ≤ 50h → record `SCHEDULED` + `SERVICE_DUE` (primaoci: ADMIN, SUPER_ADMIN, MECHANIC). Nema Redis/BullMQ; Nest interval.

## Ko

MECHANIC + ADMIN write; MECHANIC read sve mašine firme. PM nema service write.

## Error

`MACHINE_IN_SERVICE` `NOT_FOUND` `FORBIDDEN` `VALIDATION_FAILED`
