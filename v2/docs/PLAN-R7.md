# R7 — Tenderi + Partneri UI (plan)

**Status: ISPORUČENO** (vlasnik 2026-11-20: 1-C + 2-B).

## Odluke

| Stavka | Ishod |
|---|---|
| Opseg | v1 status matrica + prilozi + convert **+** obligations TENDER |
| Partneri | UI katalog + `CLIENT` + `partner_id` na tenderu |
| Van R7 | Predmjer, garancije, checklista, puni B5.3 izvještaj |

## Rezovi

| # | Rez | Šta | Stanje |
|---|---|---|---|
| R7.0 | Dizajn | reference + katalog | ✅ |
| R7.1 | Partneri | CLIENT, PATCH, `/ured/partneri` | ✅ |
| R7.2 | Tenderi API | schema, status, Money, CRUD | ✅ |
| R7.3 | Prilozi | tender_attachments MinIO | ✅ |
| R7.4 | Rokovi | entity TENDER + filter | ✅ |
| R7.5 | Convert | WON → project | ✅ |
| R7.6 | UI | `/ured/tenderi` + E2E | ✅ |
| R7.7 | Docs | STATUS + MATRIX | ✅ |

## Matrica

`.cursor/docs/matrices/tenders/MATRIX.md`

## Izvor

`Izvor: v1/backend/.../tender-status.ts`, `tenders.service.ts` (samo čitanje).
