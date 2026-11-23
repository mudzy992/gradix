# Tenders — matrica (v2 / R7)

Status: **active**. Vertikal R7 (2026-11-20).
Izvor: v1 tender-status + tenders.service (samo čitanje); vlasnik 1-C + 2-B.

## Statusi

`DRAFT` → `SUBMITTED` → `WON` | `LOST` | `WITHDRAWN`

| From | To |
|---|---|
| DRAFT | SUBMITTED, WITHDRAWN |
| SUBMITTED | WON, LOST, WITHDRAWN |
| WON / LOST / WITHDRAWN | (terminal) |

BS UI: Nacrt, Predano, Dobijeno, Izgubljeno, Povučeno.

## Polja

- `company_id`, `title`, `partner_id` (FK partners; tipično kind `CLIENT`)
- Money: `submitted_value_cents` + `currency_code`
- `submitted_at` (set na DRAFT→SUBMITTED), `status`, `note`
- `converted_project_id` UNIQUE nullable
- FORCE RLS; no DELETE

## Prilozi

`tender_attachments`: register → MinIO PUT → confirm (`pending`→`ready`).
Convert **ne** kopira priloge na projekat.

## Obligations × TENDER

`obligations.tender_id` + `entity_kind=TENDER`; `obligations_one_scope` uključuje tender.
Filter: `/ured/rokovi?entityKind=TENDER` i detalj tendera.

## Convert WON

`POST /api/tenders/:id/convert` — `tenders.convert`, samo `WON` + `converted_project_id IS NULL`.

- Jedna `withCompany` transakcija: `createProject` (name←title), claim `updateMany`, audit `tender.converted` + `project.created`.
- Ponovni convert → 409 `ALREADY_CONVERTED`.
- Nije WON → 409 `TENDER_INVALID_STATUS`.

## Dozvole

| Permission | Role |
|---|---|
| `tenders.view` | OWNER, ADMIN, PROJECT_MANAGER, ACCOUNTANT |
| `tenders.manage` | OWNER, ADMIN, PROJECT_MANAGER |
| `tenders.convert` | OWNER, ADMIN, PROJECT_MANAGER |

## Partneri (R7.1)

`partners.kind` ∈ `VENDOR|SERVICE|OTHER|CLIENT`. UI `/ured/partneri`; PATCH + deactivate.

## Van obima (R7)

Predmjer/kalkulacija, garancije, checklista dokumenata, izvještaj uspješnosti, kopiranje priloga.
