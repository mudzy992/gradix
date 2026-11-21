# HANDOFF — E2E full coverage (A3/B2)

**Datum:** 2026-11-20  
**Grana:** `v2-bootstrap`

## Završeno

CI zelen: https://github.com/mudzy992/gradix/actions/runs/44850592055 (`3f45217`)

| Faza | Ishod |
|---|---|
| 0 | Dialog fokus-once + Vitest/RTL |
| 1 | `AUDIT-B5.3.md` gap mapa |
| 2 | helpers, playwright desktop/mobile, e2e-coverage MATRIX |
| 2b | `00_ci-harness.md`, MinIO **CI-SKIP**, CI shardovi |
| 3–8 | deep shardovi + phase HANDOFF fajlovi |

## Ključni putanje

- `v2/apps/web/e2e/helpers/`
- `v2/apps/web/playwright.config.ts`
- `.cursor/docs/matrices/e2e-coverage/`
- `.cursor/docs/matrices/tenders/AUDIT-B5.3.md`
- `.cursor/plans/e2e-full-coverage/`
- `.github/workflows/ci-v2.yml` (timeout 30m, shardovi)

## Sljedeće (van ovog plana)

- MinIO service u CI ako treba deep attachment
- Puni B5.3 tender feature (predmjer/garancije)
