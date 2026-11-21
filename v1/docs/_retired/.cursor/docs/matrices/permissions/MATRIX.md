> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Permissions — katalog

Status: **locked** (katalog v1). Guard provjerava string. Role mapa = unija. PLATFORM_ADMIN ima `platform.companies` + sve uz `X-Company-Id`.

## Stringovi

- `platform.companies`
- `users.read` `users.write`
- `settings.read` `settings.write`
- `notifications.read`
- `projects.read` `projects.write`
- `tasks.read` `tasks.write` `tasks.dispatch` `tasks.timer`
- `fleet.read` `fleet.write` `fleet.map`
- `trips.read` `trips.write`
- `fuel.write` `fuel.reports`
- `diary.read` `diary.write`
- `tenders.read` `tenders.write`
- `services.read` `services.write`
- `documents.read` `documents.write`
- `reports.read` `reports.export`
- `payroll.read` `payroll.write`
- `erp.read` `erp.write`
- `public.write`
- `hse.read` `hse.write`
- `quantities.read` `quantities.write`

## Mapa uloga → stringovi

- PLATFORM_ADMIN: `platform.companies` (+ sve na izabranoj firmi)
- SUPER_ADMIN: sve osim `platform.companies`
- ADMIN: sve osim `platform.companies` (uključuje `payroll.write`)
- PM: projects.*, tasks.read/write/dispatch (nema timer osim unije s WORKER), fleet, trips.read, fuel.reports, diary, tenders, reports, documents.read, `hse.read`, `quantities.read` `quantities.write`
- SS: projects.read (scoped), tasks.*, trips.read, fuel.write, diary, reports.read, fleet.read, fleet.map, hse.*, `quantities.read` `quantities.write` (executed)
- OP: tasks.read, tasks.timer, fuel.write, fleet.read (svoja mašina), hse.write
- DRIVER: trips.write, trips.read (own via scope), fuel.write, hse.write
- WORKER: tasks.read, tasks.timer, hse.write
- MECHANIC: fleet.read, services.*
- ACC: projects.read, trips.read, fuel.reports, documents.*, reports.*, payroll.read, erp.read, `quantities.read`

Točne granice redova: [data-scope](../data-scope/MATRIX.md). Funkcijski W/R: [rbac](../rbac/MATRIX.md).
