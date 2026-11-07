> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# RBAC — matrica

Status: **locked** (model Faze 1). Permission string + guard. Unija uloga. Redovi: [data-scope](../data-scope/MATRIX.md). Stringovi: [permissions](../permissions/MATRIX.md). **Cijeli v1 katalog stringova u guardu od Faze 1** (rute kasnijih faza 404 dok ne postoje).

## Model

- N uloga po useru (`UserRoleAssignment`), min 1
- `ProjectAssignment.role` = oznaka na projektu, nije UserRole
- PLATFORM_ADMIN nije firma-rola; `companyId` null

## Role

PLATFORM_ADMIN, SUPER_ADMIN, ADMIN, PROJECT_MANAGER, SITE_SUPERVISOR, MACHINE_OPERATOR, DRIVER, WORKER, MECHANIC, ACCOUNTANT

## Eskalacija

- `PLATFORM_ADMIN` samo postojeći PLATFORM_ADMIN (seed)
- `SUPER_ADMIN` u firmi samo SUPER_ADMIN te firme (ili PLATFORM_ADMIN)
- ADMIN ne dodaje SUPER_ADMIN ni PLATFORM_ADMIN
- Zadnji SUPER_ADMIN u firmi se ne skida; zadnji PLATFORM_ADMIN u instalaciji se ne skida

## Funkcijski pristup (unija)

Isto kao ranije (users, tenderi, projekti, taskovi, ture, flota, servis, gorivo, dnevnik, dokumenti, izvještaji, settings) plus:

- Firme CRUD: samo PLATFORM_ADMIN
- Javni sajt content: ADMIN `public.write`
- Payroll write: ADMIN + SUPER_ADMIN
- ERP: ADMIN write, ACC read
- HSE create: teren; lista/close: SS/PM/ADMIN
- Predmjer: PM/SS write (SS executed + planned na scoped); ACC read; WORKER ne

SS timer: na scoped projektu, ne samo assigned task.
DRIVER+WORKER: ture + timer (unija).

## Izvori

- `backend/src/common/rbac/`
