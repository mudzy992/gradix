> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Audit — matrica

Status: **locked** (Faza 1 persist). `action` **zatvoren**; novi = ovaj fajl. Nema `/audit` UI.

## Model

`AuditEvent`: companyId?, actorId, action, entityType, entityId, payload Json, createdAt.  
PLATFORM_ADMIN: uvijek upisati `companyId` iz headera kad postoji.

Nije changelog UI u v1 (nema `/audit` ekrana). Čitanje: SUPER_ADMIN kasnije; v1 samo persist + test da se piše.

## Actions v1

Faza 1: `USER_CREATED` `USER_UPDATED` `USER_DEACTIVATED` `USER_ROLES_CHANGED` `PASSWORD_CHANGED` `PASSWORD_RESET` `SETTINGS_UPDATED` `COMPANY_CREATED` `COMPANY_UPDATED` `COMPANY_DEACTIVATED`

Faza 2+: `PROJECT_CREATED` `PROJECT_STATUS` `TASK_COMPLETED` `TASK_CANCELLED` `TIMER_AUTO_CLOSED` `TIMER_FORCE_CLOSED` `TIMER_AMENDED`

Faza 4+: `TRIP_AMENDED` `FUEL_AMENDED` `MACHINE_HOURS_CORRECTED`

Faza 9: `PAYROLL_APPROVED` `PAYROLL_REJECTED`

Faza 10: `COST_ENTRY_CREATED` `STOCK_MOVEMENT`

Ne logovati login success (šum). Login throttle ostaje.

## Payload

Bez passwordHash, bez IoT plaintext key, bez refresh tokena.
