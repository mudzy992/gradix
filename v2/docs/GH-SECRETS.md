# GitHub secrets i varijable — šta treba unijeti

**Samo imena i opisi.** Vrijednosti nikad ne idu u repo ni u ovaj dokument.

## 1. Za CI (GitHub Actions) — potrebno sada

CI u ovom trenutku **ne traži nijednu tajnu**: bazu diže kao servis (`postgres:16-alpine`), `AUTH_SECRET` je placeholder u workflowu, a testovi koriste lokalnu bazu. To je namjerno — CI ne smije zavisiti od produkcije.

| Ime | Tip | Za šta | Potrebno |
|---|---|---|---|
| `COOLIFY_DEPLOY_HOOK` | secret | automatski deploy v2 na staging poslije zelenog CI-ja | kad staging postoji |
| `COOLIFY_API_TOKEN` | secret | alternativa deploy hooku (Coolify API) | opciono |

## 2. Za staging i produkciju (Coolify) — potrebno prije G1 deploya

Unosi se u Coolify, ne u GitHub. Ako želiš da ih imam i u GH secrets (npr. za budući deploy workflow), kopija je ista lista.

| Ime | Za šta | Napomena |
|---|---|---|
| `DATABASE_URL` | aplikacijska konekcija | **rola `gradix_app`** (`NOSUPERUSER NOBYPASSRLS`), ne vlasnik šeme — inače RLS ne štiti (ADR 0003) |
| `DATABASE_ADMIN_URL` | konekcija za migracije | vlasnik šeme; koristi se samo kad je `RUN_MIGRATIONS=true`. Može biti isti server, druga rola |
| `AUTH_SECRET` | potpis sesijskih tokena | min. 32 znaka; rotacija odjavljuje sve korisnike |
| `POSTGRES_CA_FILE` | CA za PostgreSQL u kontejneru | v1: `/data/coolify/ssl/coolify-ca.crt` |
| `PGSSLMODE` / `PGSSLROOTCERT` | TLS prema bazi | v1: `verify-ca` + putanja CA |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_USE_SSL` | S3 | v1: `minio`, `9000`, `false` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | S3 kredencijali | rotirati prije v2 deploya |
| `MINIO_BUCKET` | bucket | **`gradix-v2`** (ADR 0006) |
| `MINIO_DATA_DIR` | host putanja za MinIO /data | v1: `/mnt/shared-app-files/gradix/minio` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_USER` / `REDIS_PASSWORD` / `REDIS_PREFIX` / `REDIS_TLS_CA_FILE` | Redis | **nije potrebno u R0**; `gx2:` prefiks i korisnik `gradix_v2` kad se uvede (ADR 0006) |
| `CORS_ORIGIN` | dozvoljeni origin | prazno = same-origin; uz jedan domen ostaje prazno (G0/P4) |
| `TRUST_PROXY` | broj proxy hopova | Coolify = `1` |
| `RUN_MIGRATIONS` | migracije u entrypointu | staging `true`; za produkciju odlučiti (preporuka: `false` + zaseban korak) |
| `LOG_LEVEL` | nivo logova | `info` |
| `SEED_PASSWORD` | samo za seed | **ne** postavljati u produkciji; seed se tamo ne pokreće |

## 3. Šta namjerno NIJE potrebno

- `JWT_REFRESH_SECRET`, `REFRESH_REPLAY_SECRET` — v2 nema replay zaštitu (ADR 0005).
- `JWT_ACCESS_SECRET` — zamijenjen sa `AUTH_SECRET`.
- `VITE_API_URL`, `CSP_API_ORIGIN` — uz jedan domen nema cross-origin poziva.
- `SEED_DEMO` — demo podaci se ne sade u produkciju; seed skripta je odvojena.

## 4. Redoslijed uvođenja

1. Kreirati bazu (čistu) i **dvije role**: vlasnik šeme i `gradix_app`.
2. Unijeti `DATABASE_ADMIN_URL` i `DATABASE_URL` u Coolify, pa pokrenuti `infra/scripts/db-apply.sh` (ili `RUN_MIGRATIONS=true` pri prvom startu).
3. Kreirati bucket `gradix-v2` (tek prije R5).
4. Postaviti `AUTH_SECRET` (32+ znaka) — bez njega aplikacija ne starta, i to je namjerno.
5. Provjeriti `/api/ready` = 200 i `/api/health` = 200.
6. Seed u produkciji: **ne**. Prvi korisnik se pravi skriptom jednokratno, po proceduri koja se dogovara u R1.
