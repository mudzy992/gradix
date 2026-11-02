# Notifications — matrica

Status: **locked** (Faza 1.6). Enum **zatvoren**; cijeli v1 katalog u Prisma od Faze 1.

## Type (v1)

`TASK_DISPATCHED` `TASK_COMPLETED` `TIMER_FORCE_CLOSED` `TIMER_AUTO_CLOSED` `GEOFENCE_ENTER` `GEOFENCE_EXIT` `DOCUMENT_EXPIRING` `SERVICE_DUE` `FUEL_ANOMALY` `HSE_CREATED` `AMENDMENT_CREATED` `DIARY_CONFLICT` `PAYROLL_REJECTED`

Ostalo → ne insert; log + skip.

## Kanal

- **In-app** obavezan: lista, unread, mark-one, mark-all. `Notification`: companyId, userId, type, title, message, data Json, isRead, readAt.
- Email: samo ako `features.email` (stub do SMTP u 7). Isti type, nije drugi enum.
- FCM: samo ako `features.push` (stub; wiring 6.5).
- **Nema SMS.**

## Socket

Server emit `notification:new` u `user:{id}`. Klijent ne join-a tuđi room.

## API

- `GET /api/notifications` paginirano, filter `unread`
- `PATCH /api/notifications/:id/read`
- `POST /api/notifications/read-all`

Permisija `notifications.read` (svi auth). Create samo server.

## Primaoci (zatvoreno)

| Type | Ko |
|---|---|
| `TASK_DISPATCHED` `TASK_COMPLETED` | assigneeji |
| `TIMER_FORCE_CLOSED` `TIMER_AUTO_CLOSED` `AMENDMENT_CREATED` | vlasnik sessiona / vozač |
| `GEOFENCE_*` | user čija je lokacija |
| `DOCUMENT_EXPIRING` | vidi documents-expiry |
| `SERVICE_DUE` | ADMIN, SUPER_ADMIN, svi MECHANIC u firmi |
| `FUEL_ANOMALY` | ADMIN, SUPER_ADMIN, ACCOUNTANT |
| `HSE_CREATED` | SS/PM scoped + ADMIN |
| `DIARY_CONFLICT` | oba autora |
| `PAYROLL_REJECTED` | vlasnik sessiona |

## Error

`NOT_FOUND` `FORBIDDEN` `PAGINATION_LIMIT`
