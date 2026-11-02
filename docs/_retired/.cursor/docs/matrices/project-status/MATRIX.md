# Project status — matrica

Status: **locked** (Faza 2.1).

## Statusi

PLANNING → IN_PROGRESS → ON_HOLD → IN_PROGRESS  
PLANNING / IN_PROGRESS / ON_HOLD → COMPLETED  
bilo koji osim COMPLETED → CANCELLED  
`PLANNING → ON_HOLD` **zabranjen** (400). COMPLETED / CANCELLED: terminal (nema povratka u v1)

Default na create: PLANNING. Status **samo** ručni PATCH (timer ne prebacuje). Caller s `PROJECT_MANAGER` → auto-assign sebe kao `PM`. Čisti ADMIN/SUPER_ADMIN bez te uloge: bez auto-assign.

## Write lock

- `ON_HOLD`: nema novi timer, dispatch, turu, gorivo, novu machine assignment. Smije: pause/resume/stop postojećeg, diary, HSE, qty, amendment, dokumenti. 409 `PROJECT_ON_HOLD`.
- `COMPLETED` / `CANCELLED` / `archivedAt`: 409 `PROJECT_TERMINAL` osim amendment, HSE create, read, ADMIN qty korekcija, payroll approve historije.

## Liste

- `GET /projects`: treba `projects.read` + ADMIN/SUPER_ADMIN/ACC/PM/SS (PM/SS = `ProjectAssignment`). WORKER/OP/DRIVER/MECHANIC **403**. PLATFORM_ADMIN + header = ADMIN. Filteri: `status` `q` `archived`.
- `GET /projects/:id`: WORKER/OP ako ProjectAssignment ili TaskAssignment. DTO **bez** `plannedBudget` `currentSpend` `client`.
- DELETE = `archivedAt` (i sa open timerom); default lista bez archived; `?archived=true` ADMIN/PM/SUPER_ADMIN. Start na archived → `PROJECT_TERMINAL`.
- Status samo `PATCH /projects/:id/status`. Ostala polja `PATCH /projects/:id`.

## Polja

- `code` opcion unique (`companyId`, `code`) uppercase `[A-Z0-9-]{1,20}`; prazan → null
- `locality` string (grad/opština za public); lat/lng odvojeno
- `geofenceRadius` 10–5000, default `geofence.defaultRadiusM` (200)
- `plannedStart` / `plannedEnd` opciono (Gantt Faza 5); end < start (oba set) → 400

## Progress / spend

[spend-progress](../spend-progress/MATRIX.md). Recalc na close/complete/cancel task.
