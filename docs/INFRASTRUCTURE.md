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
| Observability | **JSON logovi** (jedan red = jedan zapis, `level`/`context`/`requestId`) + Docker healthcheckovi (`/api/health` liveness, `/api/health/ready` readiness) | ⚠️ bez metrika/tracinga (INF-05) |
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
| `backend` | `build: ./backend` | `expose 3000` | CA za bazu i Redis (`ro`), `create_host_path: false` | `GET /api/health` = **liveness** (30 s, start 60 s, 5 retry); `GET /api/health/ready` = readiness (baza, `503`) za external monitoring |
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
| `MINIO_ENDPOINT` | `minio` | `MinioService` (`getOrThrow`) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | `minioadmin` (promijeniti!) | `MinioService` |
| `MINIO_BUCKET` | `gradix` | `MinioService` |

> `JWT_REFRESH_SECRET` **ne postoji**: refresh token je neprozirni slučajni string, u bazi se čuva
> samo njegov SHA-256 hash (D-029). Uklonjen je iz compose-a, `.env.example`, `.env.coolify` i CI-ja.

### 5.2 Važno za ponašanje

| Varijabla | Default | Efekat |
|---|---|---|
| `NODE_ENV` | `production` | logovanje / ponašanje biblioteka |
| `LOG_LEVEL` | `info` | nivo JSON logova (`error`/`warn`/`info`/`debug`); prazno = `info` u produkciji, `debug` u razvoju, `error` u testovima (INF-04) |
| `PORT` | `3000` | port API-ja |
| `CORS_ORIGIN` | prazno = svi origin-i | whitelist, zarezom razdvojeno |
| `RUN_MIGRATIONS` | `true` | `false` = migracije kao poseban korak |
| `SSL_PREFLIGHT` | `true` | `false` = preskoči provjeru CA |
| `MINIO_PORT` | `9000` | S3 port |
| `MINIO_USE_SSL` | `false` | TLS prema MinIO |
| `MINIO_SKIP` | — | **samo testovi**: preskače `ensureBucket` |
| `SEED_PASSWORD` | — | lozinka seed korisnika (min 10), koristi se samo pri seedu |
| `SEED_DEMO` | `false` | `true` = seed puni demo firmu i demo podatke; `false` = samo platform administrator (P9) |
| `BACKEND_URL` | `http://backend:3000` | nginx proxy target (frontend kontejner) |
| `VITE_API_URL` | prazno | **build-time**: prazno ⇒ relativni `/api` kroz nginx |
| `ENABLE_API_DOCS` | `false` | `true` izlaže Swagger na `/api/docs` — u produkciji isključeno |

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

- **Migracije**: automatski pri startu (`prisma migrate deploy`). Sedam migracija:
  `20261102130000_init_postgres` (inicijalna šema), `20261103120000_be08_indexes_audit`
  (51 indeks na stranim ključevima, 19 novih `AuditAction` vrijednosti, 2 parcijalna unique
  indeksa za otvorene timere), `20261103140000_be09_machine_open_assignment` (parcijalni unique
  indeks: mašina na najviše jednom projektu), `20261103160000_be10_fleet_audit_actions`
  (17 novih `AuditAction` vrijednosti za flotu, GPS uređaje, ture, gorivo i šifarnike),
  `20261103180000_be13_diary_hse_audit_actions` (6 akcija za dnevnik i HSE) i
  `20261103190000_be14_payroll_snapshot_erp_audit` (`TimerSession.hourlyRateSnapshot` + 4 akcije:
  `COST_ENTRY_REMOVED`, `PARTNER_CREATED/UPDATED`, `WAREHOUSE_CREATED`) i
  `20261103210000_be15_office_audit_actions` (12 akcija za tendere, servis i dokumente).
  Stariji MySQL set je uklonjen (odluka D-010).
- **Parcijalni unique indeksi** (`TimerSession_open_user_key`, `TimerSession_open_machine_key`,
  `MachineAssignment_open_machine_key`)
  postoje **samo u SQL-u migracije** — Prisma šema ih ne može izraziti. Ako se jednog dana radi
  `prisma migrate dev`, Prisma će ih vidjeti kao „višak“; ne brisati ih.
- **Seed**: dio slike (`dist/prisma/seed.js`). Pokreće se **ručno**:
  - Coolify terminal nad `backend` kontejnerom: `node dist/prisma/seed.js`, ili
  - `docker compose run --rm backend node dist/prisma/seed.js`.
- Seed pravilo (D-009): **produkcijski seed = 1 platform admin**; demo skup je za razvoj.
- `SEED_PASSWORD` mora imati **≥ 10 znakova**; seed resetuje `Setting` redove kompanije `demo`.
- `SEED_DEMO=true` je obavezan za demo podatke (razvoj, e2e). Bez njega seed upisuje samo
  `platform@gradix.local` sa rolom `PLATFORM_ADMIN` — to je i propisani produkcijski seed (P9).

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

## 10. Frontend nginx (cache, proxy, headeri)

Template: `frontend/nginx/default.conf.template` (envsubst nad `${BACKEND_URL}` pri startu).

| Tema | Pravilo |
|---|---|
| API | `location /api/` → `proxy_pass ${BACKEND_URL}/api/`, `client_max_body_size 20m`, read timeout 120 s |
| WebSocket | `location /socket.io/` sa `Upgrade`/`Connection`, read timeout 3600 s |
| SPA | `try_files $uri $uri/ /index.html` |
| Keš | `/assets/` = `immutable` 1 g; `index.html` = `no-store` |
| Sigurnost | `server_tokens off`, nosniff, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, **CSP** (vidi dolje) |

**Zamka koju guard hvata:** `add_header` u dubljem `location` bloku **poništava** sve naslijeđene
`add_header` iz `server` bloka. Zato `location /assets/` i `location = /index.html` ponavljaju
sigurnosne headere — `check:image` pada ako neki blok sa svojim `add_header` ne ponovi
`X-Content-Type-Options`.

**CSP** (jednozemljisna aplikacija — API i Socket.IO idu kroz isti nginx):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:;
object-src 'none'; base-uri 'self'; frame-ancestors 'self'
```

`'unsafe-inline'` je samo za stilove (React/Tailwind inline `style`); skripte su strogo `'self'`.
Regresiju hvataju Web E2E (Playwright) i smoke test frontend kontejnera u CI-ju.

---

## 9. Poznati dugovi (ulaze u segmente)

| # | Dug | Segment |
|---|---|---|
| I1 | ~~Nema strukturisanog logovanja ni korelacionog ID-a~~ **riješeno** u INF-04 (JSON logger + `x-request-id`) | INF-04 |
| I2 | Nema metrika/readiness endpointa (samo `SELECT 1`) | INF-05 |
| I3 | Nema automatskog backup/restore testa | INF-06 |
| I4 | Nema SBOM/skeniranja slika ni pinovanja po digestu | CI-04 |
| I5 | Kontejneri rade kao `root` (backend/frontend) | INF-03 |
| I6 | Nema resource limita (`cpus`, `mem_limit`) u compose-u | INF-03 |
| I7 | `REDIS_*` mrtva konfiguracija | INF-07 |
| I8 | Nema staging okruženja (svjesna odluka D-007) | — |
