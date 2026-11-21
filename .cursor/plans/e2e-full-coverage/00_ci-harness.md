# CI harness — E2E A3/B2

Kapija: [`.github/workflows/ci-v2.yml`](../../../.github/workflows/ci-v2.yml) job `verify`.

## Tok

1. Service `postgres:16-alpine` (ephemeral; nestaje na kraju joba).
2. Migracije + grants + preflight.
3. Unit/integracijski testovi.
4. Seed: `seed` + `seed-demo-podaci` + `demo-sukobi` + `demo-pregled` + `demo-r4b-approval`.
5. `pnpm --filter @gradix/web build` → `start` na `127.0.0.1:3000`.
6. Playwright shardovi:
   - `@smoke` (desktop + mobile)
   - `@deep-auth` → `@deep-evidencija` → `@deep-mehanizacija` → `@deep-rad` → `@deep-admin`
   - `@snimci` samo `desktop`
7. Artefakti: snimci (always), playwright-test-results (on failure).

## Env (workflow)

| Var | Vrijednost |
|---|---|
| `DATABASE_URL` / `DATABASE_ADMIN_URL` | CI postgres |
| `AUTH_SECRET` | placeholder ≥32 |
| `E2E_PASSWORD` / `SEED_PASSWORD` | `E2eDemoLozinka-123` |
| `PLATFORM_ADMIN_EMAILS` | `vlasnik@demo.test` |
| `E2E_GREP` | po shardu |

## MinIO odluka (Faza 2b)

**CI-SKIP** — nema MinIO service u `ci-v2`. Attachment deep ishodi označeni u `e2e-coverage/MATRIX.md`. Bez „možda“.

## Maestro

Zaseban workflow — **ne dirati** (B2).

## Self-owned

Deep setup kreira `ptr_e2e_*`, `tnd_e2e_*`, `prj_e2e_*`, … preko API (`e2e/helpers/api.ts`). Seed ostaje za login/role/šifarnike.
