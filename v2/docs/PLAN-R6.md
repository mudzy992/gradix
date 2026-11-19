# R6 — Obračun sati i troškovi projekta (plan)

**Status: ODOBREN** (vlasnik 2026-11-19). Partneri **van** ovog reza. Izvor: `MASTER_BRIEF.md` §R6; R5 zatvoren (`PLAN-R5.md`, STATUS).

## Odluke

| Stavka | Ishod |
|---|---|
| Opseg | **C**: trošak/sat mašine + knjiženje na projekat **i** obračun radničkih sati + CSV + dashboard |
| Partneri | **kasnije** (tabela `partners` iz R5.5 ostaje; nema ured menija u R6) |
| Sidebar | Pregled / Evidencija / Mehanizacija / Rad·obračun / Administracija |

## Vertikalni rezovi

| # | Rez | Šta |
|---|---|---|
| **R6.0** | Sidebar | Regroup `nav.ts` (bez nove domene) |
| **R6.1** | Trošak mašine | `machine_cost_rates` + `project_cost_entries`; formula: sati × stopa (Money); gorivo/servis ne u €/h |
| **R6.2** | Obračun + CSV + dashboard | Izvoz zaključenih sati (CSV); agregati vlasnik/PM na pregledu |

## Van obima R6

Partneri UI; R7+; puna plata; GPS; nove UI komponente bez odobrenja; v1.

## Sigurnost

FORCE RLS; privilege-matrix + preflight; `withCompany`; Money samo centi + valuta.
