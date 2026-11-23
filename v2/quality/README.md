# Quality registry

`registry/*.json` is the requirements-to-test map. `check-matrix-parity.mjs` checks it.

Statuses: `COVERED`, `CI-SKIP`, `BLOCKED`, `NOT_IMPLEMENTED`.

`gate: required` and `NOT_IMPLEMENTED` fail the process. `gate: track` is reported and does not fail. A false `COVERED` always fails: the test title must exist, a skipped test does not count, and the assertion shape must match (`unit`, `integration`, `persistence`, `ui-entity`, `grant-matrix`). `status < 400` is rejected. One test cannot be the only evidence for two unrelated `group` values.

Tender edges come from `.cursor/docs/matrices/tenders/MATRIX.md`. An edge in that table with no registry row fails. An obsolete `matrixEdge` fails.

`CI-SKIP` needs `owner` and `review`. Browser upload and the positive `pending → ready` path stay skipped until MinIO is a CI service. The unconfigured-storage path is covered: no row is inserted.

D1 (fuel amount stays null for field roles, and synthetic `0.00` is rejected) is `CI-SKIP`. Phase E implements it. Do not record `0.00` as the expected amount.

`registry/application/` is the second denominator. It is not loaded by the tender checker.

```bash
pnpm check-matrix-parity
pnpm check-application-coverage
```

Implemented application rate = `COVERED / (outcomes that are not PLANNED_NOT_IMPLEMENTED, minus CI-SKIP and BLOCKED)`. A missing `implementation` means `IMPLEMENTED`. `UNCLEAR` stays in that denominator. Planned rows are a separate roadmap count. Skips stay in the report and are not successes. `quality/report.json` and `quality/application-report.json` are gitignored.
