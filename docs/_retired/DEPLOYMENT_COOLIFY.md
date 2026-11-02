> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Gradix — Coolify deploy i Docker audit

Ovaj dokument opisuje šta je popravljeno u Docker/CI konfiguraciji i kako se
Gradix deploya na Coolify tako da build **prođe iz prve**.

---

## 1. Audit — šta je bilo pokvareno i šta je popravljeno

### 1.1 Kritično (build/start nije mogao uspjeti)

| # | Problem | Posljedica | Popravka |
|---|---------|------------|----------|
| 1 | `backend/package-lock.json` nije bio u sinhronizaciji sa `package.json` (`@prisma/adapter-pg`, `pg`, … nedostaju) | `npm ci` pada odmah → **i CI i Docker build padaju** (EUSAGE) | Lock fajl regenerisan (`npm install`), `npm ci` sada prolazi |
| 2 | Ulazna tačka je bila `node dist/main`, a `nest build` emituje `dist/src/main.js` (zbog `prisma.config.ts` i `generated/` u programu kompilacije) | Kontejner se ruši u restart-loop (`Cannot find module '/app/dist/main'`) | `start:prod` = `node dist/src/main`, `rootDir: "."` u `tsconfig.build.json`, `prisma.config.ts` izuzet iz builda, Docker `CMD ["node","dist/src/main.js"]` |
| 3 | `npx prisma generate` u Docker buildu zahtijeva `DATABASE_URL` (iz `prisma.config.ts`) | Docker build pada u build fazi | U build stage-u postavljen placeholder `ENV DATABASE_URL=...` (generate ne otvara konekciju) |
| 4 | `docker-compose.yml` je koristio `context: ./backend` + `dockerfile: ../Dockerfile` (Dockerfile **izvan** build konteksta) | Build zavisi od BuildKit ponašanja; klasični builder odbija build | Dockerfile-ovi preseljeni u `backend/Dockerfile` i `frontend/Dockerfile` (kontekst = direktorij aplikacije) |
| 5 | `prisma.config.ts` nije kopiran u produkcijsku sliku, a `npx prisma migrate deploy` se izvršava u `CMD` bez Prisma CLI-ja (bio je `devDependency`) | Migracije pucaju → kontejner ne starta | `prisma` i `dotenv` su sada produkcijske zavisnosti, `prisma.config.ts` + `prisma/` se kopiraju, migracije pokreće `docker-entrypoint.sh` |
| 6 | `Dockerfile.frontend` je bio placeholder: nginx sluša na portu **80**, `EXPOSE 5173`, healthcheck `curl` na **5173** | Healthcheck uvijek pada (nginx:alpine nema `curl`), compose mapira `5173:5173` na ništa | Pravi multi-stage build (`vite build` → `nginx:alpine`), nginx sluša na 80, healthcheck preko `wget`, compose mapira `${FRONTEND_PORT:-5173}:80` |
| 7 | Frontend je dobijao `VITE_API_URL=http://gradix-backend:3000` kao **runtime** env | Vite varijable se „pekuju” u build; browser bi pokušao da otvori `http://gradix-backend:3000` → aplikacija bez API-ja | `VITE_API_URL` je build-arg (default prazno) → relativni `/api` i `/socket.io` pozivi, a nginx ih proksira na `$BACKEND_URL` |
| 8 | Nije postojao nijedan `.dockerignore` | `COPY . .` je slao `node_modules`, `dist`, a mogao je i `.env` (tajne u sloju slike) | Dodati `backend/.dockerignore`, `frontend/.dockerignore`, root `.dockerignore` |

### 1.2 Visoko (deploy bi „prošao”, pa pao u produkciji)

| # | Problem | Popravka |
|---|---------|----------|
| 9 | Bind mount-i za CA certifikate | Bez njih `DATABASE_URL` sa `sslrootcert=` puca u runtime-u (`ENOENT … coolify-ca.crt`, vidi 1.4 #27); sa običnim bind-om Docker na nepostojeću putanju napravi **direktorij** i maskira problem. Rješenje: mount-i su vraćeni sa `create_host_path: false` + env override (`POSTGRES_CA_FILE`/`REDIS_CA_FILE`) + preflight u entrypointu (§4) |
| 10 | `MINIO_PORT` je korišten i za host mapiranje i kao interni port | Host portovi su odvojeni (`MINIO_API_PORT`, `MINIO_CONSOLE_PORT`), interni port MinIO-a je fiksan (9000) |
| 11 | `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` korišteni kao MinIO root kredencijali — OK, ali ih je trebalo dokumentovati | Dokumentovano u `.env.example` / §3 |
| 12 | Backend nije imao healthcheck; `depends_on` je bio `service_started` | Dodat healthcheck preko `GET /api/health` (node `fetch`, bez `curl` u slici) |
| 13 | MinIO healthcheck koristio `curl` (nema ga noviji MinIO image) | `mc ready local` (preporuka MinIO-a; `mc` je u image-u) |
| 14 | MinIO nedostupan pri startu backenda → crash-loop | `MinioService` sada pokušava 10× (3 s pauza) prije nego odustane |
| 15 | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` bez defaulta u compose-u | `:?` → deploy pada odmah sa jasnom porukom umjesto starta sa praznim tajnama |
| 16 | Root `Dockerfile` / `Dockerfile.frontend` su bili jedini Dockerfile-ovi (i to sa `../` putanjom) | Root fajlovi zadržani kao **identične kopije** (za stare Coolify konfiguracije koje pokazuju na `/Dockerfile`), a CI provjerava da su identični (`diff`) |

### 1.3 CI

| # | Problem | Popravka |
|---|---------|----------|
| 17 | Workflow se pokretao samo na `arena/0874ef4b-gradix` | Trigger: `main`, `arena/**`, `pull_request`, `workflow_dispatch` + `concurrency` (otkazuje zastarjele runove) |
| 18 | „CI je bio zelen za frontend” jer je frontend job samo radio `npm ci` i `echo` | Frontend job sada radi `oxlint` + `tsc -b` + `vite build` |
| 19 | Playwright job je zvao `vite preview` bez prethodnog builda (nema `dist`) | Build prije preview-a; backend se starta iz builda i čeka se `/api/health`; dodate `vite.config.ts` `preview.proxy` rute |
| 20 | ESlint: 1005 grešaka (616 `prettier/prettier`, ~372 `no-unsafe-*` u e2e testovima) | `eslint --fix` (formatiranje), 7 stvarnih grešaka u `src` popravljeno, `no-unsafe-*` isključen **samo** za `test/**` (supertest vraća `any`) — `src` ostaje strogo provjeren |
| 21 | Frontend je imao 2 realne `react-hooks/rules-of-hooks` greške | Hook pozivi razdvojeni (`useHasPermission` se više ne poziva uslovno) |
| 22 | Nijedna provjera Docker builda | Novi `docker` job: `docker compose config`, build oba image-a i **smoke test** (backend kontejner + migracije + `/api/health`, frontend kontejner + nginx proxy na API) |

---

### 1.4 Ispravke nakon prvih realnih Coolify deployeva

| # | Simptom na Coolifyju | Uzrok | Popravka |
|---|----------------------|-------|----------|
| 23 | `RUN npm run build` → `sh: vite: not found` (exit 127) | Coolify prosljeđuje sve env varijable kao **build-arg-ove** (`NODE_ENV=production`), a npm tada preskače `devDependencies` — `vite`, `typescript`, `tailwind` | `ARG NODE_ENV` + `NODE_ENV=development npm ci --include=dev` (frontend i backend `deps` stage); CI ima korak koji to reproducira |
| 24 | `docker compose pull` → `pull access denied for minio/minio` | **MinIO community image više nije javno dostupan**: `minio/minio` (Docker Hub) vraća „repository does not exist”, a `quay.io/minio/minio` vraća `401 Unauthorized` — potvrđeno sa čistog CI runnera, dakle nije stvar hostinga | Default `MINIO_IMAGE=ghcr.io/coollabsio/minio:latest` (Coolify-jev mirror klasičnog MinIO; testirano — S3 API radi, `mc` postoji); alternativa `quay.io/minio/aistor/minio:latest`; CI diže MinIO iz compose-a i traži `healthy` |
| 25 | `failed to bind host port 0.0.0.0:5173/tcp: address already in use` | Servisi su objavljivali **fiksne host portove**, a Coolify deploya blue/green — stari i novi kontejner kratko rade paralelno, pa dva kontejnera ne mogu držati isti host port | Uklonjeni `ports`, korišten `expose` (80/3000/9000/9001); Coolify proxy dolazi do kontejnera preko Docker mreže. CI provjerava da compose nema objavljenih host portova |
| 26 | Backend nije mogao doći do baze/Redisa | Servisi su bili samo u internoj `gradix-net` mreži | Dodane **eksterne mreže `db_net` i `redis_net`** (`external: true`); backend je na `gradix-net` + `db_net` + `redis_net` |
| 27 | `[Scheduler] PrismaClientKnownRequestError … ENOENT: no such file or directory, open '/etc/ssl/certs/coolify-ca.crt'` | `DATABASE_URL` koristi `sslrootcert=/etc/ssl/certs/coolify-ca.crt`, ali CA fajl **nije bio mapiran** u backend kontejner (Coolify ga drži na hostu) | `docker-compose.yml` mapira `POSTGRES_CA_FILE` (`/data/coolify/ssl/coolify-ca.crt`) → `/etc/ssl/certs/coolify-ca.crt` i `REDIS_CA_FILE` (`/data/coolify/ssl/redis-core/redis-ca.crt`) → `/etc/ssl/redis/redis-ca.crt` (`read_only`, `create_host_path: false`); entrypoint **preflight** pada odmah sa jasnom porukom; CI provjerava da su oba mounta tu |
| 28 | MinIO podaci nisu bili na hostu | `/data` je bio anonimni Docker volume — teško se backupira i nestaje sa `docker compose down -v` | `/data` je sada **bind mount** na `/mnt/shared-app-files/gradix/minio` (override: `MINIO_DATA_DIR`); CI provjerava da je bind |

## 2. Struktura Docker fajlova

```
Dockerfile                 # identična kopija backend/Dockerfile  (legacy Coolify putanja)
Dockerfile.frontend        # identična kopija frontend/Dockerfile (legacy Coolify putanja)
backend/
  Dockerfile               # kanonski backend Dockerfile (kontekst: ./backend)
  docker-entrypoint.sh     # prisma migrate deploy + start
  .dockerignore
frontend/
  Dockerfile               # kanonski frontend Dockerfile (kontekst: ./frontend)
  nginx/default.conf.template  # SPA fallback + /api i /socket.io proxy
  .dockerignore
docker-compose.yml         # minio + backend + frontend
```

Backend image:

* stage `deps` → `npm ci` (keš sloj),
* stage `builder` → `prisma generate` + `nest build`,
* stage `production` → `npm ci --omit=dev`, `dist/`, `generated/`, `prisma/`,
  `prisma.config.ts`, keš Prisma engine-a, healthcheck, entrypoint.

Frontend image:

* stage `builder` → `npm ci` + `vite build` (`VITE_API_URL` build-arg),
* stage `production` → `nginx:alpine` + `dist/` + nginx template
  (`BACKEND_URL` → `/api`, `/socket.io`).

---

## 3. Deploy na Coolify

### Varijanta A — Docker Compose resource (preporučeno)

1. Coolify → **New Resource → Docker Compose** → izaberi repo i granu.
2. `Docker Compose Location`: `docker-compose.yml` (root projekta).
3. **Environment Variables** — obavezno postavi:

   | Varijabla | Primjer / napomena |
   |---|---|
   | `DATABASE_URL` | `postgresql://gradix_user:pass@postgres:5432/gradix?schema=public` |
   | `JWT_ACCESS_SECRET` | `openssl rand -base64 32` (min 32 znaka) |
   | `JWT_REFRESH_SECRET` | `openssl rand -base64 32` (min 32 znaka) |
   | `CORS_ORIGIN` | `https://app.tvoja-domena.ba` |
   | `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | promijeni `minioadmin` |
   | `MINIO_IMAGE` | opciono — default `ghcr.io/coollabsio/minio:latest` |
   | `RUN_MIGRATIONS` | `true` (default) |
   | `POSTGRES_CA_FILE` | host putanja CA za bazu — default `/data/coolify/ssl/coolify-ca.crt` |
   | `REDIS_CA_FILE` | host putanja CA za Redis — default `/data/coolify/ssl/redis-core/redis-ca.crt` |
   | `MINIO_DATA_DIR` | host direktorij za MinIO — default `/mnt/shared-app-files/gradix/minio` |
   | `SEED_PASSWORD` | min 10 znakova (samo za jednokratni seed — §5) |
   | `REDIS_HOST` / `REDIS_PORT` | opciono (v1 ne koristi Redis) |

   > **Host putanje:** compose mapira CA certifikate i MinIO podatke (tabela u
   > §4.1). Ako su na tvojoj mašini na drugom mjestu, postavi
   > `POSTGRES_CA_FILE` / `REDIS_CA_FILE` / `MINIO_DATA_DIR` — targeti u
   > kontejnerima se ne mijenjaju. Provjeri prije deploya:
   >
   > ```bash
   > ls -l /data/coolify/ssl/coolify-ca.crt /data/coolify/ssl/redis-core/redis-ca.crt
   > mkdir -p /mnt/shared-app-files/gradix/minio     # MinIO podaci
   > ```

4. **Mreže** — ovaj compose koristi dvije EKSTERNE mreže koje moraju
   postojati na hostu (u njima žive baza i Redis):

   ```bash
   # samo ako već ne postoje
   docker network create db_net
   docker network create redis_net
   ```

   Backend je priključen na `gradix-net` (interna), `db_net` i `redis_net`,
   pa `DATABASE_URL` mora koristiti hostname baze **razrješiv u `db_net`**
   (npr. ime kontejnera baze), a `REDIS_HOST` ime Redisa u `redis_net`.

   > Ako mreža ne postoji, deploy pada sa
   > `network db_net declared as external, but could not be found`.

5. **Domene**: Coolify mapira domenu na **frontend** servis (port **80**).
   Za direktan API domen (mobilna aplikacija) dodijeli domenu **backend**
   servisu (port **3000**) i dodaj je u `CORS_ORIGIN`. MinIO konzola
   (opciono): domena na **minio** servis, port **9001**.

6. Deploy. Prvi build traje duže (npm ci + Prisma engine).

> **Host portovi:** servisi namjerno ne objavljuju `ports` — Coolify radi
> blue/green deploy i fiksni host port bi pao sa `address already in use`.
> Ako ti treba direktan pristup preko IP-a, vidi §8.

> Compose koristi `:?` za `DATABASE_URL` i JWT tajne — ako neka nedostaje,
> deploy pada odmah sa porukom koja imenuje varijablu (namjerno, da se ne
> pokrene produkcija sa praznim tajnama).

### Varijanta B — dva odvojena Application resursa

**Backend**

* Base Directory: `/backend`
* Dockerfile Location: `/backend/Dockerfile`
* Port: `3000`
* Healthcheck: `GET /api/health`

**Frontend**

* Base Directory: `/frontend`
* Dockerfile Location: `/frontend/Dockerfile`
* Port: `80`
* Healthcheck: `GET /`
* Env: `BACKEND_URL=http://<backend-service-name>:3000`
  (ili javni API URL; tada postavi `VITE_API_URL` kao **build argument**)

> Ako imaš staru Coolify konfiguraciju koja pokazuje na `/Dockerfile` uz
> Base Directory `/backend` (ili `/frontend`), ona i dalje radi — root
> Dockerfile-ovi su identične kopije.

> **Varijanta B ne koristi `docker-compose.yml`**, pa CA certifikate moraš
> dodati ručno: backend → *Persistent Storage* → „Bind mount”
> `/data/coolify/ssl/coolify-ca.crt` → `/etc/ssl/certs/coolify-ca.crt`
> (read-only). Bez toga backend pada na `ENOENT … coolify-ca.crt` čim
> `DATABASE_URL` sadrži `sslrootcert=`.

---

## 4. TLS prema PostgreSQL bazi (i Redis-u)

`pg` (i Prisma preko `@prisma/adapter-pg`) čita SSL iz `DATABASE_URL`:

| Scenario | `DATABASE_URL` |
|---|---|
| Baza u istoj Docker mreži, bez TLS-a | `...?schema=public&sslmode=disable` |
| TLS bez provjere certifikata | `...?schema=public&sslmode=require` |
| TLS sa provjerom CA | `...?schema=public&sslmode=verify-ca&sslrootcert=/etc/ssl/certs/coolify-ca.crt` |

### 4.1 CA certifikati — već mapirani u `docker-compose.yml`

Coolify čuva CA fajlove na **hostu** (`/data/coolify/ssl/...`), a aplikacija ih
traži **unutar kontejnera**. Compose zato mapira oba fajla u `backend` servis:

| Host (Coolify) | U kontejneru | Env override |
|---|---|---|
| `/data/coolify/ssl/coolify-ca.crt` | `/etc/ssl/certs/coolify-ca.crt` | `POSTGRES_CA_FILE` |
| `/data/coolify/ssl/redis-core/redis-ca.crt` | `/etc/ssl/redis/redis-ca.crt` | `REDIS_CA_FILE` |

Oba su `read_only` i sa `create_host_path: false`: ako putanja na hostu ne
postoji, `docker compose` padne sa `bind source path does not exist` — umjesto
da tiho napravi **direktorij** i sruši Prismu tek u runtime-u.

Put do CA **unutar kontejnera** mora se poklapati sa `sslrootcert=` u
`DATABASE_URL` (standardno `/etc/ssl/certs/coolify-ca.crt`). Ako ti CA stoji
na drugoj host putanji, mijenjaš samo `POSTGRES_CA_FILE` — target u kontejneru
i `DATABASE_URL` ostaju isti.

### 4.2 Preflight u kontejneru

`backend/docker-entrypoint.sh` prije migracija provjeri da fajl iz
`sslrootcert=` postoji. Ako ne postoji, kontejner stane odmah sa:

```
[gradix] GREŠKA: DATABASE_URL zahtijeva CA certifikat '/etc/ssl/certs/coolify-ca.crt',
[gradix]   ali tog fajla nema u kontejneru (ili je direktorij).
```

Bez toga greška ispliva tek pri prvom upitu (npr. u scheduleru), satima nakon
deploya. Isključivanje: `SSL_PREFLIGHT=false`.

---

## 5. Migracije i seed

### 5.1 Migracije

* Migracije se pokreću automatski pri startu kontejnera
  (`docker-entrypoint.sh` → `prisma migrate deploy`). Isključi sa
  `RUN_MIGRATIONS=false` ako migracije pokrećeš kao poseban korak.

### 5.2 Seed (demo podaci) — dio slike, pokreće se ručno jednom

Seed **jeste** u produkcijskoj slici: `tsconfig.build.json` uključuje
`prisma/`, pa `nest build` proizvede `dist/prisma/seed.js`. U runtime-u zato
nema `tsx`-a, nema TypeScript izvora i nema dev zavisnosti — seed se pokreće
običnim `node`-om, u istom image-u kao API.

Pokreće se **jednom, ručno**, poslije prvog uspješnog deploya (migracije su
već prošle pri startu kontejnera). Dvije varijante, isti rezultat — obje
koriste `DATABASE_URL` i mrežu `db_net` koje backend već ima.

**Varijanta 1 — Coolify terminal (najprostije)**

Coolify → *Application / Service* → servis `backend` → **Terminal**:

```bash
node dist/prisma/seed.js
```

Kontejner već ima `DATABASE_URL`, `SEED_PASSWORD` i pristup `db_net` mreži, pa
nema dodatnog setapa. (`npm run db:seed:prod` radi istu stvar.)

**Varijanta 2 — `docker compose run` na Coolify hostu**

```bash
cd /data/coolify/applications/<uuid>     # direktorij u kojem Coolify drži compose
docker compose run --rm backend node dist/prisma/seed.js
```

`docker compose run` diže **novi** kontejner sa istom konfiguracijom
(`DATABASE_URL`, `SEED_PASSWORD`, `db_net`), entrypoint prvo odradi
`prisma migrate deploy` (idempotentno), pa seed. Pokrenuti kontejneri se ne
diraju.

> Ne dodavati `RUN_SEED` u `docker-entrypoint.sh`: seed bi se tada vrtio na
> svakom restartu/redeployu i resetovao podešavanja kompanije.

**Šta seed upiše**

| Podatak | Vrijednost |
|---|---|
| Kompanija | `Demo Gradnja` (slug `demo`, Sarajevo, BA) |
| Platform admin | `platform@gradix.local` — `PLATFORM_ADMIN`, bez kompanije |
| Admin kompanije | `admin@gradix.local` — `SUPER_ADMIN` |
| Ops korisnici | `pm@`, `ss@`, `worker@`, `driver@`, `op@`, `mechanic@`, `accountant@` na `gradix.local` |
| Lozinka (svi) | vrijednost `SEED_PASSWORD` (min 10 znakova) |
| Demo projekat | `DEMO-1` „Sarajevo obilaznica”, javni; mašine, materijali, deponije, vozni list |

**Provjera nakon seeda**

1. Otvori frontend domen i prijavi se kao `admin@gradix.local` /
   `SEED_PASSWORD` (ili platform admin za platformski dio).
2. `curl -fsS https://<backend-domen>/api/health` → `{"status":"ok", ...}`.
3. MinIO bucket `gradix` ne treba ručno praviti — `MinioService.ensureBucket`
   ga kreira pri prvom uploadu.

> **Pažnja:** seed je idempotentan za korisnike i kompaniju (`upsert`), ali
> **resetuje `Setting` redove** kompanije `demo` na defaultne vrijednosti. Ako
> je firma već u upotrebi (custom naziv, tagline, kontakt) — seed **ne**
> pokretati ponovo, ili prvo napravi `pg_dump`.
> U razvoju, uz `tsx`: `cd backend && npm run db:seed` (isti `prisma/seed.ts`).

### 5.3 Prvi koraci poslije seeda

1. Prijavi se kao `platform@gradix.local` i **promijeni lozinku** (seed
   postavlja `mustChangePassword: false` da bi demo odmah radio).
2. Napravi pravu kompaniju preko platform admin dijela; demo kompaniju
   obriši kad više ne treba.

---

## 6. Lokalno pokretanje

Compose koristi dvije **eksterne** mreže (`db_net`, `redis_net`), pa ih
lokalno treba jednom kreirati (na Coolify hostu već postoje):

```bash
docker network create db_net    2>/dev/null || true
docker network create redis_net 2>/dev/null || true

cp .env.example .env             # popuni DATABASE_URL + JWT tajne
docker compose up --build        # MinIO + backend + frontend
```

> **Lokalno:** compose mapira CA fajlove sa Coolify host putanja. Ako ih nemaš,
> u `.env` postavi `POSTGRES_CA_FILE` i `REDIS_CA_FILE` na bilo koji postojeći
> PEM (npr. `POSTGRES_CA_FILE=/etc/ssl/certs/ca-certificates.crt`) — uz
> `sslmode=disable` u `DATABASE_URL` taj sadržaj se ne koristi. MinIO podaci
> idu na `MINIO_DATA_DIR` (default `/mnt/shared-app-files/gradix/minio`, lokalno
> postavi npr. `MINIO_DATA_DIR=./.data/minio`).

Servisi ne objavljuju host portove (Coolify blue/green). Za lokalni pregled
koristi priloženi override `docker-compose.local-ports.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-ports.yml up --build

# frontend   → http://localhost:5173
# API        → http://localhost:3000/api/health
# MinIO UI   → http://localhost:9001
```

Bez Dockera (razvoj):

```bash
cd backend && npm ci && npx prisma migrate dev && npm run start:dev
cd frontend && npm ci && npm run dev
```

---

## 7. Šta CI provjerava (`.github/workflows/ci.yml`)

| Job | Provjera |
|---|---|
| `backend` | `npm ci` → `prisma generate` → `eslint` → unit testovi → `nest build` → postoje `dist/src/main.js` **i `dist/prisma/seed.js`** |
| `backend-e2e` | PostgreSQL servis → migracije → seed → `npm run test:e2e` |
| `frontend` | `npm ci` → `oxlint` → `tsc -b` → `vite build` |
| `web-e2e` | stvarni backend (`/api/health`) + buildani frontend kroz `vite preview` → Playwright; seed se pokreće iz builda (`node dist/prisma/seed.js`), istim putem kao u produkciji |
| `docker` | root Dockerfile-ovi identični kopijama → `docker compose config` (+ guard: **nema objavljenih host portova**, eksterne mreže deklarisane, **CA certifikati mapirani u backend**, **MinIO `/data` je bind na host**) → build oba image-a → **MinIO iz compose-a** (pull + `healthy` healthcheck) → **Coolify emulacija** (`--build-arg NODE_ENV=production` + provjera da `vite` postoji u builder stage-u) → **seed iz produkcijske slike** (`node dist/prisma/seed.js` + provjera broja korisnika u bazi) → **SSL preflight** (nepostojeći CA mora stati odmah) → **smoke test kontejnera** (migracije + `/api/health`, nginx + proxy) |

Ako je job `docker` zelen, Coolify build prolazi.

---

## 8. Česte greške (build i deploy)

### `sh: vite: not found` (frontend) — `NODE_ENV=production` u buildu

Coolify prosljeđuje **sve** env varijable aplikacije kao Docker build-arg-ove,
uključujući `NODE_ENV=production`. Kada `NODE_ENV` ima vrijednost `production`,
`npm ci` **preskače `devDependencies`** — a `vite`, `typescript` i `tailwind`
su upravo tu. Zato build padne na `RUN npm run build` sa `vite: not found`.

Rješenje (u repo-u, ne u Coolify UI):

```dockerfile
ARG NODE_ENV=production                       # Coolify ga prosljeđuje
RUN NODE_ENV=development npm ci --include=dev --no-audit --no-fund
```

Isto važi i za backend (`nest`, `prisma`, `ts-jest` su dev zavisnosti u build
fazi). CI zato ima korak **„Frontend builder — Coolify emulacija”** koji
reproducira ovaj scenario i pada ako se zaštita ukloni.

### `pull access denied for minio/minio` (deploy padne prije starta)

Coolify prije starta radi `docker compose pull` za image-based servise. Deploy
pada sa:

```
Error response from daemon: pull access denied for minio/minio, repository does not exist
or may require 'docker login': denied: requested access to the resource is denied
```

**Ovo nije problem tvog servera.** MinIO community image više nije javno
dostupan ni na jednom od dva stara mjesta:

| Referenca | Status (provjereno 2026-11 sa čistog runnera) |
|---|---|
| `minio/minio:latest` (Docker Hub) | ❌ `repository does not exist` / access denied |
| `quay.io/minio/minio:latest` | ❌ `401 Unauthorized` |
| `ghcr.io/coollabsio/minio:latest` | ✅ **default u repo-u** — klasični MinIO, S3 API + `mc` rade |
| `quay.io/minio/aistor/minio:latest` | ✅ zvanični MinIO registry (AIStor build) |

Ako želiš drugu referencu, u Coolify env postavi `MINIO_IMAGE`, npr.:

```
MINIO_IMAGE=quay.io/minio/aistor/minio:latest
# ili interni mirror:
MINIO_IMAGE=registry.firma.local/minio/minio:latest
```

Provjera na serveru prije deploya:

```bash
docker pull ghcr.io/coollabsio/minio:latest
docker run --rm -d --name minio-test -p 9000:9000 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  ghcr.io/coollabsio/minio:latest server /data
curl -fsS http://127.0.0.1:9000/minio/health/live && echo OK
docker rm -f minio-test
```

> Ako u Coolify env-u već imaš `MINIO_IMAGE=minio/minio:latest` (stara
> vrijednost), obriši je ili zamijeni — inače override vraća mrtvu referencu.

### `failed to bind host port 0.0.0.0:5173/tcp: address already in use`

Coolify deploya **blue/green**: novi kontejner se digne prije nego što se stari
ugasi, pa fiksni host port (`ports:`) ne može biti bindan dva puta.

Rješenje je već u repo-u — servisi koriste samo `expose`:

```yaml
    expose:
      - "80"
```

Coolify proxy dolazi do kontejnera preko Docker mreže, pa host port nije
potreban. Ako i dalje vidiš grešku, na hostu provjeri ko drži port i ukloni
stare kontejnere:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '5173|3000|9001'
docker compose -p <coolify-project-name> down --remove-orphans
```

> Ako ti **treba** direktan pristup preko host porta (npr. mobilna aplikacija
> na `IP:3000`), dodaj `ports` u compose, ali računaj na kratak prekid rada pri
> svakom deployu (old + new kontejner ne mogu dijeliti isti port).

### Domena vraća `502 Bad Gateway` nakon uklanjanja host portova

Servis mora biti dostupan Coolify proxyju preko Docker mreže:

* u Coolifyju provjeri da servis ima **domenu** i tačan **port**
  (frontend `80`, backend `3000`, MinIO konzola `9001`),
* ako si mreže definisao ručno, provjeri da Coolify može dodati svoju proxy
  mrežu (`docker network ls`, obično `coolify`) i da kontejner nije
  izolovan (`docker inspect <kontejner> --format '{{json .NetworkSettings.Networks}}'`).

### `Cannot find module '/app/dist/prisma/seed.js'` pri pokretanju seeda

Image je buildan prije nego što je `prisma/` ušao u `tsconfig.build.json`, pa
u njemu nema kompajliranog seeda. Ponovo buildaj image
(`docker compose build backend` / Coolify *Redeploy* + *Force rebuild*), pa
provjeri:

```bash
docker run --rm --entrypoint ls gradix-backend /app/dist/prisma
```

Ako u produkciji vidiš grešku `Cannot find module 'tsx'` ili
`prisma/seed.ts: not found`, neko je pokrenuo `npx prisma db seed` (razvojna
varijanta) — u produkciji se koristi `node dist/prisma/seed.js`.

### Seed pada sa `SEED_PASSWORD must be at least 10 characters`

`SEED_PASSWORD` nije postavljen ili je prekratak. Postavi ga u Coolify
Environment Variables (min 10 znakova) i pokreni seed ponovo. U produkciji
**ne** koristi demo vrijednost `GradixSeed1`.

### `ENOENT: no such file or directory, open '/etc/ssl/certs/coolify-ca.crt'`

To je **prvi deploj poslije dodavanja compose fajla bez CA mounta** (ili stari
image). `DATABASE_URL` traži CA, a kontejner ga ne vidi — Prisma to objavi tek
pri prvom upitu (najčešće scheduler: `TimerCronService.closeStale`).

1. U repo verziji `docker-compose.yml` (commit sa `POSTGRES_CA_FILE`) mount
   već postoji. Provjeri da Coolify koristi **taj** compose fajl.
2. Provjeri da fajl na hostu stvarno postoji:
   ```bash
   ls -l /data/coolify/ssl/coolify-ca.crt
   ls -l /data/coolify/ssl/redis-core/redis-ca.crt
   ```
3. Provjeri da ga kontejner vidi:
   ```bash
   docker compose exec backend ls -l /etc/ssl/certs/coolify-ca.crt
   ```
4. Ako je CA na drugoj putanji, postavi `POSTGRES_CA_FILE`
   (i `REDIS_CA_FILE`) u Coolify env-u i redeploy.

Novi image to ne dozvoljava „tiho”: entrypoint preflight stane odmah sa porukom
`GREŠKA: DATABASE_URL zahtijeva CA certifikat …`.

### `bind source path does not exist: /data/coolify/ssl/coolify-ca.crt`

Namjerno ponašanje (`create_host_path: false`). Znači da na hostu nema tog
fajla — Coolify ga tamo drži samo ako je baza/Redis kreiran kroz Coolify sa TLS
podrškom. Rješenja:

* postavi `POSTGRES_CA_FILE` / `REDIS_CA_FILE` na stvarnu putanju, ili
* iz `DATABASE_URL` ukloni `sslrootcert=` i koristi `sslmode=require`
  (TLS bez provjere CA) ili `sslmode=disable` (baza u `db_net` mreži).

### Prebacivanje MinIO podataka sa starog volume-a na host

Ranije je `/data` bio Docker volume (`minio_data`), sada je
`/mnt/shared-app-files/gradix/minio`. Postojeći fajlovi se ne vide dok ih ne
prekopiraš (jednokratno, dok MinIO ne radi):

```bash
docker compose stop minio
# ime volume-a provjeri: docker volume ls | grep minio
docker run --rm \
  -v <projekat>_minio_data:/from:ro \
  -v /mnt/shared-app-files/gradix/minio:/to \
  alpine sh -c "cp -a /from/. /to/"
docker compose up -d minio
```

Ako u logu MinIO-a vidiš `permission denied`, podesi vlasnika direktorija na
hostu (`chown -R 1000:1000 /mnt/shared-app-files/gradix/minio`) — MinIO u
Coolify image-u radi kao neprivilegovan korisnik.

### `network db_net declared as external, but could not be found`

Compose očekuje **postojeće** mreže za bazu i Redis:

```bash
docker network create db_net
docker network create redis_net
```

Provjeri i da li se `DATABASE_URL` hostname razrješava unutar `db_net`
(`docker run --rm --network db_net nicolaka/netshoot nslookup <db-host>`), a
`REDIS_HOST` unutar `redis_net`.

### Frontend se učita, ali svi API pozivi padaju (`ERR_NAME_NOT_RESOLVED`)

Uzrok je `VITE_API_URL` postavljen na **interni Docker host**, npr.
`http://backend:3000`. Vite varijable se ugrađuju u JavaScript bundle pri
**build-u**, a browser ne može razriješiti Docker ime.

U Coolify UI: `VITE_API_URL` ostavi **prazno** (frontend tada koristi relativne
`/api` i `/socket.io` pozive, a nginx ih proksira na `BACKEND_URL`).
Za odvojen API domen koristi javni URL (`https://api.tvoja-domena.ba`).

### `DATABASE_URL je obavezan` pri deployu

Compose koristi `:?` za obavezne varijable. Unesi `DATABASE_URL`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` u Coolify Environment Variables.
Stare varijable iz v1 ere (`PGSSLROOTCERT`, `PGSSLMODE`, `REDIS_TLS_CA_FILE`,
`POSTGRES_*`) nisu potrebne — mogu se obrisati.

### Backend kontejner se restartuje u petlji

1. Provjeri log: `docker logs <kontejner>` — najčešće `prisma migrate deploy`
   ne može do baze (pogrešan `DATABASE_URL`, baza nije dostupna, `sslmode`).
2. Migracije možeš privremeno isključiti sa `RUN_MIGRATIONS=false` da vidiš
   log aplikacije.

---

## 9. Ostale napomene

* `mobile/` (Expo) nije dio Docker/CI toka — nema produkcijskog image-a.
* `ghcr.io/coollabsio/minio:latest`, `nginx:alpine` i `node:22-alpine` su
  „rolling” tagovi; za potpuno reproducibilne buildove pinuj konkretne verzije
  (`MINIO_IMAGE` u Coolify env-u olakšava pinovanje bez izmjene koda).
* `.env.coolify` je **predložak** (placeholder tajne) — stvarne vrijednosti
  nikada ne commitovati.
