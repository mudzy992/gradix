# Data scope — matrica

Status: **locked** (Faza 2 projekti/taskovi; ostalo Faza 4+). Faza 1: `scopeByCompany` na User/Setting/Notification/Audit.

Enforcement: query helper `scopeByCompany` + `scopeByProject`, nikad “vrati sve pa filter u UI”.

Svi redovi (osim Company liste za platformu) imaju `companyId` = firma iz DB usera. `X-Company-Id` se čita **samo** ako je caller PLATFORM_ADMIN; inače 400 `TENANT_HEADER_FORBIDDEN`. PLATFORM_ADMIN bez headera na tenant ruti → 403 `TENANT_HEADER_REQUIRED`.

## Projekti

- PLATFORM_ADMIN (s izabranom firmom), SUPER_ADMIN, ADMIN, ACCOUNTANT: svi projekti firme, uključujući archived uz `?archived=true`
- PM, SITE_SUPERVISOR: `ProjectAssignment` mora postojati. PM create → auto-assign sebe.
- `GET /projects` lista: **nije** za WORKER/OP/DRIVER/MECHANIC (403). DRIVER/OP picker = Faza 4.
- `GET /projects/:id`: WORKER/OP ako `ProjectAssignment` ili `TaskAssignment`. DTO bez budget/spend/client.
- DRIVER/OP: `GET /api/projects/picker` (Faza 4) — assignment ili aktivna mašina; nije puni `/projects`

## Zadaci / timer

- `tasks.write` / dispatch: ADMIN, PM, SS — i samo unutar scoped projekata
- `tasks.timer`: assigned na task, ili SS na scoped projektu (SS smije start bez ličnog TaskAssignment **ako** task ima ≥1 assignee). PENDING → 409
- WORKER/OP: samo svoji assignmenti
- Lista `GET /tasks`: isti filter
- `GET /api/timer?projectId=`: ADMIN/PM/SS scoped; WORKER/OP 403

## Ture / gorivo

- DRIVER: create/complete `driverId = me`; lista own; kamion = TRUCK + (njegova dodjela ili IDLE/ACTIVE na projektu)
- Pregled (`trips.read`): ADMIN/PM/SS/ACC scoped kao projekti
- Gorivo: `projectId` obavezan ako mašina ima aktivnu dodjelu
- OP/DRIVER gorivo samo na dodijeljenoj/voženoj mašini
- Nakon sync: DRIVER nema PUT; ispravka `Amendment` (SS/ADMIN)

## Flota

- CRUD: ADMIN, PM (PM: mašine assigned na njegove projekte ili slobodne IDLE u firmi)
- MECHANIC: read sve mašine firme; write servis
- Mapa: ADMIN, PM (svoje), SS (svoje)

## Settings / users

- Users: samo ista firma; PLATFORM_ADMIN vidi firmu koju je izabrao
- Settings: per `companyId`

## Dashboard KPI

- ADMIN/ACC/SUPER_ADMIN: firma
- PM/SS: scoped projekti
- WORKER/OP: broj svojih taskova + vlastiti open timer; **bez** budget/spend kartice
- DRIVER: ture danas (own); bez budget

## Presence

- PM/SS/ADMIN: widget “na terenu” za scoped projekte (`GET .../presence`). WORKER ne vidi tuđu listu.

## Izvještaji

- ACC/ADMIN: cijela firma
- PM: svoji projekti
- SS: read samo svoji projekti (`reports` R)

## hourlyRate

- Svoj: na `/me` i payroll vlastiti red
- Tuđi: samo `payroll.read`

## Količine

- Ista granica kao projekti. WORKER/OP/DRIVER nema listu.

## Izvori

- (Faza 1–2) `backend/src/common/scope/`
