> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Faza 10 — ERP-lite (**LOCKED** 2026-08-15)

**Cilj:** partneri, ručni troškovi, lager. Nije knjigovodstvo.

**Status:** zaključano. Kod tek na „izvrši Fazu 10“.

**Matrice:** `erp`, `spend-progress`, `settings`  
**Preduslov:** Faza 4 fuel + Faza 7 service.

## Šema

- **Partner:** type `CLIENT|SUPPLIER`, name, taxId?, note?, isActive. `Project.partnerId` optional; `client` string **ostaje** fallback.
- **CostEntry:** amount Decimal, category `fuel|service|material|labor|other`, date, note?, source `MANUAL|FUEL|SERVICE|PAYROLL`, sourceId?, projectId?. Unique `(companyId, source, sourceId)` kad sourceId set (samo FUEL/SERVICE/PAYROLL).
- **Warehouse:** name, type `SITE|YARD|CISTERN` samo, projectId? (SITE).
- **StockMovement:** warehouseId, materialId, qty Decimal ≠0, projectId?, fuelEntryId? unique kad set.

## Pravila

- Spend: Fuel/Service u `currentSpend` dok **nema** CostEntry s tim sourceId; tad samo CostEntry. MANUAL uvijek +=. Recalc na create/delete CostEntry.
- `POST /cost-entries/from-payroll`: jedan CostEntry PAYROLL po (companyId, year, month TZ, projectId|null). Dupli → 409 `CONFLICT`.
- FuelEntry **ne** auto-skida lager. `POST /fuel/:id/apply-stock` (`erp.write`): skida CISTERN, idempotent po fuelEntryId.
- Minus zabranjen osim `erp.allowNegativeStock` default false → 409 `CONFLICT`.
- Warehouse type `TRUCK` (bilo šta osim 3) → 400.
- ACC `erp.read`; ADMIN/SUPER_ADMIN `erp.write`. WORKER 403.

## API

| Method | Path |
|---|---|
| CRUD | `/api/partners` `/api/cost-entries` `/api/warehouses` |
| POST | `/api/cost-entries/from-payroll` |
| POST | `/api/stock-movements` |
| POST | `/api/fuel/:id/apply-stock` |
| GET | `/api/stock` |

## Error codes

`FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` `CONFLICT`

## Acceptance

- ACC read, ADMIN write; WORKER 403
- Dupli CostEntry isti fuel sourceId → 409; spend se ne duplira
- Fuel create ne mijenja stock; apply-stock jednom smanji CISTERN; drugi put 200 isti movement
- Type TRUCK 400; negative default 409; flag true → 201
- Project.client string radi bez partnera

## Van scope

GL, PDV, banka, e-faktura, više warehouse tipova, OWN/RENTED
