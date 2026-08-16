# ERP-lite — matrica

Status: **locked**. Faza 10. Do tada Project.client ostaje string.

- Partner: CLIENT | SUPPLIER, companyId
- CostEntry: amount Decimal, category, source MANUAL|FUEL|SERVICE|PAYROLL, sourceId optional. Unique `(companyId, source, sourceId)` kad sourceId set.
- Spend: Fuel/Service u currentSpend dok ne postoji CostEntry sa tim sourceId; tad samo CostEntry
- `Warehouse.type`: `SITE` | `YARD` | `CISTERN` (nema drugih u v1)
- FuelEntry **ne** kreira StockMovement. Opciono `POST /api/fuel/:id/apply-stock` (erp.write): skida s CISTERN, idempotent po fuelEntryId.
- StockMovement ne smije ići u minus bez Settings `erp.allowNegativeStock` default false
- Nije GL, PDV, banka, e-faktura. Nije OWN/RENTED mašina.
