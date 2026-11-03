# CI.md — GitHub Actions (Gradix)

> **Izvor istine za CI.** **Aktivna grana: `arena/0bc0e56e-gradix`.**
> Kad se aktivna grana promijeni, **u istom commitu** se mijenjaju workflow filter i ovaj
> dokument (pravilo iz procesa rada).

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) · **Nema PR-ova; radi se na grani.**

---

## 1. Trenutno stanje

### Okidači (nakon CI-01)

```yaml
on:
  push:
    branches: [main, 'arena/0bc0e56e-gradix']   # samo main + aktivna grana
  workflow_dispatch:                            # ručno, sa izborom suite-a (CI-02)
```

Nema `pull_request` trigera i nema šablona `arena/**`: grana koja nije aktivna ne troši CI minute.
Ako se aktivna grana promijeni, filter i ovaj dokument se mijenjaju u **istom** commitu.

### Noćni backup/restore drill (INF-06)

Workflow [`.github/workflows/backup-restore.yml`](../.github/workflows/backup-restore.yml) je
**odvojen** od `ci.yml`:

```yaml
on:
  schedule: [{ cron: '30 3 * * *' }]     # noćno, 03:30 UTC
  workflow_dispatch:                     # ručno
  push:                                  # samo kad se mijenjaju ops skripte/workflow
    branches: ['arena/0bc0e56e-gradix']
    paths: ['scripts/ops/**', '.github/workflows/backup-restore.yml']
```

Job `drill` (limit 20 min): Postgres 16 servis → `migrate deploy` + seed → `scripts/ops/backup.sh`
→ restore u `gradix_restore` (`scripts/ops/restore.sh`) → poređenje broja redova
(`users, companies, projects, tasks, timer_sessions, audit_logs, cost_entries, diary_entries`) i
broja primijenjenih migracija → dump kao artefakt 7 dana. Runbook:
[`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) §7.

### Jobovi

| Job | Šta radi | Trajanje* |
|---|---|---|
| `audit` | `npm run check:all -- --only=coverage,segments,docs,secrets,logs,schema,image,env,compose` (matrica pokrivenosti, 59 skeletona, docs linkovi/baneri/indeksi, tajne, `console.log`, compose invarijante) → `inventory` + `git diff --exit-code` (matrica mora biti regenerabilna) | ~15 s |
| `backend` (Backend lint + unit + build) | `npm ci` → `prisma generate` → `eslint` → `npm run test:cov` → **coverage ratchet** → `nest build` → artefakt `backend-coverage` (lcov + json-summary, 7 dana) → provjera `dist/src/main.js` i `dist/prisma/seed.js` | ~55 s |
| `backend-e2e` | Postgres 16 servis → `migrate deploy` → seed → **16** e2e spec-a (+ JSON report parser koji ispiše `::error` po palom testu) | ~1 m 19 s |
| `frontend` | `npm ci` → `oxlint` → `tsc -b` → `vite build` | ~28 s |
| `web-e2e` | živi backend (`dist/src/main.js`) + seed iz builda + `vite preview` → Playwright (chromium) | ~1 m 37 s |
| `docker` (Coolify gate) | root/app Dockerfile identičnost → `docker compose config` + guardovi → build obje slike → **seed iz produkcijske slike** → **SSL preflight** → MinIO iz compose-a (`healthy`) → „Coolify emulacija“ (`NODE_ENV=production`, `vite` u builderu) → smoke test backend kontejnera → smoke test frontend kontejnera | ~1 m 42 s |

\* iz runa [41495269647](https://github.com/mudzy992/gradix/actions/runs/41495269647) — jobovi
rade paralelno, ukupno ~2,5 min.

### Pinning, timeouti, cache (CI-03)

- **Sve akcije su pinovane na commit SHA** (`@<sha> # vN`), ne na pokretni tag: tag se može
  premjestiti, SHA ne može. Nadogradnja = svjesna izmjena SHA (planirano: renovate).
- **`timeout-minutes` na svakom jobu**: `audit` 5, `backend` 15, `backend-e2e` 20, `frontend` 15,
  `web-e2e` 20, `docker` 30. Bez ovoga zaglavljen job drži 6 h i blokira granu.
- **Cache**: npm preko `actions/setup-node` (`cache: npm` + `cache-dependency-path` po paketu);
  Docker slojevi preko `type=gha` (`scope=backend` / `scope=frontend`).
- Job `audit` ne instalira ništa (nema `npm ci`), pa mu cache nije potreban.

### Guardovi koji već postoje (ne smiju se ukloniti)

| Guard | Zašto |
|---|---|
| „Objavljenih host portova: 0“ | fiksni `ports:` ruše Coolify blue/green deploy |
| „Matrica se ne mijenja regeneracijom“ | matrica pokrivenosti se ne održava ručno; drift znači da je fajl dodat bez inventarisanja |
| `check-coverage` exit 1 | fajl van matrice, nepoznat segment, ili „pregledano“ bez zapisa — audit se ne može tiho zaobići |
| `check:docs` exit 1 | pokvaren link ili dokument van indeksa = dokumentacija laže |
| `check:secrets` exit 1 | tajna u gitu je tajna zauvijek |
| `check:schema` exit 1 | nov FK bez indeksa = polako brisanje/join na produkciji |
| `check:image` exit 1 | root u kontejneru, healthcheck koji ne gađa `/api/health`, entrypoint bez `exec`, nginx blok koji poništava sigurnosne headere, neusklađene korijenske kopije Dockerfile-ova |
| `check:env` exit 1 | nedokumentovana env varijabla = pad u produkciji; razilaženje `.env.example`/`.env.coolify` = deploy koji „radi kod mene“ |
| `check:compose` exit 1 | host portovi, mrtva MinIO slika ili CA mount koji nedostaje ruše deploy |
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
| Bez `pull_request` okidača | ✅ uklonjen (CI-01), filter samo `main` + aktivna grana | CI-01 |
| Ručni run sa izborom suite-a | `workflow_dispatch` inputi + `if:` na jobovima | CI-02 |
| Akcije pinovane po SHA | `actions/checkout@<sha> # v4.x` (Dependabot za bump) | CI-03 |
| Static gate | lint, format check, `tsc`, secret scan (`gitleaks`), `npm audit --omit=dev`, license check | CI-04 |
| Coverage prag | `jest --coverage` + `coverageThreshold`; pad ispod praga = crven | CI-04 |
| Audit gate | `scripts/audit/check-coverage.*` (matrica fajlova) + provjera da `docs/` nije u raskoraku | CI-05 |
| Web E2E | Playwright: trace/video na failure, `axe` za ključne ekrane | CI-06 |
| Mobile | Jest + **Maestro** na Android emulatoru (`reactivecircus/android-emulator-runner`), **posljednji** job (`needs: [...]`) | CI-07 |
| Artefakti | JUnit XML, coverage `lcov`, Playwright report, Maestro screenshot/video | CI-06/07 |
| Sažetak | `GITHUB_STEP_SUMMARY`: tabela pokrivenosti iz ratchet skripte (job `backend`) | ✅ CI-04 |
| Performanse | ✅ `timeout-minutes` po jobu, cache `npm`/Docker; mjerenje trajanja | CI-03 |

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
| C1 | ~~`pull_request` trigger~~ — ✅ riješeno (CI-01) | CI-01 |
| C2 | Nema `workflow_dispatch` inputa | CI-02 |
| C3 | Akcije su na tagovima (`@v4`), ne na SHA | CI-03 |
| C4 | Nema secret skena, `npm audit` ni license checka | CI-04 |
| C5 | Nema coverage praga ni audit gate-a | CI-04/CI-05 |
| C6 | Nema mobile joba | CI-07 |
| C7 | ~~Nema `timeout-minutes`~~ — ✅ dodati na sve jobove (CI-03) | CI-03 |
| C8 | ~~Nema automatskog backup/restore testa~~ — ✅ riješeno u INF-06 (noćni drill + skripte) | INF-06 |
