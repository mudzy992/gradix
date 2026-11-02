# INF-02 — Backend image + entrypoint

| | |
|---|---|
| Sloj | `INF` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-02`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Produkcijska backend slika i entrypoint moraju biti minimalno privilegovani, provjerljivi i
predvidivi pri startu. Ovaj segment uvodi **non-root** izvršavanje i guard koji to drži.

**Ne radi se ovdje:** nginx/frontend slika (INF-03), logovanje (INF-04), health endpoint ugovor
(BE-18), pinning baza-slike digestom (planirano uz renovate).

## 2. Ulaz

**Zavisnosti:** INF-01, CI-01/CI-03 (pinning + timeouti).

**Fajlovi:** `backend/Dockerfile`, `backend/docker-entrypoint.sh`, `scripts/standards/check-image.mjs`,
`docs/INFRASTRUCTURE.md` (§3–§4).

## 3. Kriteriji završetka (DoD)

- [x] Produkcijska faza ima `USER node` **prije** `ENTRYPOINT`
- [x] Svi `COPY` u produkcijskoj fazi su `--chown=node:node`; Prisma keš u `/home/node/.cache`
- [x] `HEALTHCHECK` gađa `/api/health`
- [x] `ENTRYPOINT`/`CMD` u exec formi; entrypoint ima `set -e` i završava sa `exec "$@"`
- [x] SSL preflight je **prije** `migrate deploy`
- [x] Build provjerava `dist/prisma/seed.js` (D-024)
- [x] Guard `check:image` u `check:all` i CI-ju; negativan test (stara slika) → exit 1
- [x] CI job `docker` builda sliku i pušta seed **kao `node`** — stvarna verifikacija

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja | Dokaz | Ocjena |
|---|---|---|---|
| 1 | Slika je radila kao **root** | `backend/Dockerfile` (prije): nema `USER` | ❌ |
| 2 | `HEALTHCHECK` je gađao `/api/health` | `backend/Dockerfile:82` | ✅ |
| 3 | Entrypoint: `set -e`, `exec "$@"`, preflight prije migracija | `backend/docker-entrypoint.sh:16,28,35` | ✅ |
| 4 | Prisma keš se kopirao u `/root/.cache/prisma` | `backend/Dockerfile` (prije) | ⚠️ (nepristupačno korisniku `node`) |
| 5 | Seed je u slici i build ga provjerava | `Dockerfile` + `test -f dist/prisma/seed.js` | ✅ |

## 5. Nalazi

| ID | Nalazi | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-02-01 | Kontejner radi kao root → pun pristup bind mount-ovima (MinIO `/data`, CA fajlovi) | visoko | nema `USER` prije izmjene | riješeno: `USER node` |
| F-INF-02-02 | Prisma keš u `/root/.cache` nedostupan korisniku `node` → `migrate deploy` bi tražio download pri svakom startu | srednje | `COPY /root/.cache/prisma` | riješeno: `/home/node/.cache/prisma` + `HOME=/home/node` |
| F-INF-02-03 | Nigdje nije bilo provjere da slika nije root / da healthcheck gađa pravi prefiks | srednje | nema guarda | riješeno: `check:image` (7 provjera) |
| F-INF-02-04 | Bazna slika `node:22-alpine` nije pinovana digestom | nisko | `FROM node:22-alpine` ×3 | ostaje (renovate + digest, planirano) |

## 6. Popravke

- `USER node` + `--chown=node:node` na svim `COPY` koracima produkcijske faze.
- Prisma keš preseljen u `HOME=/home/node` (i `HOME` eksplicitno postavljen u `ENV`).
- Guard `check-image.mjs` čita Dockerfile kao tekst (bez Dockera): 7 provjera, uključujući
  redoslijed „preflight prije migracija“.
- **Odbačeno:** `nginx`-stil „unprivileged“ osnovna slika za backend — node alpine već ima `node`
  korisnika; dodavanje nove slike bi bio nepotreban rizik (D-006).

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Guard pozitivno | `npm run check:all -- --only=image` | PASS (7 provjera) |
| Guard negativno (stari Dockerfile bez `USER`) | `git stash -- backend/Dockerfile` + guard | exit 1 ✅ |
| Korijenska kopija identična | `diff Dockerfile backend/Dockerfile` | identično ✅ |
| Stvarni build + seed kao `node` | CI job `docker` | vidi `AUDIT/STATE.md` |

## 8. Rizici i rollback

- **Rizik:** `prisma migrate deploy` kao `node` može tražiti writable keš/HOME. Ublaženo: `HOME` i
  keš su u vlasništvu `node`; CI job `docker` pušta **seed iz produkcijske slike** i smoke testove.
- **Rizik:** bind mount-ovi na hostu mogu biti root-only (CA fajlovi su 644 — čitanje je dozvoljeno).
- **Rollback:** ukloniti `USER node` liniju i vratiti `--chown` (jedan commit); guard se isključuje
  uklanjanjem koraka `image`.

## 9. Dokumentacija

- [x] `docs/INFRASTRUCTURE.md` §3 (Docker slike + guard) i §4 (entrypoint)
- [x] `docs/CONVENTIONS.md` §7, `docs/CI.md` (guard tabela)

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-02 |
| Commit(ovi) | `feat(infra): … [INF-02]` |
| CI run | prvi run pao (job `docker`: root `Dockerfile` nije bio identičan) → popravljeno u sljedećem commitu; vidi `AUDIT/STATE.md` |
| Status | `done` |
