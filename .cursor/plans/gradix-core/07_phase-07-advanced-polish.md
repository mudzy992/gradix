# Faza 7 — Tender, servis, dokumenti, izvještaji, CI (**LOCKED** 2026-08-15)

**Preduslov:** tokovi 1–6. **Status:** zaključano. Kod tek na „izvrši Fazu 7“.

**Matrice:** `tenders`, `service`, `fleet-status`, `documents-expiry`, `reports`, `diary`, `ci-deploy`, `notifications`, `quantities`

## Šema (dodatak)

- **Tender:** title, client string, submittedValue Decimal?, submittedAt?, status DRAFT default, notes?, convertedProjectId?
- **TenderAttachment:** path, fileName (0–N)
- **ServiceTemplate:** machineType, intervalHours Int >0, title
- **ServiceRecord:** machineId, projectId?, templateId?, status, scheduledAt?, startedAt?, completedAt?, totalCost?, note, previousMachineStatus IDLE|ACTIVE?
- **CompanyDocument / WorkerDocument / MachineDocument:** type string 1–80, filePath, expiresAt?, note

## 7.1 Tenders

Kanban. Write ADMIN/SUPER_ADMIN/PM. ACC nema write. PM vidi sve tendere firme.  
Convert `POST .../convert` samo WON: Project PLANNING, name=title, client, plannedBudget=submittedValue, faze prazne, isPublic false, ista firma. Prilozi **ostaju** na tenderu (ne kopirati). Ponovni convert 409 `TENDER_INVALID_STATUS`.

Usporedba: submitted vs avg `currentSpend` COMPLETED projekata; 0 completed → „—“. Nije score.

## 7.2 Service

MECHANIC + ADMIN write. Start: mašina `IN_SERVICE` (spremi previous IDLE|ACTIVE); force-close open timera na toj mašini (`TIMER_FORCE_CLOSED`, close formula Faze 2); novi timer 409 `MACHINE_IN_SERVICE`. Complete/cancel: restore previous. Spend += totalCost ako projectId.  
Cron 6h UTC: preostalo ≤50h → SCHEDULED + `SERVICE_DUE` (ADMIN, SUPER_ADMIN, MECHANIC). Nest interval, nema Redis.

## 7.3 Documents

Warn 30/15/5, **ne** blok login/timer. Cron 08:00 `app.timezone`. `DOCUMENT_EXPIRING` jednom po prozoru. Primaoci: ADMIN+SUPER_ADMIN; worker doc + taj user; machine + MECHANIC.

## 7.4 PDF / reporti / cron

Diary PDF intern (`POST /diary/:id/pdf` → MinIO, pdfUrl). Nije pravni obrazac.  
Report slugovi zatvoreni ([reports](../../docs/matrices/reports/MATRIX.md)). Period TZ, default tekući mjesec. Export `reports.export`.  
Fuel anomaly: litres ovaj vs avg 30d > **25%** → `FUEL_ANOMALY` (ADMIN, SUPER_ADMIN, ACC). GPS raw cleanup 90d.

## 7.5 CI

GitHub Actions: lint+test+build backend/frontend; Playwright smoke **login**. **Nema** deploy job. TOTP opciono, ne zatvara. SMTP/FCM secrets samo ako flag; `features.email=false` ⇒ nema SMTP poziva.

## API

| Method | Path |
|---|---|
| CRUD | `/api/tenders` |
| POST | `/api/tenders/:id/attachments` `:id/convert` |
| CRUD | `/api/service-templates` `/api/services` |
| POST | `/api/services/:id/start` `:id/complete` `:id/cancel` |
| CRUD | `/api/documents/company` `/worker` `/machine` |
| GET | `/api/reports/:slug` + `/export` |
| POST | `/api/diary/:id/pdf` |

## Error codes

`TENDER_INVALID_STATUS` `MACHINE_IN_SERVICE` `REPORT_UNKNOWN` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED`

## Acceptance

- email flag false ⇒ 0 SMTP
- convert ista firma; not WON → `TENDER_INVALID_STATUS`; prilog nije na ProjectDocument
- Open timer + service start → closed, IN_SERVICE, novi start 409
- Istekli dokument: login i timer 200
- `GET /api/reports/custom` → 404 `REPORT_UNKNOWN`
- ACC vidi reports, ne dispatch
- CI workflow bez deploy joba

## Van scope

Public, payroll UI, ERP, IoT, TOTP blocker, auto-deploy
