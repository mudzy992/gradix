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
| 9 | Hardkodovani bind mount-i `/data/coolify/ssl/coolify-ca.crt` i `/data/coolify/ssl/redis-core/redis-ca.crt` | Ako putanja ne postoji, Docker kreira **direktorij** i aplikacija puca na nejasnoj grešci. Mount-i uklonjeni — TLS se sada definiše kroz `DATABASE_URL` (uputstvo u §4) |
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
   | `FRONTEND_PORT` | host port za nginx, default `5173` |
   | `BACKEND_PORT` | host port za API, default `3000` |
   | `RUN_MIGRATIONS` | `true` (default) |

4. Domene: Coolify mapira domenu na **frontend** servis (port **80**).
   Ako želiš i direktan API domen (mobilna aplikacija), mapiraj ga na
   **backend** servis (port **3000**) i dodaj tu domenu u `CORS_ORIGIN`.
5. Deploy. Prvi build traje duže (npm ci + Prisma engine).

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

---

## 4. TLS prema PostgreSQL bazi

`pg` (i Prisma preko `@prisma/adapter-pg`) čita SSL iz `DATABASE_URL`:

| Scenario | `DATABASE_URL` |
|---|---|
| Baza u istoj Docker mreži, bez TLS-a | `...?schema=public&sslmode=disable` |
| TLS bez provjere certifikata | `...?schema=public&sslmode=require` |
| TLS sa provjerom CA | `...?schema=public&sslmode=verify-ca&sslrootcert=/etc/ssl/certs/coolify-ca.crt` |

Za `verify-ca` CA fajl mora postojati **u kontejneru**. U Coolify:
Backend → *Persistent Storage* → mountaj
`/data/coolify/ssl/cert.pem` → `/etc/ssl/certs/coolify-ca.crt` (read-only).

> U `docker-compose.yml` namjerno **nema** hardkodovanih host putanja: bind
> mount na nepostojeću putanju kreira direktorij i ruši start kontejnera.

---

## 5. Migracije i seed

* Migracije se pokreću automatski pri startu kontejnera
  (`docker-entrypoint.sh` → `prisma migrate deploy`). Isključi sa
  `RUN_MIGRATIONS=false` ako migracije pokrećeš kao poseban korak.
* Seed (demo podaci) **nije** u produkcijskoj slici (izbjegavamo `tsx` i
  TypeScript izvor u runtime image-u). Jednokratno, iz `builder` stage-a:

  ```bash
  docker build --target builder -t gradix-backend:seed ./backend
  docker run --rm \
    -e DATABASE_URL="postgresql://..." \
    -e SEED_PASSWORD="GradixSeed1" \
    gradix-backend:seed npx prisma db seed
  ```

---

## 6. Lokalno pokretanje

```bash
cp .env.example .env          # popuni DATABASE_URL + JWT tajne
docker compose up --build     # MinIO + backend + frontend

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
| `backend` | `npm ci` → `prisma generate` → `eslint` → unit testovi → `nest build` → postoji `dist/src/main.js` |
| `backend-e2e` | PostgreSQL servis → migracije → seed → `npm run test:e2e` |
| `frontend` | `npm ci` → `oxlint` → `tsc -b` → `vite build` |
| `web-e2e` | stvarni backend (`/api/health`) + buildani frontend kroz `vite preview` → Playwright |
| `docker` | root Dockerfile-ovi identični kopijama → `docker compose config` → build oba image-a → **smoke test kontejnera** (migracije + `/api/health`, nginx + proxy) |

Ako je job `docker` zelen, Coolify build prolazi.

---

## 8. Ostale napomene

* `mobile/` (Expo) nije dio Docker/CI toka — nema produkcijskog image-a.
* `minio/minio:latest` i `nginx:alpine` su „rolling” tagovi; za potpuno
  reproducibilne buildove pinuj konkretne verzije.
* `.env.coolify` je **predložak** (placeholder tajne) — stvarne vrijednosti
  nikada ne commitovati.
