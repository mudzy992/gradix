# Spend / progress — matrica

Status: **locked** (progress Faza 2; spend kasnije). Bez formule nema KPI broja (prikaži “—”). Nema `/dashboard` u Fazi 2.

## Progress

- Faza: `completedTasks / totalTasks` u toj fazi (CANCELLED se ne računa). 0 taskova → 0.
- Projekat: **MVP: aritmetička sredina progressa faza** (svjesno pojednostavljenje, nije tačan % izvedbe).
- Predmjer ([quantities](../quantities/MATRIX.md)) **nije** ovaj broj; tab + report odvojeno.
- Nema ručnog override u MVP (izbjegava konflikt sa taskovima).

## Spend (`currentSpend`)

Sabira se u firmi/valuti projekta, Decimal:

1. Zbroj `FuelEntry.totalCost` na projektu (null cost = 0)
2. Od Faze 7: `ServiceRecord.totalCost` kad `projectId` set (inače nije u spend)
3. Od ERP faze: `CostEntry.amount` sa `projectId`

Nije u spend dok nema stope: timer minuti. Plate idu u payroll izvještaj, ne u `currentSpend`, dok ERP ne veže “obračun kao trošak”.

## Budget

- `plannedBudget` ručni unos. Upozorenje UI ako spend > budget. Nema bloka.

## Izvori

- Recalc i na **cancel** taska.
- Faza 4: spend += fuel
- Faza 7: spend += service
- Faza 10: spend += CostEntry
