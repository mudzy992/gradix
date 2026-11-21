> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Trips / deponija / vagar — matrica

Status: **locked** (Faza 4.2). Immutable + [amendments](../amendments/MATRIX.md).

## Create

DRIVER: `projectId` iz picker, `machineId` TRUCK po pravilu, `materialId`, `quantity` Decimal obavezno, originText, origin GPS opciono.

## Deponija + QR

`Depot`: companyId, name, qrToken unique, lat/lng opciono, isActive.  
QR **opcion**. Scan postavlja `destDepotId`. Nije uvjet complete.

## Complete

`POST /trips/:id/complete`: `unloadedAt`.  
Dest GPS: ako depot ima lat/lng → kopiraj; inače klijent šalje dest GPS **opciono** (nema 400 bez GPS).

## Vagar

`weighTicketPath` opcion (upload), `weighQty` opcion Decimal.  
Izvor istine za turu = `quantity` (vozač). Vagar = evidencija. SS amend može uskladiti `quantity` s `weighQty`.

## Katalog materijala

`Material`: companyId, name, unit (isti enum kao quantities + `L`), isActive.  
Delete = isActive false ako postoji Trip. Šifarnik: `trips.write` ili `settings.write`.

## Terminal projekat

ON_HOLD / COMPLETED / CANCELLED / archived → novi trip 409 (`PROJECT_ON_HOLD` / `PROJECT_TERMINAL`). Amendment na starom OK.

## Gorivo

`receiptPath` opcion (jpeg/png, upload matrica). Poslije sync immutable (nije u amendment whitelist).

## Error

`TRIP_IMMUTABLE` `FUEL_PROJECT_REQUIRED` nije ovdje  
`PROJECT_ON_HOLD` `PROJECT_TERMINAL` `VALIDATION_FAILED` `FORBIDDEN`
