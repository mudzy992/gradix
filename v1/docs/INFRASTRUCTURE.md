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
| Cache/queue | **Redis** u mreži `redis_net` — throttle brojač između replika (TLS + ACL, vidi §11) | ✅ INF-07 |
| Reverse proxy | Coolify proxy (Traefik) → kontejneri po domenama | ✅ |
| Secrets | Coolify Environment Variables (ne u repou) | ✅ |
| Observability | **JSON logovi** (jedan red = jedan zapis, `level`/`context`/`requestId`) + `/api/health` (liveness) + `/api/ready` (Postgres/MinIO/migracije/Redis) | ⚠️ bez metrika/tracinga (van obima v1) |
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
                                                        redis_net ──▶ Redis (throttle, TLS+ACL)
```

| Servis | Image / build | Portovi | Volumeni | Healthcheck |
|---|---|---|---|---|
| `backend` | `build: ./backend` | `expose 3000` | CA za bazu i Redis (`ro`), `create_host_path: false` | `GET /api/health` = **liveness** (30 s, start 60 s, 5 retry); `GET /api/ready` = readiness (Postgres + MinIO + migracije + Redis, `503`; Redis je opcion — njegov pad ne obara readiness) za external monitoring/blue-green gate |
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
| `REFRESH_REPLAY_SECRET` | nezavisnih 32+ znaka (`openssl rand -base64 48`), različit od JWT | refresh replay — obavezan na svim replikama prije deploya, `:?` |
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
| `TRUST_PROXY` | `1` | broj proxy hopova (Coolify/Traefik = 1); bez toga `req.ip` je IP proxy-ja i throttle je globalan (D-042) |
| `CORS_ORIGIN` | prazno (prod: `https://gradix.ba101.top`) | whitelist, zarezom razdvojeno; bez njega u produkciji samo same-origin (D-041) |
| `RUN_MIGRATIONS` | `true` | `false` = migracije kao poseban korak |
| `SSL_PREFLIGHT` | `true` | `false` = preskoči provjeru CA |
| `MINIO_PORT` | `9000` | S3 port |
| `MINIO_USE_SSL` | `false` | TLS prema MinIO |
| `MINIO_SKIP` | — | **samo testovi**: preskače `ensureBucket` |
| `SEED_PASSWORD` | — | lozinka seed korisnika (min 10), koristi se samo pri seedu |
| `SEED_DEMO` | `false` | `true` = seed puni demo firmu i demo podatke; `false` = samo platform administrator (P9) |
| `BACKEND_URL` | `http://backend:3000` | nginx proxy target (frontend kontejner) |
| `VITE_API_URL` | prazno (prod: `https://api.gradix.ba101.top`) | **build-time**: prazno ⇒ relativni `/api` kroz nginx; ako nije prazno, mora odgovarati `CSP_API_ORIGIN` (§10.1, D-041) |
| `CSP_API_ORIGIN` | prazno (prod: `https://api.gradix.ba101.top`) | origin API-ja u nginx CSP (`connect-src` + `img-src`); prazno = strogo `'self'` |
| `ENABLE_API_DOCS` | `false` | `true` izlaže Swagger na `/api/docs` — u produkciji isključeno |
| `REDIS_*` | vidi §5.4 | throttle storage u Redisu; bez `REDIS_HOST` sve ostaje u memoriji (INF-07) |

### 5.3 Host putanje (bind mount-ovi)

| Varijabla | Default | Target u kontejneru |
|---|---|---|
| `POSTGRES_CA_FILE` | `/data/coolify/ssl/coolify-ca.crt` | `/etc/ssl/certs/coolify-ca.crt` |
| `REDIS_CA_FILE` | `/data/coolify/ssl/redis-core/redis-ca.crt` | `/etc/ssl/redis/redis-ca.crt` |
| `MINIO_DATA_DIR` | `/mnt/shared-app-files/gradix/minio` | `/data` (MinIO) |
| `MINIO_IMAGE` | `ghcr.io/coollabsio/minio:latest` | — (image referenca) |

### 5.4 Redis (INF-07) — aktivirano

| Varijabla | Default | Efekat |
|---|---|---|
| `REDIS_HOST` | prazno | prazno = **Redis se ne koristi** (throttle u memoriji, kao prije INF-07); postavi `redis-core` |
| `REDIS_PORT` | `6380` | port (**TLS port** — na `redis-core` TLS sluša na 6380, ne 6379) |
| `REDIS_USER` | `gradix` | ACL korisnik (linija za `redis-cli`: `scripts/ops/redis-acl.sh`) |
| `REDIS_PASSWORD` | — | **obavezan kad je `REDIS_HOST` zadat** (env validacija ne pušta app bez njega) |
| `REDIS_PREFIX` | `gradix:` | prefiks svih ključeva; mora odgovarati ACL obrascu `~<prefix>*` |
| `REDIS_TLS_CA_FILE` | `/etc/ssl/redis/redis-ca.crt` | CA za provjeru servera; izvor je `REDIS_CA_FILE` (§5.3) |

Detalji (ACL, fail-open, provjera): §11.

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

- **Migracije**: automatski pri startu (`prisma migrate deploy`). Deset migracija:
  `20261102130000_init_postgres` (inicijalna šema), `20261103120000_be08_indexes_audit`
  (51 indeks na stranim ključevima, 19 novih `AuditAction` vrijednosti, 2 parcijalna unique
  indeksa za otvorene timere), `20261103140000_be09_machine_open_assignment` (parcijalni unique
  indeks: mašina na najviše jednom projektu), `20261103160000_be10_fleet_audit_actions`
  (17 novih `AuditAction` vrijednosti za flotu, GPS uređaje, ture, gorivo i šifarnike),
  `20261103180000_be13_diary_hse_audit_actions` (6 akcija za dnevnik i HSE) i
  `20261103190000_be14_payroll_snapshot_erp_audit` (`TimerSession.hourlyRateSnapshot` + 4 akcije:
  `COST_ENTRY_REMOVED`, `PARTNER_CREATED/UPDATED`, `WAREHOUSE_CREATED`) i
  `20261103210000_be15_office_audit_actions` (12 akcija za tendere, servis i dokumente) i
  `20261104120000_project_document_idempotency` (opciono idempotentno povezivanje dokumenata, bez izmjene postojećih redova) i
  `20261104150000_refresh_token_family` (nullable kolona i indeks za opoziv sesije; stari redovi ostaju netaknuti) i
  `20261104220000_project_document_tombstone` (nullable tombstone i indeks; postojeći redovi netaknuti). **Kompatibilnost:** stare backend instance ne filtriraju tombstone i mogu ga fizički obrisati; koordinisati prelaz svih instanci i ne rollbackovati aplikaciju na staru verziju bez plana (vidi `docs/BACKEND.md`).
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

## 7. Backup / restore (INF-06)

**Skripte:** [`scripts/ops/backup.sh`](../scripts/ops/backup.sh) i
[`scripts/ops/restore.sh`](../scripts/ops/restore.sh). Isti alati rade na hostu, u kontejneru i u
CI-ju (`pg_dump`/`pg_restore`/`psql` iz `postgresql-client`).

### 7.1 Rutinski backup (dnevno)

```bash
DATABASE_URL="postgresql://…/gradix?schema=public" \
BACKUP_DIR=/var/backups/gradix BACKUP_RETENTION=14 \
./scripts/ops/backup.sh
```

- `pg_dump --format=custom --compress=9 --no-owner --no-privileges` → jedan `.dump` + `.sha256`.
- Retencija: zadržava se `BACKUP_RETENTION` (default **7**) najnovijih dumpova.
- **Gdje držati:** van hosta na kojem radi baza (Coolify „Scheduled Tasks“ ili cron na DB hostu);
  dump **nije** u git-u (`backups/` je u `.gitignore`).
- **RPO / RTO (dogovor):** RPO ≤ 24 h (dnevni dump), RTO ≤ 1 h (restore u drugu bazu + preusmjeranje
  aplikacije). Ako treba manji RPO, uključiti PITR (WAL arhiv) na DB servisu — van obima v1.

### 7.2 Restore (vježba ili stvarni oporavak)

```bash
# 1) napravi praznu ciljnu bazu (nikad ne restauriraj preko aktivne!)
psql "$ADMIN_URL" -c 'CREATE DATABASE gradix_restore'
# 2) vrati dump u cilj (provjerava sha256 i odbija DATABASE_URL / ime sa "prod")
RESTORE_DATABASE_URL="postgresql://…/gradix_restore" \
./scripts/ops/restore.sh /var/backups/gradix/gradix-20261103T033000Z.dump
# 3) provjeri pa tek onda preusmjeri aplikaciju (Coolify: DATABASE_URL na novu bazu)
```

`restore.sh` namjerno traži **`RESTORE_DATABASE_URL`** (nikad `DATABASE_URL`), odbija cilj koji je
identičan izvoru i cilj čije ime sadrži `prod` (osim uz `ALLOW_PRODUCTION_RESTORE=yes`), te provjeri
`sha256` prije nego što dira bazu. Na kraju ispiše broj redova za `users, projects, tasks,
timer_sessions, audit_logs, cost_entries` — prazna tabela je signal da restore nije potpun.

### 7.3 Dokaz da restore radi (noćni drill)

Workflow [`.github/workflows/backup-restore.yml`](../.github/workflows/backup-restore.yml) svaku
noć u **03:30 UTC** (i ručno, `workflow_dispatch`) podigne Postgres, pusti migracije + seed,
napravi backup, vrati ga u `gradix_restore` i **uporedi brojeve redova** izvor ↔ restore
(`users, companies, projects, tasks, timer_sessions, audit_logs, cost_entries, diary_entries`) plus
broj primijenjenih migracija. Dump se čuva kao artefakt 7 dana.

### 7.4 Šta skripte ne pokrivaju

| Šta | Trenutno | Preporuka |
|---|---|---|
| MinIO objekti | fajlovi na hostu (`/mnt/shared-app-files/...`) | `mc mirror` na sekundarni bucket/disk (ručni korak u runbook-u, **ne** tvrdi se da je automatizovan) |
| Konfiguracija | Coolify env | izvoz env-a u šifrovani backup van hosta |
| PITR (WAL) | nije uključeno | na DB servisu, ako RPO od 24 h nije dovoljan |

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

### 10.1 Dva domena: frontend `gradix.ba101.top` + API `api.gradix.ba101.top` (D-041)

Deploy je **dvodomenski** (odluka vlasnika): frontend se servira na `https://gradix.ba101.top`,
API na `https://api.gradix.ba101.top`. Posljedice su tri postavke koje moraju biti usklađene —
ako jedna nedostaje, login padne na način koji izgleda kao „mrežna greška“:

| Varijabla | Gdje se postavlja | Vrijednost | Ako nedostaje |
|---|---|---|---|
| `VITE_API_URL` | **build-arg frontenda** (Coolify env, pa **rebuild**) | `https://api.gradix.ba101.top` | bundle zove relativni `/api` na frontend domenu → 404 (frontend nema API) |
| `CSP_API_ORIGIN` | env kontejnera frontenda | `https://api.gradix.ba101.top` | nginx CSP blokira `fetch` („violates … connect-src“) i `<img>` sa API domena |
| `CORS_ORIGIN` | env backenda | `https://gradix.ba101.top` | browser blokira odgovor („No 'Access-Control-Allow-Origin'“) |

**Zašto CSP mora znati API origin:** `connect-src` pokriva `fetch` (login, svi pozivi) i Socket.IO
(`ws:`/`wss:` su već dozvoljeni za sve hostove), a `img-src` pokriva logo firme i fajlove koji se
prikazuju preko `<img src="https://api…/api/files?path=…">`. Zato `CSP_API_ORIGIN` ulazi u **oba**
direktiva:

```
img-src 'self' data: blob: ${CSP_API_ORIGIN};
connect-src 'self' ws: wss: ${CSP_API_ORIGIN};
```

Vrijednost je **prazna po defaultu** (lokalni razvoj i jednozemljisni deploy ostaju strogi
`'self'`), a `nginx:alpine` je zamjenjuje pri startu kontejnera (`envsubst`). Zato je u
`frontend/Dockerfile` postavljen `ENV CSP_API_ORIGIN=""` — envsubst preskače **nedefinisane**
varijable i u konfiguraciji bi ostao literal `${CSP_API_ORIGIN}`, što nginx odbija.

**Guard:** `check:image` traži da sva tri `add_header` bloka imaju **identičan** CSP i da i `img-src`
i `connect-src` sadrže `${CSP_API_ORIGIN}` — tako se ne može desiti da se ažurira samo `server`
blok, a `/assets/` i `= /index.html` ostanu bez dozvole.

**Poznati gap prije dva domena:** `GET /api/files` traži `Authorization` header, a `<img src>` ga ne
šalje — logo firme se zato prikazuje samo ako se fajl dovlači kroz `fetch` + `blob:` URL. Sa dva
domena to je vidljivije (i `Cross-Origin-Resource-Policy` je sada `cross-origin` na tom odgovoru).
Rješenje (potpisani kratkotrajni URL za `GET /api/files` ili javni logo endpoint) je **posebna
backend stavka** — do tada logo u postavkama firme koristi blob putanju.

**Redoslijed deploya (Coolify):**

0. Prije deploya backend koda generisati nezavisnu tajnu `openssl rand -base64 48` (najmanje 32 znaka, različitu od `JWT_ACCESS_SECRET`); sačuvati je samo u sigurnom secret storeu, ne u repou ni logovima. U Coolifyju je postaviti kao `REFRESH_REPLAY_SECRET` u build-time **i** runtime okruženje (Compose je interpolira već pri buildu), s identičnom vrijednošću na **svim** backend replikama prije deploya. Planirati rollout bez miješanja nekompatibilnih replay implementacija; pogledati `docs/BACKEND.md` za grace period i posljedice rotacije tajne.
1. Backend: `CORS_ORIGIN=https://gradix.ba101.top` → deploy.
2. Frontend: `VITE_API_URL=https://api.gradix.ba101.top` + `CSP_API_ORIGIN=https://api.gradix.ba101.top`
   → **rebuild** (prva je build-time, druga se čita pri startu kontejnera).
3. Provjera: login u browseru + u DevTools → Network (POST `/api/auth/login` → `200`) i
   Console (nema CSP/CORS greške).

> Jednozemljisni deploy (API kroz isti nginx na `/api`) i dalje radi bez izmjena: oba ključa ostaju
> prazna, `BACKEND_URL` pokazuje na interni servis, a CSP je tada strogo `'self'`.

---

## 9. Poznati dugovi (ulaze u segmente)

| # | Dug | Segment |
|---|---|---|
| I1 | ~~Nema strukturisanog logovanja ni korelacionog ID-a~~ **riješeno** u INF-04 (JSON logger + `x-request-id`) | INF-04 |
| I2 | ~~Nema metrika/readiness endpointa (samo `SELECT 1`)~~ **riješeno** u INF-05 (`/api/ready`: Postgres + MinIO + migracije) | INF-05 |
| I3 | ~~Nema automatskog backup/restore testa~~ **riješeno** u INF-06 (skripte + noćni drill u CI-ju) | INF-06 |
| I4 | Nema SBOM/skeniranja slika ni pinovanja po digestu | CI-04 |
| I5 | Kontejneri rade kao `root` (backend/frontend) | INF-03 |
| I6 | Nema resource limita (`cpus`, `mem_limit`) u compose-u | INF-03 |
| I7 | ~~`REDIS_*` mrtva konfiguracija~~ **riješeno** u INF-07 (throttle u Redisu, TLS + ACL, fail-open) | INF-07 |
| I8 | Nema staging okruženja (svjesna odluka D-007) | — |

---

## 11. Redis (INF-07) — throttle i ACL

Redis (`redis-core:6380` — **TLS port**, ne 6379; eksterna mreža `redis_net`) koristi se za
**jedan** posao u v1: brojač
throttlea (`120 zahtjeva / 60 s`, isti limit kao prije). Time limit važi **između replika** i
preživljava restart; memorijski `ThrottlerStorage` je i dalje tu kao fallback.

### 11.1 Šta je u kodu

| Fajl | Uloga |
|---|---|
| `backend/src/common/redis/redis.service.ts` | jedan `ioredis` klijent (`lazyConnect`, TLS sa CA iz `REDIS_TLS_CA_FILE`, ACL `REDIS_USER`), `ping()` za readiness, korektno `quit()` pri gašenju |
| `backend/src/common/redis/failover-throttler.storage.ts` | `INCR` + `PEXPIRE (NX)` + `PTTL` u jednom `MULTI` po ključu `<prefix>throttle:<throttler>:<key>`; na grešku → memorijski storage (fail-open) |
| `backend/src/common/redis/redis.module.ts` | `@Global()` modul (isti klijent za throttle i readiness) |
| `backend/src/config/env.ts` | validacija `REDIS_*` grupe (host bez lozinke = greška pri startu) |
| `backend/src/modules/health/health.service.ts` | `checks.redis` u `/api/ready`: `disabled` (nema hosta) / `ok` / `error` — **ne obara** readiness |

Ključevi su jedini podaci koje backend piše u Redis: `<prefix>throttle:*`. Nema queue-ova ni
trajnih podataka — ako se Redis obriše, gubi se samo trenutni brojač (rate limit se resetuje).

### 11.2 ACL korisnik (radi vlasnik infrastrukture)

Lozinku generiše i unosi **vlasnik** (Coolify → Environment Variables → `REDIS_PASSWORD`).
Liniju za `redis-cli` ispisuje skripta (prava su minimalna, bez `@admin`):

```bash
REDIS_USER=gradix REDIS_PREFIX='gradix:' ./scripts/ops/redis-acl.sh
# → ACL SETUSER gradix reset on ><LOZINKA> ~gradix:* +ping +multi +exec +incr +pexpire +pttl ...
```

`reset` čini komandu idempotentnom (ponovno pokretanje zamjenjuje prava). Ako server koristi
`aclfile`, poslije dodavanja treba `ACL SAVE` — inače se korisnik gubi pri restartu Redisa.

> **Namjerno nema `+info`:** korisniku ne treba nijedna administrativna komanda. Zbog toga je u
> klijentu isključen ioredis-ov *ready check* (`enableReadyCheck: false`) — on šalje `INFO` i bez
> dozvole loguje „Skipping the ready check because INFO command fails“. Spremnost provjeravamo
> sami, `PING`-om u `/api/ready` (§11.1).

### 11.3 Provjera poslije uključivanja

```bash
# 1) ACL je tačan (očekivano: on, ~gradix:*, bez @admin)
ACL GETUSER gradix
#    (ACL komande izvršavaj na TLS portu: redis-cli -h redis-core -p 6380 --tls --cacert <CA> …)
# 2) backend vidi Redis
curl -s https://<api-domen>/api/ready | jq '.checks.redis'   # {"status":"ok","latencyMs":1}
# 3) throttle zaista broji u Redisu (ključ postoji i ima TTL)
redis-cli -h redis-core -p 6380 --user gradix --pass '<LOZINKA>' --tls --cacert <CA> \
  KEYS '<prefix>throttle:*'
```

### 11.4 Fail-open pravilo (D-014, D-039)

- Redis **nije** obavezna zavisnost: prazan `REDIS_HOST` = identično ponašanje kao prije INF-07.
- Ako Redis padne u radu: throttle se vraća na memorijski storage (jedno `warn` logovanje),
  `/api/ready` prikaže `checks.redis.status = "error"`, ali ostaje `200` — API nastavlja raditi.
- Redis se **nikad** ne koristi za podatke koji se ne smiju izgubiti (sessions, queue, fajlovi).

### 11.5 Zavisnost

`ioredis@5` (jedina nova zavisnost segmenta) — obrazloženje u `docs/DECISIONS.md` D-039:
TLS + ACL + `MULTI` bez dodatnog koda; alternative (`redis`/node-redis, ručni RESP klijent)
odbačene su jer traže više koda za isto ponašanje.
