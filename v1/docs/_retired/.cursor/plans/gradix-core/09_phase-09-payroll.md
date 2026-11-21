> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Faza 9 — Obračun sati / payroll export (**LOCKED** 2026-08-15)

**Status:** zaključano. Kod tek na „izvrši Fazu 9“.

**Matrica:** [payroll](../../docs/matrices/payroll/MATRIX.md)  
**Preduslov:** Timer Faza 2 + `hourlyRate`.

Nema nove permisije `payroll.approve`. Lista/export = `payroll.read`. Approve/reject = SS/PM scoped projekat ili ADMIN/SUPER_ADMIN.

## Pravila

- UI stopa: `PATCH /api/users/:id` polje hourlyRate **ili** `PATCH /api/users/:id/hourly-rate` — samo `payroll.write`. Faza 3: polje već sakriveno bez te permisije.
- Od ove faze: **novi** TimerSession `approvalStatus=PENDING`. Sessioni stvoreni prije ostaju APPROVED.
- SS/PM: samo scoped projekat; **ne** vlastiti session → 403 `PAYROLL_SELF_APPROVE`. ADMIN/SUPER_ADMIN: svi, uključujući sebe.
- GPS/geofence **nije** uvjet. Reject → `PAYROLL_REJECTED` vlasniku.
- Period = kalendarski **mjesec** u `app.timezone` (query `year`+`month` ili `from`/`to` u TZ). Session ulazi po `startedAt` TZ (nema splita).
- Export xlsx (`payroll.read`): user, projekat, task, startedAt, durationMinutes (bez pause), rate, amount. REJECTED nije u zbroju. PENDING nije u zbroju dok se ne approve.
- TIMER amend na APPROVED → status **PENDING**; nova duration u sljedećem exportu.
- Email stub ako `features.email`. Nije poreski obračun.

## API

| Method | Path | Perm |
|---|---|---|
| GET | `/api/payroll/sessions` | payroll.read **ili** SS/PM (scoped pending) |
| POST | `/api/payroll/sessions/:id/approve` `reject` | SS/PM/ADMIN |
| GET | `/api/payroll/summary` `export` | payroll.read |
| PATCH | `/api/users/:id/hourly-rate` | payroll.write |

## Error codes

`PAYROLL_SELF_APPROVE` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED`

## Acceptance

- REJECTED i pause minuti nisu u exportu; PENDING nije u zbroju
- WORKER vidi svoju stopu na `/me`; tuđu 403
- SS approve vlastiti → 403 `PAYROLL_SELF_APPROVE`; ADMIN sebe 200
- 1. u Sarajevu ≠ UTC mjesec
- Session 23:30 31. → close 01:00: cijeli iznos u mjesecu startedAt
- Amend APPROVED → PENDING; nova duration poslije approve
- GPS nije uvjet; WORKER dashboard i dalje bez firm budget

## Van scope

Doprinosi, PDV, bolovanje, prekovremeni koeficijent, bulk approve (nije v1)
