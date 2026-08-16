# Faza 8 — Javni one-page firme (**LOCKED** 2026-08-15)

**Cilj:** `/p/:slug` bez auth. Apple-linear, responsive, iste boje.

**Status:** zaključano. Kod tek na „izvrši Fazu 8“.

**Matrice:** `public-site`, `settings`, `upload`  
**Preduslov:** Faza 3 shell + Faza 1 public settings keys.

## Šema

- **PublicAsset:** companyId, path, mime, kind `LOGO|COVER`. Stream po **id**, ne po path query.

## Pravila

- Panel `/` i dalje `/login`. Public samo `/p/:slug` izvan auth layouta (hero, about, kontakt, projekti).
- `GET /api/public/:slug` + `/projects` + `/assets/:id`. Throttle public GET **60/min/IP**.
- Nepostojeći **i** tuđi slug → isti 404 (nema enumeracije firmi).
- Firma DTO: name (ili `public.companyName`), tagline, city, address, phone, logoAssetId, contact. **Bez** taxId, budget, internih id osim slug.
- Projekat DTO: name, locality, status, coverAssetId. **Bez** plannedBudget, currentSpend, progressPercent, lat/lng, workers, documents, client interne. Samo `isPublic=true`.
- Write: `public.write` (ADMIN/SUPER_ADMIN). Toggle `PATCH /projects/:id/public`. Cover → PublicAsset. WORKER 403.
- i18n BS/EN iz `navigator.language` ili toggle; default BS. Nema Sheet CRUD.

## API

| Method | Path | Auth |
|---|---|---|
| GET | `/api/public/:slug` | no |
| GET | `/api/public/:slug/projects` | no |
| GET | `/api/public/assets/:id` | no |
| PATCH | `/api/projects/:id/public` | public.write |
| POST | `/api/public/assets` | public.write |

## Error codes

`NOT_FOUND` `FORBIDDEN` `VALIDATION_FAILED` `PAGINATION_LIMIT`

## Acceptance

- JSON projekta nema budget/spend/lat/lng/workers
- JSON firme nema taxId
- `isPublic=false` nije u listi
- Tuđi slug 404
- Cover preko asset id, ne MinIO URL u HTML
- WORKER 403 PATCH public
- `/` → `/login` (nije public home)

## Van scope

Multipage CMS, blog, SEO dashboard, custom domen per company
