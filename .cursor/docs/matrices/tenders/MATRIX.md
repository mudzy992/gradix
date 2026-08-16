# Tenders — matrica

Status: **locked**. Faza 7.1.

## Statusi

`DRAFT` → `SUBMITTED` → `WON` | `LOST` | `WITHDRAWN`

- `DRAFT` → `SUBMITTED` | `WITHDRAWN`
- `SUBMITTED` → `WON` | `LOST` | `WITHDRAWN`
- `WON` / `LOST` / `WITHDRAWN`: terminal (nema povratka u v1)

## Polja

`companyId`, title, client (string do ERP), submittedValue Decimal, submittedAt, status, notes, `convertedProjectId` nullable.

`TenderAttachment`: path, fileName (0–N, [upload](../upload/MATRIX.md)). Convert WON **ne** kopira priloge na projekat.

## Convert WON

`POST /api/tenders/:id/convert` samo `WON` + `tenders.write`.

- Isti `companyId`. Novi Project: name=title, client=client, plannedBudget=submittedValue, status PLANNING, faze prazne, isPublic false.
- `convertedProjectId` set; ponovni convert → 409 `TENDER_INVALID_STATUS`.
- Nije WON → 409 `TENDER_INVALID_STATUS`.

## Usporedba (nije score)

Read-only: `submittedValue` vs aritmetička sredina `currentSpend` projekata firme sa statusom COMPLETED (0 completed → “—”). Nema AI, nema pondera, nema rank kolone.

## Scope / permisije

- Lista scoped po firmi. PM vidi sve tendere firme (nije project-scoped).
- Write: ADMIN, SUPER_ADMIN, PM (`tenders.write`). ACC nema write.

## Error

`TENDER_INVALID_STATUS` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED`
