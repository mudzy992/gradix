> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Task status — matrica

Status: **locked** (Faza 2.2–2.3).

## Statusi

- PENDING: kreiran; 0 TaskAssignment
- ASSIGNED: ≥1 assignment
- IN_PROGRESS: ≥1 running session (`closedAt` null ∧ `pausedAt` null)
- PAUSED: 0 running, nije COMPLETED/CANCELLED (svi pause ili zadnji stop)
- COMPLETED: samo `POST .../complete` (`tasks.write`)
- CANCELLED: terminal; force-close svih `closedAt` null sessiona

Nema DELETE. Skinut assignee s open sessionom → 409. Skinut zadnji (bez open) → PENDING (ako nije COMPLETED/CANCELLED). Inactive user → 400 na assign.

## Prelazi

- PENDING → ASSIGNED (prvi assign)
- ASSIGNED → IN_PROGRESS (start; PENDING start → 409)
- IN_PROGRESS → PAUSED (0 running: zadnji pause ili stop, nije complete)
- PAUSED → IN_PROGRESS (start ili resume)
- IN_PROGRESS / PAUSED / **ASSIGNED** → COMPLETED (`tasks.write`; zatvara sve sessione). PENDING complete → 409
- PENDING / ASSIGNED / PAUSED / IN_PROGRESS → CANCELLED (`tasks.write`)
- COMPLETED / CANCELLED: start → 409

## Dispatch

`POST /api/tasks` + `assigneeIds` ≥1 = create + assign + `TASK_DISPATCHED` (ASSIGNED). Bez assigneeja = PENDING. Nema `/dispatch`. Projekat u scope-u; ne ON_HOLD/terminal. Start zahtijeva ≥1 assignee.

## Priority

LOW | MEDIUM | HIGH | URGENT — nema auto-eskalacije.

## Ostalo

- `plannedStart` / `plannedEnd` opciono
- Dependency samo FS; cycle 400
- DELETE faze: 409 dok bilo koji task ima taj `phaseId` (i CANCELLED). Prvo PATCH `phaseId` na drugu fazu ili null.
