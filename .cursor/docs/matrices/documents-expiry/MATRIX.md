# Documents expiry — matrica

Status: **locked**. Faza 7.3.

## Entiteti (svi `companyId`)

- `CompanyDocument` — firma (osiguranje, licence)
- `WorkerDocument` — userId (licence, ljekarski)
- `MachineDocument` — machineId (registracija, atest)

Polja: type string, filePath (upload matrica), expiresAt DateTime nullable, note.

## Istek = warn, ne blok

Istekli ili blizu isteka **ne** 403 na login, timer, dispatch, ture, gorivo. Samo in-app + dashboard.

## Prozor

Cron **08:00** u `app.timezone` firme. Notifikacija `DOCUMENT_EXPIRING` na 30, 15 i 5 dana (jednom po prozoru po dokumentu; payload `{ entityType, entityId, daysLeft }`).

Primaoci: ADMIN + SUPER_ADMIN; worker doc → i taj user; machine doc → MECHANIC + ADMIN.

## Dashboard

Lista “ističe” 5/15/30 (isti prozori). Nema auto-archive.

## Permisije

`documents.read` / `documents.write`. ACC read. Upload path `{companyId}/`.

## Error

`NOT_FOUND` `FORBIDDEN` `VALIDATION_FAILED` (nema `DOCUMENT_EXPIRED` kao blok).
