# Timer — matrica

Status: **locked** (Faza 2.3; machineId Faza 4; offline startedAt Faza 6; PENDING Faza 9).

## Invarijante

- Max jedan session sa `closedAt` null po **useru** (uključujući pause) → 409 `TIMER_ALREADY_OPEN`. Migracija: `UNIQUE (companyId, (IF(closedAt IS NULL, userId, NULL)))`. Start dok pause **nije** auto-resume.
- Max jedan otvoren session po **mašini** (kad je `machineId` set) → 409 `MACHINE_IN_USE` (**Faza 4+**)
- Faza 2: `machineId` **mora null**; start/PATCH sa machineId ili `startedAt` → 400 `VALIDATION_FAILED`
- Mašina `IN_SERVICE` → 409 `MACHINE_IN_SERVICE` (Faza 7)
- Online start body: `{ taskId, lat?, lng? }` — klijent ne šalje `startedAt`. pause/resume/stop = moj `closedAt` null session; nema sessiona → 409 `CONFLICT`
- Online: `startedAt` = server `now` UTC
- Offline push (Faza 6): klijent `startedAt` obavezan; reject ako `> now+5min` ili stariji od `timer.maxOpenHours`
- Faza 4+: close sa machineId: `currentWorkingHours += durationMinutes/60`
- `durationMinutes` = floor((closed−start)/60) − pauseAccum (min 0). **Prije close/resume:** ako `pausedAt` set → `pauseAccum += floor((now−pausedAt)/60)`, `pausedAt=null`. Inače pause-then-stop prebroji pauzu.
- Pause **ne teče**: `pausedAt`, `pauseAccumMinutes`. Pause dok već pause / resume dok running → 409. `elapsedMinutes` u pauzi: do `pausedAt`, ne do now.
- GPS opciono; geofence ne blokira; GPS nije dokaz za payroll
- `Task.totalTimeSpentMinutes` = zbroj zatvorenih (bez pause)
- `approvalStatus` default APPROVED do Faze 9; tada novi = PENDING
- Auto-close: `timer.maxOpenHours` default 12; cron 15 min; `TIMER_AUTO_CLOSED`
- Payroll dan = `startedAt` u `app.timezone` (nema splita)
- Korekcija: zatvoren → Amendment `TIMER` / `durationMinutes`; open → 409
- Start ON_HOLD/terminal/archived → `PROJECT_ON_HOLD` / `PROJECT_TERMINAL`
- Deaktivacija usera/firme = force-close (Faza 2 hook)
- `localId` nullable; unique `(companyId, userId, deviceId, localId)` kad set (Faza 6)

## Ko smije

- Start: assigned na task, ili SS na scoped projektu **ako** task ima ≥1 assignee. PENDING (0 assigneeja) → 409
- `GET /api/timer?projectId=`: ADMIN/PM/SS scoped; WORKER/OP 403 (`/me`)
- Mašina: ACTIVE + assigned na isti projekat ili IDLE u firmi; i slobodna (nema open session)
- Stop/pause: samo vlasnik sessiona (WORKER/OP/SS svoj)
- Complete task: samo `tasks.write`. Zatvara sve open sessione + `TASK_COMPLETED`
- Cancel task: `tasks.write`; force-close sessiona, status CANCELLED (nije COMPLETED)

## Status taska

- Running = `closedAt` null ∧ `pausedAt` null. Mutex open = `closedAt` null.
- IN_PROGRESS: ≥1 running
- PAUSED: 0 running, nije COMPLETED/CANCELLED
- COMPLETED: `POST .../complete` (`tasks.write`) s ASSIGNED / IN_PROGRESS / PAUSED — zatvara running **i** paused. PENDING → 409
- Start na COMPLETED/CANCELLED → 409

## Offline

idempotent `(companyId, userId, deviceId, localId)`
