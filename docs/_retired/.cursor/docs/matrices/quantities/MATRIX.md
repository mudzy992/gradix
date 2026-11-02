> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Quantities / predmjer — matrica

Status: **locked** (Faza 2.5). **Ne** mijenja [spend-progress](../spend-progress/MATRIX.md) progress %.

## Entitet

`QuantityItem`: companyId, projectId, phaseId nullable, name 1–120, unit `M3`|`T`|`M`|`M2`|`PCS`|`H`, plannedQty Decimal ≥0, executedQty Decimal ≥0 default 0, note. Nema unique na name.

Nema BIM, nema auto-zbroj s tura. Tura `quantity` **ne** upisuje executed (ručno, da nema magije).

## Ko

- Read: `quantities.read` (ADMIN, PM, SS, ACC — scoped kao projekat). WORKER/DRIVER/OP nema.
- Planned write: `quantities.write` + ADMIN/PM/SUPER_ADMIN. SS PATCH s `plannedQty`/name/unit/phaseId → 403.
- Executed write: `quantities.write` + SS scoped ili ADMIN/PM (SS smije `executedQty`, `note`)

## Terminal

ON_HOLD: planned OK, executed OK.  
COMPLETED / CANCELLED / archived: samo ADMIN korekcija executed; inače 409 `PROJECT_TERMINAL`.  
`executedQty` smije biti veći od `plannedQty`.

## UI

Tab “Količine” na projektu (Faza 5). Nije mobile tab (SS može web). Report `phase-quantities`.

## Error

`PROJECT_TERMINAL` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED`
