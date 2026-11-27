# Tenders — matrica (v2 / F7)

Status: **active**. Modul 8 (Faza 7), 2026-11-23. Nasljeđuje R7 (2026-11-20).
Izvor: `v2/docs/specs/08-tenderi.md` §1.1–1.7 (ZAKLJUČANO).

## Statusi

`OPPORTUNITY` → `GO_NO_GO` → `PREPARATION` → `SUBMITTED` → `EVALUATION` → `WON` | `LOST` | `WITHDRAWN` | `CANCELLED`

| From | To |
|---|---|
| OPPORTUNITY | GO_NO_GO, CANCELLED |
| GO_NO_GO | PREPARATION, CANCELLED |
| PREPARATION | SUBMITTED, CANCELLED |
| SUBMITTED | EVALUATION, WON, LOST, WITHDRAWN |
| EVALUATION | WON, LOST, WITHDRAWN |
| WON / LOST / WITHDRAWN / CANCELLED | (terminal) |

BS UI: Prilika, Odluka o učešću, Priprema, Predano, Ocjenjivanje, Dobijeno, Izgubljeno, Povučeno, Otkazano.

Migracija: `DRAFT` → `OPPORTUNITY` (§1.1/5); stari `SUBMITTED`, `WON`, `LOST`, `WITHDRAWN` ostaju.
Prelazak u `PREPARATION` bez odluke (`participate` + `decided_by` + `decided_at`) odbijen je
`TENDER_DECISION_REQUIRED`. Svaki prelazak u `SUBMITTED` traži `deadline_at`
(`TENDER_DEADLINE_REQUIRED`) i kompletnu checklistu (`TENDER_CHECKLIST_INCOMPLETE`).

## Polja

- `company_id`, `title`, `partner_id` (FK partners; tipično kind `CLIENT`)
- Money: `submitted_value_cents` + `currency_code`; `estimated_value_cents` = procjena naručioca (odvojeno)
- `submitted_at` (set kad tender prvi put pređe u `SUBMITTED`), `status`, `note`
- Rokovi: `deadline_at` (obavezan za predaju), `questions_deadline_at`, `site_visit_at`, `opened_at`
- Izvor: `source` ∈ `PORTAL|INVITATION|DIRECT|OTHER`, `portal_name`, `external_ref` (unique po firmi kad postoji)
- Odluka: `participate` + `decision_reason` + `decided_by` + `decided_at` (cjelina ili ništa)
- Cijena: `price_source` ∈ `CALCULATED|MANUAL`, `markup_pct`, `current_revision`
- `converted_project_id` UNIQUE nullable; FORCE RLS; no DELETE

## Prilozi

`attachments` (`entity_type='TENDER'`) kroz jedinstveni `attachment-service`: register → MinIO PUT →
confirm (`pending`→`ready`). Konverzija **ne** kopira bajtove: nova veza na isti `object_key`.

## Obligations × TENDER

`obligations.tender_id` + `entity_kind=TENDER`; `obligations_one_scope` uključuje tender.
Tipovi: `TENDER_DOCS` (postojeći), `TENDER_DEADLINE`, `TENDER_QUESTIONS` — `{14,7,3,1}`,
`blocks_assignment=false`. Prijelaz u `PREPARATION` pravi `TENDER_DEADLINE` i `TENDER_QUESTIONS`
automatski; ponovni poziv ne pravi duplikat.

## Convert WON

`POST /api/tenders/:id/convert` — `tenders.convert`, samo `WON` + `converted_project_id IS NULL`.

- Jedna `withCompany` transakcija: projekat (`contract_value_cents` = odobrena revizija),
  predmjer 1:1 u `project_boq_items`, faze, obaveze izvođenja, reference priloga, predloženi tim.
- Claim `UPDATE ... WHERE status='WON' AND converted_project_id IS NULL`; gubitak claima →
  409 `ALREADY_CONVERTED`.
- Nije WON → 409 `TENDER_INVALID_STATUS`. Djelimična konverzija nije moguća (jedna transakcija).

## Kalkulacija × revizije

`tender_boq_items` (kao `project_boq_items`) + `tender_resources` → `direct_cost`.
`markup_pct + risk_reserve_pct − discount_pct` → `offered_value`. Revizije su
`tender_price_revisions` (append-only; UPDATE samo za `approved_at`/`approved_by`).
Izmjena > 5 % ili marža ispod `companies.min_markup_pct` traži `tenders.price.approve`.

## Dozvole

| Permission | Role |
|---|---|
| `tenders.view` | OWNER, ADMIN, PROJECT_MANAGER, ACCOUNTANT |
| `tenders.manage` | OWNER, ADMIN, PROJECT_MANAGER |
| `tenders.convert` | OWNER, ADMIN, PROJECT_MANAGER |
| `tenders.price.manage` | OWNER, ADMIN, PROJECT_MANAGER |
| `tenders.price.approve` | OWNER, ADMIN |
| `tenders.outcome.manage` | OWNER, ADMIN, PROJECT_MANAGER |

ACCOUNTANT vidi vrijednost ponude i ishod, **ne** kalkulaciju ni maržu.

## Ishod i uspješnost

`tender_outcomes` UNIQUE po tenderu; `LOST|WITHDRAWN|CANCELLED` traže `lost_reason`.
Uspješnost je izračun (`/ured/tenderi/uspjesnost`): win rate po broju i vrijednosti, prosječna
marža dobijenih vs izgubljenih, po naručiocu; „vrijednost u toku“ = `OPPORTUNITY|GO_NO_GO|PREPARATION|SUBMITTED|EVALUATION`.

## Partneri (R7.1)

`partners.kind` ∈ `VENDOR|SERVICE|OTHER|CLIENT`. UI `/ured/partneri`; PATCH + deactivate.

## Van obima

E-tender integracije sa portalima, automatsko preuzimanje tendera, dražbe, viševalutna konverzija,
PDF generator ponude kao fajl (Modul 12), kopiranje bajtova priloga.
