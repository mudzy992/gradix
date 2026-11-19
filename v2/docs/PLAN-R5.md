# R5 — Mehanizacija u radu (plan, bez koda)

**Status: ODOBREN** (vlasnik 2026-11-19). Kod/migracije tek nakon ovog dokumenta. Izvor: `MASTER_BRIEF.md` §R5; R4b zatvoren (`PLAN-R4.md` §11, STATUS.md).

## (1) Vertikalni rezovi (redoslijed vlasnika)

| # | Rez | Entiteti (prvi rez ≤1 + ured lista) | B15 u rez |
|---|---|---|---|
| **R5.1** | **Sati mašine** | `machine_work_logs` + ured lista; očitanje → `machine_meter_readings` + update `machines.meter_value` | — |
| R5.2 | Gorivo | `fuel_entries` (Money: centi + `currency_code`) | valuta uz iznos |
| R5.3 | Ture | `hauls` | stacionaža nullable FK ako tura veže dionicu |
| R5.4 | Dnevni pregled | `machine_daily_checks` + foto preko postojećeg attachment toka | — |
| R5.5 | Kvarovi | `machine_faults` | partner nullable ako vanjski servis; tok odobravanja ako prag troška servisa |

Amendment (kao R4b revise): ture/gorivo/sati — original se ne prepisuje. **Trošak po satu → R6** (izvan R5).

## (2) Mašine / brojila: postoji vs novo

| | |
|---|---|
| `machines` (+ `meter` HOURS/KM, `meter_value`, `meter_updated_at`) | **postoji (STATUS.md)** — samo **trenutna** vrijednost (`schema.prisma`) |
| `equipment_categories.meter` | **postoji (STATUS.md)** — zadana vrsta brojila |
| `machine_meter_readings` | **novo** — append-only historija; pri upisu ažurira `machines.meter_*` |
| `machine_work_logs`, `fuel_entries`, `hauls`, `machine_daily_checks`, `machine_faults` | **novo** |

## (3) Mobilni sync

Isti obrazac kao R4a (**postoji (STATUS.md)** / PLAN-R4): outbox na uređaju; server receipt + idempotency po `local_id`; change-log/cursor po firmi; sukob = OPEN sync_conflict (ne tihi overwrite); offline unos pa sync. Nove vrste stavki (sati/gorivo/tura/pregled/kvar) u istom sync ugovoru — **novo** payload tipovi, ne novi sync motor.

## (4) Role i dozvole

| Dozvola (novo u `permissions.ts` + nav) | Ko |
|---|---|
| `machines.work_log.*` | MACHINE_OPERATOR (svoje), SITE_SUPERVISOR (opseg), PM/OWNER/ADMIN |
| `machines.fuel.*` | DRIVER (+ OPERATOR), mutate; **cijenu goriva vide:** OWNER, ADMIN, ACCOUNTANT, PM, SITE_SUPERVISOR (odluka vlasnika) — WORKER/DRIVER bez price u API/UI |
| `machines.haul.*` | DRIVER, PM, OWNER/ADMIN |
| `machines.check.*` / `machines.fault.*` | OPERATOR, MECHANIC, SS, PM, OWNER/ADMIN |

E2E dosegljivost: ured lista R5.1; role bez mutate → nema dugmeta; cijena goriva sakrivena za DRIVER u R5.2.

## (5) Trošak po satu

**R6** — nije u R5. R5 skuplja sati/gorivo/servisne ulaze; izvod €/h kasnije.

## (6) Foto pregleda

**postoji (STATUS.md)** tok priloga obaveza (presign → confirm → lista). R5.4 veže isti obrazac na `machine_daily_checks` (isti limiti `MAX_ATTACHMENT_BYTES` / content-type — **postoji (STATUS.md)**). Bez nove UI komponente dok vlasnik ne odobri.

## (7) B15 — u kojem rezu (nullable kolona ili tabela)

| Stavka | Rez | Oblik |
|---|---|---|
| Stacionaža | R5.3 (+ kasnije sati ako treba) | tabela `route_segments` (**novo**) + nullable `segment_id` na `hauls` / po potrebi `machine_work_logs` |
| Partner | R5.5 | tabela `partners` (**novo**) + nullable `partner_id` na `machine_faults` / servis |
| Tok odobravanja | R5.5 kad uđe prag troška | `approval_flows` (**novo**) ili reuse R4b week pattern samo za fault cost — odluka u rez plan-u pri kodu |
| Valuta uz iznos | R5.2 | Money: `amount_cents` + `currency_code` na `fuel_entries` (**novo** kolone; default `companies.currency` **postoji (STATUS.md)**) |

## Migracije / sigurnost (svi rezovi)

FORCE RLS; privilege-matrix + preflight; `withCompany`; bez ad-hoc SQL. Money samo centi + valuta.

## Van obima R5

Trošak po satu (R6); SaaS naplata; GPS; store build; nove UI vrste bez odobrenja.

## Testovi po rezu

| Rez | Test | Dokazuje |
|---|---|---|
| **R5.1 Sati mašine** | integracija RLS | firma B ne vidi logove A |
| R5.1 | unique/overlap | preklop intervala sati iste mašine → odbijeno; meter reading ne ide unazad bez amendment |
| R5.1 | sync idempotencija | isti `local_id` → jedan log |
| R5.1 | amendment | ispravka sati → revizija; original ostaje |
| R5.1 | role + E2E | OPERATOR vidi unos; ACCOUNTANT lista read-only; ured lista dosegljiva |
| R5.2 | RLS + Money | cijena samo dozvoljenim rolama; centi+valuta |
| R5.2 | sync idempotencija | dupli receipt točenja → jedan red |
| R5.3–5 | RLS, sync, amendment, E2E role | isto kao R5.1 po entitetu; R5.4 attachment limit |
