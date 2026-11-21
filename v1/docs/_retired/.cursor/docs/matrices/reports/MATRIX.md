> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Reports — matrica

Status: **locked**. Faza 7.4. **Nema** report builder, custom kolona, saved query.

## Fiksna lista (`slug`)

| slug | Šta | Permisija |
|---|---|---|
| `project-spend` | spend vs plannedBudget po projektu | `reports.read` |
| `machine-hours` | zbroj timer minuta po mašini | `reports.read` |
| `fuel-summary` | litre + cost po mašini/projektu | `reports.read` ili `fuel.reports` |
| `trips-summary` | ture po vozaču/projektu | `reports.read` |
| `tender-comparison` | submitted vs avg completed spend | `tenders.read` + `reports.read` |
| `phase-quantities` | planned vs executed po fazi | `quantities.read` + `reports.read` |

Ostali slug → 404 `REPORT_UNKNOWN`.

Payroll xlsx je Faza 9 (`/payroll/export`), nije ovaj katalog. Diary PDF je Faza 7.4 poseban endpoint, nije report slug.

## Query

`GET /api/reports/:slug?from=&to=&projectId=`  
Period u `app.timezone`. Default: tekući kalendarski mjesec.  
Export: `GET /api/reports/:slug/export` (`reports.export`) → xlsx.

## Scope

ACC/ADMIN/SUPER_ADMIN: firma. PM: svoji projekti. SS: read svoji projekti, nema export osim unije s ACC. WORKER nema `/reports`.

## Error

`REPORT_UNKNOWN` `FORBIDDEN` `VALIDATION_FAILED`
