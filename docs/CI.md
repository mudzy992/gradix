# CI.md — GitHub Actions (Gradix)

> **Izvor istine za CI.** **Aktivna grana: `arena/0bc0e56e-gradix`.**
> Kad se aktivna grana promijeni, **u istom commitu** se mijenjaju workflow filter i ovaj
> dokument (pravilo iz procesa rada).

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) · **Nema PR-ova; radi se na grani.**

---

## 1. Trenutno stanje (`e531ca2`)

### Okidači (danas)

```yaml
on:
  push:
    branches: [main, 'arena/**']
  pull_request:            # ⚠️ uklanja se (segment CI-01)
  workflow_dispatch:
```

### Jobovi

| Job | Šta radi | Trajanje* |
|---|---|---|
| `backend` (Backend lint + unit + build) | `npm ci` → `prisma generate` → `eslint` → `npm test` → `nest build` → provjera `dist/src/main.js` i `dist/prisma/seed.js` | ~48 s |
| `backend-e2e` | Postgres 16 servis → `migrate deploy` → seed → **16** e2e spec-a (+ JSON report parser koji ispiše `::error` po palom testu) | ~1 m 19 s |
| `frontend` | `npm ci` → `oxlint` → `tsc -b` → `vite build` | ~28 s |
| `web-e2e` | živi backend (`dist/src/main.js`) + seed iz builda + `vite preview` → Playwright (chromium) | ~1 m 37 s |
| `docker` (Coolify gate) | root/app Dockerfile identičnost → `docker compose config` + guardovi → build obje slike → **seed iz produkcijske slike** → **SSL preflight** → MinIO iz compose-a (`healthy`) → „Coolify emulacija“ (`NODE_ENV=production`, `vite` u builderu) → smoke test backend kontejnera → smoke test frontend kontejnera | ~1 m 42 s |

\* iz runa [41495269647](https://github.com/mudzy992/gradix/actions/runs/41495269647) — jobovi
rade paralelno, ukupno ~2,5 min.

### Guardovi koji već postoje (ne smiju se ukloniti)

| Guard | Zašto |
|---|---|
| „Objavljenih host portova: 0“ | fiksni `ports:` ruše Coolify blue/green deploy |
| Eksterne mreže deklarisane (`db_net`, `redis_net`) | backend bez njih ne vidi bazu/Redis |
| CA mount-ovi u backendu | bez njih `ENOENT … coolify-ca.crt` u runtime-u |
| MinIO `/data` je **bind** na host | podaci ne smiju živjeti u anonimnom volume-u |
| MinIO se diže iz compose-a i mora postati `healthy` | hvata mrtve image reference i pokvaren healthcheck |
| Seed iz produkcijske slike + broj korisnika u bazi | dokaz da seed radi bez `tsx`-a |
| SSL preflight (nepostojeći CA ⇒ kontejner staje) | hvata regresiju koja je jednom otišla u produkciju |
| Dockerfile kopije identične | root i app Dockerfile-ovi se ne smiju razići |

---

## 2. Ciljno stanje (uvodi se kroz segmente CI-01…CI-06)

```yaml
on:
  push:
    branches: [arena/0bc0e56e-gradix]   # SAMO aktivna grana
  workflow_dispatch:
    inputs:
      suite:  { options: [all, backend, frontend, mobile-e2e], default: all }
      verbose:{ type: boolean, default: false }
      tag:    { description: 'test tag/filter', required: false }
```

| Zahtjev | Kako | Segment |
|---|---|---|
| Bez `pull_request` okidača | ukloniti trigger | CI-01 |
| Ručni run sa izborom suite-a | `workflow_dispatch` inputi + `if:` na jobovima | CI-02 |
| Akcije pinovane po SHA | `actions/checkout@<sha> # v4.x` (Dependabot za bump) | CI-03 |
| Static gate | lint, format check, `tsc`, secret scan (`gitleaks`), `npm audit --omit=dev`, license check | CI-04 |
| Coverage prag | `jest --coverage` + `coverageThreshold`; pad ispod praga = crven | CI-04 |
| Audit gate | `scripts/audit/check-coverage.*` (matrica fajlova) + provjera da `docs/` nije u raskoraku | CI-05 |
| Web E2E | Playwright: trace/video na failure, `axe` za ključne ekrane | CI-06 |
| Mobile | Jest + **Maestro** na Android emulatoru (`reactivecircus/android-emulator-runner`), **posljednji** job (`needs: [...]`) | CI-07 |
| Artefakti | JUnit XML, coverage `lcov`, Playwright report, Maestro screenshot/video | CI-06/07 |
| Sažetak | `GITHUB_STEP_SUMMARY` po jobu | CI-06 |
| Performanse | `timeout-minutes` po jobu, cache `npm`/Gradle, mjerenje trajanja | CI-03 |

---

## 3. Pravila rada sa CI-jem

1. **Push samo na aktivnu granu.** Nikad PR.
2. Poslije svakog pusha: `gh run watch <id> --exit-status`; ako je crven → popravka **prije**
   novog posla.
3. Run ID i status se upisuju u [`AUDIT/STATE.md`](../AUDIT/STATE.md).
4. `concurrency.group` sa `cancel-in-progress` — novi push poništava stari run.
5. `permissions: contents: read` — minimalna prava; nikad `write-all`.
6. Tajne u CI-ju: samo „testne“ vrijednosti (npr. `GradixSeed1`); nikad produkcijske.

---

## 4. Kako dodati novi job

1. Novi job u `.github/workflows/ci.yml` sa `needs:` gdje ima smisla (paralelno gdje može).
2. `timeout-minutes` obavezno; `actions/checkout` pinovan.
3. Ako job treba bazu: `services: postgres` + healthcheck + `migrate deploy` + seed.
4. Sažetak u `GITHUB_STEP_SUMMARY` (šta je provjereno, trajanje).
5. Ažurirati ovaj dokument (tabela §1) u **istom** commitu.

---

## 5. Troubleshooting

| Simptom | Uzrok / rješenje |
|---|---|
| `pull access denied for minio/minio` | mrtva registry referenca — koristi `MINIO_IMAGE` (vidi `INFRASTRUCTURE.md` §2) |
| `address already in use` | neko je vratio `ports:` u compose — guard to hvata |
| `network db_net declared as external` | CI ih kreira u jobu; u produkciji moraju postojati na hostu |
| `Seed … nije upisao ocekivane korisnike` | `SEED_PASSWORD` < 10 znakova ili migracije nisu prošle |
| `vite: not found` u `docker` jobu | `NODE_ENV=production` u build fazi — treba `--include=dev` |
| Playwright flaky | prvo provjeri da test ne koristi `sleep`; retry samo za infrastrukturu |
| Logovi se ne mogu skinuti (`gh api …/logs`) | artefakti/annotations; koristi `gh run view --json` i `check-runs/<id>/annotations` |

---

## 6. Dugovi (segmenti)

| # | Dug | Segment |
|---|---|---|
| C1 | `pull_request` trigger još postoji | CI-01 |
| C2 | Nema `workflow_dispatch` inputa | CI-02 |
| C3 | Akcije su na tagovima (`@v4`), ne na SHA | CI-03 |
| C4 | Nema secret skena, `npm audit` ni license checka | CI-04 |
| C5 | Nema coverage praga ni audit gate-a | CI-04/CI-05 |
| C6 | Nema mobile joba | CI-07 |
| C7 | Nema `timeout-minutes` na jobovima | CI-03 |
