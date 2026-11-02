# Faza 5 — Web ops UI (**LOCKED** 2026-08-15)

**Cilj:** projects/tasks/fleet/logistics/diary/HSE lista na Vite shellu. Nema tender/payroll/public/ERP.

**Status plana:** zaključano. Kod tek na „izvrši Fazu 5“.

**Preduslov:** Faze 2–4 API + Faza 3 shell.

**Matrice:** `data-scope`, `spend-progress`, `diary`, `screens`, `hse`, `gps`

## Pravila

- Nav = [screens](../../docs/matrices/screens/MATRIX.md) web rute (unija permisija). Faza 3 redirect za `/projects` **ukida se**.
- Bell klik **smije** deep link (`data.projectId` / `taskId` / `tripId`) ako ruta postoji; inače mark read.
- Mobile `< md`: create/dispatch/filter u **Sheet**, ne Dialog.
- Gantt: samo planned start/end, read-only. **5.2b drag-drop opciono**, ne zatvara fazu.
- Leaflet OSM (nema API key). Presence pin opciono; lista i dalje bez koordinata u JSON.
- Web timer: isti API 2/4; WORKER/OP/SS start-stop-pause na tasku; complete samo `tasks.write`.

## Diary API (ovdje, ne čekati 6.0)

Po [diary](../../docs/matrices/diary/MATRIX.md). Unique (companyId, projectId, date TZ). Max 20 foto. ON_HOLD write OK; terminal 409. Konflikt 409 `DIARY_CONFLICT` + resolve A/B/merge. PDF nije ovdje (7.4).

## Dashboard

`GET /api/dashboard` (`auth`):

| Rola | 4 kartice |
|---|---|
| ADMIN/SUPER_ADMIN/ACC | projekti aktivni, spend vs budget ili „—“, open timeri firme, unread |
| PM/SS | scoped projekti, progress avg ili „—“, presence count, unread |
| WORKER/OP | moji taskovi (broj), moj timer elapsed ili „—“, unread, **bez** budget/spend |
| DRIVER | ture danas (own), **bez** budget |
| MECHANIC | mašine firme (broj), **bez** budget |

Spend bar samo ako `plannedBudget` i `currentSpend` postoje; inače „—“. Presence widget PM/SS/ADMIN: `GET .../presence`.

## Segmenti UI

- **5.1** Dashboard gornje
- **5.2** `/projects` lista + tabovi: Pregled, Faze, Zadaci, Tim, Mašine, Ture, Količine (`quantities.read`), Dnevnik, Dokumenti, Troškovi (fuel). WORKER nema ovu rutu (403/hide).
- **5.3** `/tasks` board + dispatch Sheet
- **5.4** `/fleet` lista + karton. **5.4b** `/fleet/map` Leaflet
- **5.5** `/logistics` + CSV export (`trips.read`). Šifarnik materijala/deponija
- **5.6** `/diary` kalendar TZ
- **5.7** `/hse` lista (`hse.read`). Create: Sheet za SS web-only (online). Mobile create Faza 6.

## API (novo)

| Method | Path |
|---|---|
| GET | `/api/dashboard` |
| CRUD | `/api/diary` |
| POST | `/api/diary/:id/photos` |
| POST | `/api/sync/resolve-conflict` |
| GET | `/api/incidents` (lista; create Faza 6.0b smije i ovdje ako SS Sheet) |

## Error codes

`DIARY_CONFLICT` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` + Faza 4 kodovi u formama

## Acceptance

- PM ne vidi tuđi projekat u tabeli; WORKER `/projects` hide + URL → dashboard
- DRIVER+PM vidi `/fleet`; samo DRIVER ne vidi `/fleet`
- WORKER dashboard bez budget broja; spend „—“ ako nema budget
- SS presence: ping >30 min nestaje
- Gantt bez actual barova
- Dva SS isti dan → resolve UI, ne tihi overwrite
- Tab količine: SS executed; progress KPI isti
- Dispatch Sheet `< md`; Leaflet bez key
- Bell `TASK_DISPATCHED` otvara task

## Van scope

Tender kanban, payroll, public, ERP, report builder, 5.2b nije blocker
