> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Faza 2 — Core ops API (**LOCKED** 2026-08-15)

**Cilj:** projects, phases, tasks, timer, dispatch, documents, quantities, TIMER amendment. Nema web UI, nema Machine/Trip.

**Status plana:** zaključano. Izmjena = PLAN_FREEZE + ova faza + matrica. Kod tek na „izvrši Fazu 2“ (poslije Faze 1).

**Matrice:** `project-status`, `task-status`, `timer`, `spend-progress`, `data-scope`, `payroll`, `quantities`, `amendments`

**Preduslov:** Faza 1.

## Šema

Svi + `companyId`, cuid, timestamps.

- **Project:** code? uppercase `[A-Z0-9-]{1,20}` `@@unique([companyId, code])` (prazan → null), name 1–120, status default PLANNING, locality? (grad/opština, ne GPS), lat/lng Decimal?, geofenceRadius default settings 200, plannedBudget Decimal?, currentSpend default 0, progressPercent default 0, client?, isPublic default false (nema public API ovdje), archivedAt?, plannedStart/End?
- **ProjectPhase:** projectId, name, sortOrder Int, plannedStart/End?, progressPercent default 0. Nema unique na sortOrder.
- **ProjectAssignment:** @@unique([projectId, userId]), role oznaka `PM`|`SS`|`WORKER`|`DRIVER`|`OP` (nije UserRole; ne mora matchati UserRole). User ista firma, `isActive`.
- **ProjectDocument:** path, fileName (upload matrica). Permisija: list `projects.read`, write `projects.write` (nije `documents.*`).
- **Task:** projectId, phaseId?, title 1–200, description?, priority LOW|MEDIUM|HIGH|URGENT default MEDIUM, status, plannedStart/End?, totalTimeSpentMinutes default 0. **Nema** machineId. phaseId null OK.
- **TaskAssignment** @@unique([taskId, userId]); user ista firma, `isActive` na assign.
- **TaskAttachment:** path, fileName
- **TaskDependency:** fromId, toId, type FS only; @@unique([fromId, toId]); isti projekat; cycle → 400 `VALIDATION_FAILED`
- **TimerSession:** userId, taskId, companyId, startedAt (server UTC), closedAt?, pausedAt?, pauseAccumMinutes default 0, durationMinutes? (samo na close), lat/lng?, **machineId uvijek null** (kolona postoji, set → 400), localId?, deviceId?, isSynced default true, approvalStatus default APPROVED. Mutex: migracija `UNIQUE (companyId, (IF(closedAt IS NULL, userId, NULL)))` — app check nije dovoljan.
- **QuantityItem:** vidi quantities; name 1–120; planned/executed Decimal ≥0; nema unique na name.
- **Amendment:** entityType `TIMER`|`TRIP`|`FUEL` (TRIP/FUEL POST → 404 do Faze 4), field, old/new string, reason ≥5, actorId

## Pravila

- **Liste:** page 1, limit 20 max 100, sort default `createdAt`, order default `desc`. `GET /projects`: `status` `q` `archived=true` (archived default hidden; `archived=true` ADMIN/PM/SUPER_ADMIN). `GET /tasks`: `projectId` `status` `assigneeId`.
- **Lista `/projects`:** `projects.read` + ADMIN/SUPER_ADMIN/ACC/PM/SS (PM/SS scoped). WORKER/OP/DRIVER/MECHANIC → 403. PLATFORM_ADMIN + header = kao ADMIN. Detalj `GET /projects/:id`: WORKER/OP ako ProjectAssignment ili TaskAssignment. **WORKER/OP/DRIVER DTO bez** `plannedBudget` `currentSpend` `client`.
- **Create project:** `projects.write`. Caller ima `PROJECT_MANAGER` → auto `ProjectAssignment` role PM. Samo ADMIN/SUPER_ADMIN (bez PM uloge) → bez auto-assign. ACC 403.
- **Status projekta** samo ručni `PATCH .../status` (timer **ne** prebacuje PLANNING→IN_PROGRESS). `PLANNING → ON_HOLD` → 400. Ostala polja `PATCH /projects/:id`. `plannedEnd < plannedStart` (oba set) → 400 (isto faza/task). `geofenceRadius` 10–5000. DELETE = `archivedAt` **i sa** open timerom; novi start na archived → `PROJECT_TERMINAL`.
- **machineId** na start/PATCH → 400 `VALIDATION_FAILED` do 4.1.
- **Timer body:** start `{ taskId, lat?, lng? }` — klijent **ne** šalje `startedAt`/`durationMinutes`/`machineId`. pause/resume/stop bez id-a = moj session (`closedAt` null). Nema sessiona → 409 `CONFLICT`. Pause dok već pause / resume dok running → 409. Start dok postoji `closedAt` null (uključujući pause) → 409 `TIMER_ALREADY_OPEN` (nije auto-resume). Start na PENDING (0 assigneeja) → 409; SS smije start **bez** vlastitog assignmenta ako task ima ≥1 assignee.
- **Running** = `closedAt` null ∧ `pausedAt` null. **Open (mutex)** = `closedAt` null. Task IN_PROGRESS ⇔ ≥1 running. PAUSED ⇔ 0 running i nije COMPLETED/CANCELLED.
- **Close formula:** ako `pausedAt` set, prvo `pauseAccum += floor((now−pausedAt)/60)`, pa `pausedAt=null`, pa `durationMinutes`. Resume: isto `pauseAccum +=`, pa `pausedAt=null`. `GET /timer/me` `elapsedMinutes` dok pause: račun do `pausedAt`, ne do now.
- **Deaktivacija** usera/firme: force-close (duration do now, kao stop) + `TIMER_FORCE_CLOSED` + audit. Cron 15 min: `startedAt` stariji od `timer.maxOpenHours` → isto + `TIMER_AUTO_CLOSED`. Idempotent (`closedAt` već set → skip). ON_HOLD ne gasi postojeći.
- **Socket:** server join `project:{id}` za projekte u scope-u (handshake). Na `ProjectAssignment` create → join tog usera; na delete → leave (ADMIN/ACC ostaju company-wide). Klijent ne `join`. Eventi: `task:updated` `task:assigned` `timer:started` `timer:stopped` `timer:paused` — payload `{ id, projectId, taskId? }`.
- **Dispatch:** `POST /api/tasks` sa `assigneeIds` ≥1 → ASSIGNED + `TASK_DISPATCHED`. Bez assigneeja → PENDING. Nema posebnog `/dispatch`.
- **Nested write** (phases, assignments, documents): `projects.write` (SS 403). Task attachments/assignees: `tasks.write`. Quantities: quantities matrica.
- **CANCELLED:** force-close svih open (nije COMPLETED). Nema DELETE taska. PATCH task: title, description, priority, planned*, phaseId (ista projektna faza ili null).
- Skinut assignee s `closedAt` null → 409 `CONFLICT`. Zadnji assignee skinut → PENDING (ako nije COMPLETED/CANCELLED). Inactive user se ne assigna (400).
- Complete: `tasks.write` s ASSIGNED / IN_PROGRESS / PAUSED (ASSIGNED bez timera OK). PENDING complete → 409.
- DELETE phase: 409 ako bilo koji task ima taj `phaseId` (i CANCELLED). Prvo PATCH `phaseId` na drugu fazu ili null.
- `executedQty` smije > `plannedQty`.
- Progress recalc na close/complete/cancel. Spend ostaje 0. Nema `/dashboard`.
- Amendment TIMER samo zatvoren; GET `?entityType=&entityId=` obavezni. GET isti scope kao write (SS/ADMIN); WORKER 403.
- Quantity PATCH: SS samo `executedQty`/`note`; `plannedQty`/name/unit/phaseId → 403.

## API

| Method | Path |
|---|---|
| GET/POST | `/api/projects` |
| GET/PATCH/DELETE | `/api/projects/:id` |
| PATCH | `/api/projects/:id/status` |
| CRUD | `/api/projects/:id/phases` `assignments` `documents` `quantities` |
| GET/POST | `/api/tasks` |
| GET/PATCH | `/api/tasks/:id` |
| POST | `/api/tasks/:id/complete` `cancel` |
| POST/DELETE | `/api/tasks/:id/assignees` `attachments` |
| POST/DELETE | `/api/tasks/:id/dependencies` |
| POST | `/api/timer/start` `pause` `resume` `stop` |
| GET | `/api/timer/me` → `{ session }` ili `{ session: null }` + `elapsedMinutes` |
| GET | `/api/timer?projectId=` — open sessioni projekta; ADMIN/PM/SS scoped; WORKER/OP 403 |
| POST/GET | `/api/amendments` |

Tuđi/cross-tenant id → 404. Audit Faza 2: `PROJECT_CREATED` `PROJECT_STATUS` `TASK_COMPLETED` `TASK_CANCELLED` `TIMER_AUTO_CLOSED` `TIMER_FORCE_CLOSED` `TIMER_AMENDED`.

## Error codes

`PROJECT_ON_HOLD` `PROJECT_TERMINAL` `TIMER_ALREADY_OPEN` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `VALIDATION_FAILED` `PAGINATION_LIMIT`

(`MACHINE_IN_USE` od Faze 4.)

## Acceptance

- PM bez assignmenta ne vidi tuđi projekat; ADMIN vidi sve; MECHANIC `GET /projects` 403
- WORKER `GET /projects` 403; `GET /tasks` vidi svoj; `GET /projects/:id` 200 ako assigned, **bez** budget polja
- PM POST project → vidi ga (auto-assign); čisti ADMIN POST → 200 ali GET list prazan za PM usera; ACC POST 403
- start s machineId ili startedAt → 400
- Dva usera start isti task OK; pause jednog ne PAUSED dok drugi running; svi pause → task PAUSED
- Pause 10 min pa stop **bez resume**: duration = samo running; elapsed u pauzi ne raste
- PLANNING → ON_HOLD 400; prvi timer ne mijenja status projekta
- Archive s open timerom 204; start na archived → `PROJECT_TERMINAL`
- DELETE assignee s open timerom 409; start na PENDING 409
- Complete ASSIGNED bez timera 200; PENDING complete 409
- `GET /timer?projectId=` SS 200; WORKER 403
- plannedEnd < plannedStart → 400; geofenceRadius 0 → 400
- 23:00–01:00 TZ: cijeli dan `startedAt`
- Drugi start istog usera (i dok pause) → 409 `TIMER_ALREADY_OPEN`; resume OK
- WORKER complete 403; SS complete zatvara running+paused + `TASK_COMPLETED`
- Cancel task s open timerom → sessioni closed, CANCELLED
- Start ON_HOLD → `PROJECT_ON_HOLD`; start COMPLETED task → 409; start tuđi task (nije SS) → 403
- Deactivate user s open timerom → closed + `TIMER_FORCE_CLOSED`
- WORKER amend 403; SS amend zatvorenog OK; open amend 409
- WORKER POST quantities 403; SS executed OK; SS PATCH plannedQty 403; executed>planned 200; progressPercent isti
- DELETE phase s taskovima 409; nakon phaseId null → 204
- Seed demo: useri `pm@gradix.local` `ss@gradix.local` `worker@gradix.local` (ista `SEED_PASSWORD` kao Faza 1, mustChangePassword false) + projekat+2 faze+3 taska+2 qty; PM, SS, **WORKER** assigned

## Van scope

Fleet/Machine/Trip, Gantt UI, dashboard, tenders, auto količine iz tura, `/projects/picker`
