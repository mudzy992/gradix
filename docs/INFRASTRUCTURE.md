# INFRASTRUCTURE.md — Gradix

> **Izvor istine za infrastrukturu.** Zamjenjuje penzionisane `DEPLOYMENT_COOLIFY.md` i
> `ENV_LIST.md` (vidi [`_retired/INDEX.md`](./_retired/INDEX.md)). Sve tvrdnje su provjerene u
> `docker-compose.yml`, Dockerfile-ovima, entrypointu i CI workflow-u na commitu `e531ca2`.

---

## 1. Pregled

| Komponenta | Kako je implementirano | Status |
|---|---|---|
| Orkestracija | **Coolify** (Docker Compose resurs) — `docker-compose.yml` u korijenu | ✅ u produkciji |
| API | `backend/Dockerfile` (multi-stage, `node:22-alpine`) | ✅ |
| Web | `frontend/Dockerfile` (Vite build → `nginx:alpine`) | ✅ |
| Baza | **eksterni PostgreSQL** u mreži `db_net` (nije u compose-u) | ✅ |
| Storage | MinIO (`ghcr.io/coollabsio/minio:latest`), podaci na hostu | ✅ |
| Cache/queue | **Redis** u mreži `redis_net` — kod ga ne koristi | ⚪ rezervisano |
| Reverse proxy | Coolify proxy (Traefik) → kontejneri po domenama | ✅ |
| Secrets | Coolify Environment Variables (ne u repou) | ✅ |
| Observability | Nest default logger + Docker healthcheckovi | ⚠️ bez strukturisanih logova i metrika |
| Backup | nije automatizovan (vidi §7) | ⚠️ dug |
| Okruženja | lokalno (dev) + produkcija (Coolify); **nema staginga** (odluka D-007) | ✅ |

---

## 2. Compose topologija

```
                     ┌─────────────── Coolify proxy (domeni) ───────────────┐
                     │                                                      │
             frontend:80 (expose)                              backend:3000 (expose)
                     │                                                      │
                     └─────────────── gradix-net (bridge) ───────────────────┘
                                        │                    │
                                    minio:9000/9001     db_net ──▶ PostgreSQL
                                                        redis_net ──▶ Redis (ne koristi se)
```

| Servis | Image / build | Portovi | Volumeni | Healthcheck |
|---|---|---|---|---|
| `backend` | `build: ./backend` | `expose 3000` | CA za bazu i Redis (`ro`), `create_host_path: false` | `GET /api/health` (30 s, start 60 s, 5 retry) |
| `frontend` | `build: ./frontend` | `expose 80` | — | `wget --spider http://127.0.0.1/` |
| `minio` | `${MINIO_IMAGE:-ghcr.io/coollabsio/minio:latest}` | `expose 9000`, `9001` | host bind `${MINIO_DATA_DIR:-/mnt/shared-app-files/gradix/minio}:/data` | `mc ready local` |

**Pravila koja se ne krše:**
1. **Nema `ports:`** — Coolify deploya blue/green (stari i novi kontejner kratko rade
   paralelno), pa fiksni host port pada sa `address already in use`. CI to provjerava.
2. `db_net` i `redis_net` su `external: true` — moraju postojati na hostu.
3. CA mount-ovi koriste `create_host_path: false` — nepostojeća putanja je **greška**, ne tihi
   direktorij.

---

## 3. Docker slike

| Slika | Faze | Ključne odluke |
|---|---|---|
| `backend` | `deps` → `builder` → `production` | `npm ci --include=dev` u build fazi (Coolify ubacuje `NODE_ENV=production`); Prisma klijent se generiše u `/app/generated`; **seed se kompajlira u `dist/prisma/seed.js`**; produkcijska faza `npm ci --omit=dev`; **`USER node`** (ne root, INF-02); `HOME=/home/node` + Prisma keš pod tim korisnikom; `HEALTHCHECK` preko `fetch('/api/health')` |
| `frontend` | `builder` → `runtime` | Vite build sa `VITE_API_URL` (build-arg, default prazno ⇒ relativni pozivi); nginx template `frontend/nginx/default.conf.template` sa `BACKEND_URL` |

`Dockerfile` i `Dockerfile.frontend` u korijenu su **identične kopije** app verzija; CI pada ako
se razlikuju.

**Guard bez Dockera (INF-02):** `npm run check:image` (`scripts/standards/check-image.mjs`) provjerava
`USER node` u produkcijskoj fazi (prije `ENTRYPOINT`), `HEALTHCHECK` na `/api/health`, exec formu
`ENTRYPOINT`/`CMD`, `set -e` + `exec "$@"` u entrypointu, redoslijed „SSL preflight prije
migracija“ i provjeru `dist/prisma/seed.js` u buildu. CI job `docker` dodatno **stvarno** builda
sliku i pušta seed iz nje — guard hvata regresiju prije nego što stigne do Coolifyja.

---

## 4. Start kontejnera (backend)

`backend/docker-entrypoint.sh`:

1. **SSL preflight** (`SSL_PREFLIGHT=true`): ako `DATABASE_URL` sadrži `sslrootcert=<putanja>`
   a fajl ne postoji u kontejneru → jasan `exit 1` (bez toga Prisma padne tek pri prvom upitu).
2. **`prisma migrate deploy`** (`RUN_MIGRATIONS=false` preskače).
3. `exec node dist/src/main.js`.

---

## 5. Env katalog

### 5.1 Obavezno (deploy pada ako nedostaje)

| Varijabla | Primjer | Gdje se troši |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@postgres:5432/gradix?schema=public&sslmode=verify-ca&sslrootcert=/etc/ssl/certs/coolify-ca.crt` | Prisma (runtime + migracije) — `:?` u compose-u |
| `JWT_ACCESS_SECRET` | 32+ znaka (`openssl rand -base64 32`) | auth, realtime — `:?` |
| `JWT_REFRESH_SECRET` | 32+ znaka | ⚠️ obavezan u compose-u (`:?`), ali ga **kod još ne čita** — refresh tok je ugovor za BE-02 |
| `MINIO_ENDPOINT` | `minio` | `MinioService` (`getOrThrow`) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | `minioadmin` (promijeniti!) | `MinioService` |
| `MINIO_BUCKET` | `gradix` | `MinioService` |

### 5.2 Važno za ponašanje

| Varijabla | Default | Efekat |
|---|---|---|
| `NODE_ENV` | `production` | logovanje / ponašanje biblioteka |
| `PORT` | `3000` | port API-ja |
| `CORS_ORIGIN` | prazno = svi origin-i | whitelist, zarezom razdvojeno |
| `RUN_MIGRATIONS` | `true` | `false` = migracije kao poseban korak |
| `SSL_PREFLIGHT` | `true` | `false` = preskoči provjeru CA |
| `MINIO_PORT` | `9000` | S3 port |
| `MINIO_USE_SSL` | `false` | TLS prema MinIO |
| `MINIO_SKIP` | — | **samo testovi**: preskače `ensureBucket` |
| `SEED_PASSWORD` | — | lozinka seed korisnika (min 10), koristi se samo pri seedu |
| `BACKEND_URL` | `http://backend:3000` | nginx proxy target (frontend kontejner) |
| `VITE_API_URL` | prazno | **build-time**: prazno ⇒ relativni `/api` kroz nginx |

### 5.3 Host putanje (bind mount-ovi)

| Varijabla | Default | Target u kontejneru |
|---|---|---|
| `POSTGRES_CA_FILE` | `/data/coolify/ssl/coolify-ca.crt` | `/etc/ssl/certs/coolify-ca.crt` |
| `REDIS_CA_FILE` | `/data/coolify/ssl/redis-core/redis-ca.crt` | `/etc/ssl/redis/redis-ca.crt` |
| `MINIO_DATA_DIR` | `/mnt/shared-app-files/gradix/minio` | `/data` (MinIO) |
| `MINIO_IMAGE` | `ghcr.io/coollabsio/minio:latest` | — (image referenca) |

### 5.4 Mrtve / rezervisane varijable

`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_PREFIX`, `REDIS_TLS_CA_FILE` — prisutne u
compose-u, **kod ih ne čita**. Uklanjanje ili aktiviranje je odluka vlasnika (D-014: Redis ostaje,
pa se Aktivacija/uklanjanje zatvara u INF-07).

### 5.5 Guard (INF-01)

`npm run check:env` (`scripts/standards/check-env.mjs`) provjerava:
1. svaka varijabla koju traže compose, entrypoint, Dockerfile-ovi, backend (`config.get`/`getOrThrow`/
   `process.env`), frontend (`import.meta.env`) i mobile (`process.env`/`EXPO_PUBLIC_*`) postoji u
   `.env.example` (izuzeci u `scripts/standards/allowlist.json`, svaki sa razlogom);
2. `.env.example` i `.env.coolify` imaju **iste ključeve**;
3. dokumentovana varijabla koju niko ne čita = upozorenje (ne pad — može biti rezervisana);
4. konfiguracija ne referencira **penzionisane** dokumente (`*.md` koji postoje samo u `_retired/`).

---

## 6. Migracije i seed

- **Migracije**: automatski pri startu (`prisma migrate deploy`). Jedna migracija
  (`init_postgres`); stariji MySQL set je uklonjen (odluka D-010, vraćanje: `git show
  5679a4b:backup/migrations/...`).
- **Seed**: dio slike (`dist/prisma/seed.js`). Pokreće se **ručno**:
  - Coolify terminal nad `backend` kontejnerom: `node dist/prisma/seed.js`, ili
  - `docker compose run --rm backend node dist/prisma/seed.js`.
- Seed pravilo (D-009): **produkcijski seed = 1 platform admin**; demo skup je za razvoj.
- `SEED_PASSWORD` mora imati **≥ 10 znakova**; seed resetuje `Setting` redove kompanije `demo`.

---

## 7. Backup / restore (dug)

| Šta | Trenutno | Preporuka (u planu) |
|---|---|---|
| PostgreSQL | prepušteno Coolify/DB servisu | dnevni `pg_dump` + test restore u CI-ju (noćni) |
| MinIO | fajlovi na hostu (`/mnt/shared-app-files/...`) | `mc mirror` na sekundarni bucket/disk |
| Konfiguracija | Coolify env | izvoz env-a u šifrovani backup van hosta |

---

## 8. Lokalno pokretanje

```bash
docker network create db_net    2>/dev/null || true
docker network create redis_net 2>/dev/null || true
cp .env.example .env             # DATABASE_URL, JWT tajne
docker compose up --build        # MinIO + backend + frontend (bez host portova)

# pregled u browseru (override samo za lokal):
docker compose -f docker-compose.yml -f docker-compose.local-ports.yml up --build
# → frontend 5173 · API 3000 · MinIO konzola 9001
```

Lokalne napomene:
- CA mount-ovi traže da host putanje postoje; postavi `POSTGRES_CA_FILE` / `REDIS_CA_FILE` na
  bilo koji postojeći PEM (uz `sslmode=disable` sadržaj se ne koristi).
- `MINIO_DATA_DIR=./.data/minio` za podatke unutar repoa (git-ignored).

Bez Dockera: `cd backend && npm ci && npx prisma migrate dev && npm run start:dev` +
`cd frontend && npm ci && npm run dev`.

---

## 9. Poznati dugovi (ulaze u segmente)

| # | Dug | Segment |
|---|---|---|
| I1 | Nema strukturisanog logovanja (`pino`) ni korelacionog ID-a | INF-04 |
| I2 | Nema metrika/readiness endpointa (samo `SELECT 1`) | INF-05 |
| I3 | Nema automatskog backup/restore testa | INF-06 |
| I4 | Nema SBOM/skeniranja slika ni pinovanja po digestu | CI-04 |
| I5 | Kontejneri rade kao `root` (backend/frontend) | INF-03 |
| I6 | Nema resource limita (`cpus`, `mem_limit`) u compose-u | INF-03 |
| I7 | `REDIS_*` mrtva konfiguracija | INF-07 |
| I8 | Nema staging okruženja (svjesna odluka D-007) | — |
