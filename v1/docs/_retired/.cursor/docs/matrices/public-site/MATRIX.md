> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Public site — matrica

Status: **locked**. Faza 8. Settings `public.*` smiju postojati prazni od Faze 1.

## Rute

- Panel: `/login` (nije public home)
- Public: `/p/:slug` (Vite rute izvan auth layouta)
- API: `GET /api/public/:slug`, `GET /api/public/:slug/projects`, `GET /api/public/assets/:id`

Bez auth. Rate-limit public GET **60/min/IP**.

## DTO whitelist (firma)

Samo: `name` (ili public.companyName), `tagline`, `city`, `address`, `phone`, `logoAssetId`, `contact`. **Bez** taxId, slug internih id-jeva osim public slug.

## DTO whitelist (projekat)

Samo: `name`, `locality` (grad/opština string; **ne** lat/lng), `status`, `coverAssetId`.  
Zabranjeno u response: plannedBudget, currentSpend, progressPercent, workers, documents, GPS, client contact interne, companyId nije tajna ali ne leakati interne id-jeve osim public project id ako treba za key — **ne** slati budget/spend/coords.

Ne `isPublic=false` → nije u listi. Nepostojeći slug → 404 (isti kao tuđi, nema enumeracije).

## Cover

`PublicAsset` id → stream iz MinIO. Nije `?path=` i nije javni bucket listing.

## Write

ADMIN `public.write`: toggle `Project.isPublic`, public settings, upload cover.

## Error

`NOT_FOUND` `FORBIDDEN` (write) `VALIDATION_FAILED`
