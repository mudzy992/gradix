# AUDIT/STATE.md — živi dnevnik

> Pravilo: ovaj fajl se ažurira u **svakom** commitu.

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; radi se direktno na grani.

## Trenutna faza / segment / korak

**FAZA 2–4 ✅ završene; KAPIJA 2 prošla** („nastavi dalje“ = odobrenje; Q1–Q5 usvojeni po preporuci,
zapisani kao D-012…D-016 i mogu se mijenjati). **Izvršavanje segmenata u toku.** Vlasnik odobrio prelazak
preko KAPIJE 1 („Nastavi dalje“), pa se radi do **KAPIJE 2** bez zaustavljanja.

## Zadnji commit i CI

| | |
|---|---|
| Zadnji commit | `67ae110` (CI-04 — coverage ratchet) |
| CI | ✅ [run 41510206349](https://github.com/mudzy992/gradix/actions/runs/41510206349) — **6/6** zelen za `67ae110` |
| Zadnji potvrđeno zelen run | [41509656077](https://github.com/mudzy992/gradix/actions/runs/41509656077) (`867814a`, CI-03) ✅ 6/6 · [41510206349](https://github.com/mudzy992/gradix/actions/runs/41510206349) (`67ae110`, CI-04) ✅ 6/6 |
| Sljedeća kapija | nema — izvršavanje segmenata po planu (§3), izvještaj nakon svakog |

## Hronologija (šta je urađeno)

### 2026-11-02 — priprema infrastrukture (prije audita)
- `c6dbcad` Dockerfile `--include=dev` · `be3bbc7` MinIO image · `a1ca82f` bez host portova + mreže
- `645f669` seed u produkcijskoj slici · `5679a4b` CA mount-ovi + MinIO na hostu

### 2026-11-02 — FAZA 0 (`A-00`, `e531ca2`)
- Pročitana sva dokumentacija; mapiran repo; izmjeren obim.
- `AUDIT/00_PROJECT_UNDERSTANDING.md` + pitanja P1–P10.

### 2026-11-02 — FAZA 1.1 (`A-01`)
- `AUDIT/01_DOCS_VS_REALITY.md`: 32 provjerene tvrdnje (15 ✅ / 8 ⚠️ / 3 ❌ / 6 ❓) po
  oblastima: infrastruktura, backend, frontend, mobile, CI; svaka sa `fajl:linija` dokazom.
- Najteži nalazi: **MySQL vs PostgreSQL** (❌, riješeno odlukom D-001), email je stub (❌),
  `pull_request` trigger (❌ prema novim pravilima), nema env validacije/a11y/coverage praga.

### 2026-11-02 — FAZA 1.2 (`A-02`)
- **Penzionisano 85 dokumenata** u `docs/_retired/` (originalne putanje zadržane), svaki sa
  banerom „⚠️ PENZIONISANO“; `docs/_retired/INDEX.md` sa opisom svakog fajla.
- Uklonjeno (odluka D-010): `backup/migrations/**` (9 MySQL fajlova; vraćanje iz `5679a4b`).
- `.cursorrules` i novi `.cursor/rules/00_project.mdc` postali pokazivači na `docs/` (D-011).
- Reference na penzionisane dokumente u `docker-compose*.yml`, Dockerfile-ovima, entrypointu i
  `tsconfig.build.json` preusmjerene na `docs/INFRASTRUCTURE.md`.

### 2026-11-02 — FAZA 1.3 (`A-03`)
- Nova dokumentacija (jedini izvor istine): `docs/README.md` (indeks) + `ARCHITECTURE.md`,
  `INFRASTRUCTURE.md`, `BACKEND.md`, `FRONTEND.md`, `MOBILE.md`, `TESTING.md`, `CI.md`,
  `CONVENTIONS.md`, `DECISIONS.md` (D-001…D-011 odobrene + D-020…D-027 implementirane).
- U `DECISIONS.md` zapisani svi odgovori vlasnika na P1–P10 (PostgreSQL konačan, penzionisanje
  dokumenata, mobile bez objave, Maestro, test piramida, zavisnosti uz zapis, bez staginga,
  nova paleta + WCAG 2.2 AA, produkcijski seed = 1 platform admin, brisanje MySQL backup-a).
- Provjereni relativni linkovi u `docs/*.md` i `AUDIT/*.md` (13 fajlova, 0 pokvarenih).

### 2026-11-02 — FAZA 2 (`A-04`, master plan)
- `AUDIT/02_MASTER_AUDIT_PLAN.md`: mjerljivi kriteriji završetka po sloju, pravila izvršavanja
  (jedan segment = kod + testovi + docs + dokaz + zelen CI), redoslijed, 59 segmenata sa
  ulazom/rizikom/DoD, izbor alata sa alternativama i obrazloženjem, zavisnosti, rizici, Q1–Q5.
- `scripts/audit/segments.json`: mašinski čitljiv registar 59 segmenata (STD 2, CI 7, INF 7,
  BE 18, FE 16, MOB 7, TEST 2), svi na `planned`.
- Nijedan alat nije dodan u ovom koraku (plan predviđa: Prettier svuda, oxlint za frontend,
  Jest `coverageThreshold`, Playwright + axe-core, Maestro, `gitleaks`, pino, zod).

### 2026-11-02 — FAZA 3 (`A-05`, inventar + matrica pokrivenosti)
- `scripts/audit/lib.mjs`, `inventory.mjs`, `check-coverage.mjs` (bez novih zavisnosti: node
  builtin + ručni CSV parser), `AUDIT/COVERAGE_MATRIX.csv` (jedan red po izvornom fajlu).
- CI job `audit` pokreće `check-coverage`; crveno ako fajl nije u matrici, ako je označen
  `pregledano` bez zapisa ili ako segment iz `segments.json` nema red u matrici.

### 2026-11-02 — FAZA 4 (`A-06`, skeletoni segmenata)
- `scripts/audit/scaffold-segments.mjs` generiše `AUDIT/segments/<ID>.md` (10 sekcija) iz
  `segments.json` + matrice; postojeće ne prepisuje (`--force`, `--check`).
- **59/59 segmenata** ima skeleton; svaki u sekciji 2 već ima tačan spisak svojih fajlova iz
  matrice (procesni segmenti imaju `scopeReason` umjesto liste).
- `AUDIT/02_MASTER_AUDIT_PLAN.md` §9.1: tabela 10 sekcija; §5: inventar + gate dodati u tabelu alata.

### 2026-11-02 — CI-01 (`A-07`, okidači)
- `pull_request` trigger **uklonjen**; `push` samo `main` + `arena/0bc0e56e-gradix`; glob `arena/**`
  zamijenjen tačnim imenom grane (F-CI-01-01/02). `workflow_dispatch` ostaje.
- Gate je uhvatio drift matrice (`loc` za `ci.yml`) → `check-coverage` sada provjerava i `loc`, pa
  se takav drift vidi lokalno, ne samo u CI-ju.

### 2026-11-02 — STD-01 + STD-02 (`A-08`, guardrail)
- Korijenski `package.json` (**bez zavisnosti**) sa `check:all`, `check:docs`, `check:secrets`,
  `check:logs`, `check:compose`, `check:coverage-matrix`, `audit:inventory`, `audit:segments`.
- `scripts/standards/`: orkestrator (11 koraka, `--only`, `--ci`, `--list`), docs guard (255
  provjera), secret skener (6 pravila), `console.log` guard, compose guard (13 invarijanti) +
  `allowlist.json` sa 3 izuzetka (svaki sa razlogom).
- `backend/package.json` + `lint:check`/`typecheck`; `frontend/package.json` + `lint:check`/`typecheck`.
- CI job `audit` sada pušta `npm run check:all -- --only=coverage,segments,docs,secrets,logs,compose`.
- Negativni testovi izvedeni (pokvaren link → exit 1, uklonjen CA mount → exit 1).
- Odgovori na Q1–Q5 zapisani kao **D-012…D-016** (paleta B, email bez lažnog uspjeha, Redis
  ostaje, bundle 250 kB, coverage floor 40 %).

### 2026-11-02 — CI-03 (`A-09`, pinning/timeouti/cache)
- Sve GitHub akcije pinovane na commit SHA (`actions/checkout`, `setup-node`, `upload-artifact`,
  `docker/setup-buildx-action`, `docker/build-push-action`) uz komentar taga.
- `timeout-minutes` na svih 6 jobova (5/15/20/15/20/30) — dug C7 zatvoren.
- Cache potvrđen (npm po paketu, Docker `type=gha`); job `audit` svjesno bez cache-a.

### 2026-11-02 — CI-04 (`A-10`, coverage ratchet)
- CI sada mjeri pokrivenost (`npm run test:cov`) i pušta **ratchet**:
  `scripts/standards/check-coverage-ratchet.mjs` vs `backend/coverage-baseline.json`.
  Baseline je **izmjereno** stanje (linije 0,18 %), ne želja; 40 % ostaje cilj faze (D-016).
- Artefakt `backend-coverage` (lcov + summary, 7 dana) + tabela pokrivenosti u `GITHUB_STEP_SUMMARY`.
- Negativan test izveden: baseline 5 % → exit 1.
- `check:all` ima 12 koraka; `backend/coverage-baseline.json` ušao u matricu (TEST-01).

### 2026-11-02 — INF-01 (`A-11`, compose/mreže/env)
- Novi guard `scripts/standards/check-env.mjs` (67 provjera): svaka varijabla iz compose/entrypoint/
  Dockerfile/backend/frontend/mobile postoji u `.env.example`; `.env.example` ↔ `.env.coolify` parity;
  mrtve varijable = upozorenje; **zabrana referenci na penzionisane dokumente iz konfiguracije**.
- Popravljeno: `.env.example`/`.env.coolify` dobili `PORT`, `MINIO_PORT`, `REDIS_TLS_CA_FILE`;
  4 reference na penzionisan `DEPLOYMENT_COOLIFY.md` → `docs/INFRASTRUCTURE.md`.
- Dokumentovano (bez promjene ponašanja): `JWT_REFRESH_SECRET` je obavezan u compose-u, ali ga kod
  **ne čita** (refresh tok = BE-02); `REDIS_*` se prenose, kod ih ne čita (INF-07, D-014).
- Negativan test: uklonjen `MINIO_PORT` → exit 1.

## Šta je sljedeće (tačan sljedeći korak)

1. Push + provjera CI (mora biti zelen) — run se upisuje u ovu tabelu.
2. Sljedeći segment po planu §3: **INF-02** (backend image + entrypoint), pa **INF-03** (frontend image + nginx), pa **BE-01**.
3. Nakon svakog segmenta: kratak izvještaj u chatu; bez PR-ova.

## Otvorena pitanja / blokatori

Nema blokatora za FAZU 3/4. **Za izvršavanje segmenata treba odgovoriti Q1–Q5**
(`AUDIT/02_MASTER_AUDIT_PLAN.md` §8):
- **Q1** — paleta: dva predloga (A: „Gradix Green“; B: „Slate/Teal“) za FE-01.
- **Q2** — SMTP: uključiti pravu dostavu ili ukloniti lažni „success“ (BE-16).
- **Q3** — Redis: zadržati (rate-limit/cache) ili ukloniti (INF-07).
- **Q4** — budžet bundle-a: 250 kB gzip kao granica (FE-06).
- **Q5** — pod pokrivenosti testova: 40 % kao početni prag (TEST-01/CI-04).
