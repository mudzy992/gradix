# Gradix — Kompletna lista environment varijabli (Coolify / PostgreSQL / TLS)

Ovaj dokument opisuje sve `env` varijable potrebne za pokretanje Gradix aplikacije u produkciji (Coolify) nakon prelaska sa MySQL na PostgreSQL.

> **Napomena (audit 2026-11):** aktuelno stanje Docker/Coolify konfiguracije,
> obavezne varijable i koraci deploya opisani su u
> [`DEPLOYMENT_COOLIFY.md`](./DEPLOYMENT_COOLIFY.md). Ovaj dokument je
> referenca po varijablama; dijelovi koji se odnose na TLS mount-e i Redis su
> ažurirani u skladu sa stvarnim `docker-compose.yml`.

---

## 1. Opšte / aplikacija

| Varijabla | Tip | Obavezno | Opis | Gdje se definira |
|---|---|---|---|---|
| `NODE_ENV` | `string` | ✅ | `production` ili `development` | `.env.coolify`, `docker-compose.yml` (`backend` servis), Coolify UI |
| `PORT` | `int` | ✅ | Port za NestJS backend (default `3000`) | `.env.coolify`, `docker-compose.yml` (`ports`), Coolify `PORT` |

---

## 2. Baza podataka — PostgreSQL (umjesto MySQL)

Gradix v1 je koristio `mysql` (`provider = "mysql"` u `prisma/schema/foundation.prisma`). Za Coolify / produkciju prebačen na `postgresql`.

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `POSTGRES_DB` | `string` | ✅ | Ime baze (npr. `gradix`) — EKSTERNA BAZA | `.env.coolify`, Coolify `POSTGRES_DB` (NE u `docker-compose.yml` — `db` servis NE postoji) |
| `POSTGRES_USER` | `string` | ✅ | DB korisnik — EKSTERNI | `.env.coolify`, Coolify `POSTGRES_USER` |
| `POSTGRES_PASSWORD` | `string` | ✅ | DB lozinka — EKSTERNA | `.env.coolify` (NE commitovati!), Coolify `POSTGRES_PASSWORD` |
| `DATABASE_URL` | `string` | ✅ | Potpuni PostgreSQL URL sa TLS — EKSTERNA INSTANCA | `.env.coolify`, `docker-compose.yml` (`backend` servis `environment`) — pokazuje na `postgres.external` ili `COOLIFY_DATABASE_URL` |

### Primjer `DATABASE_URL` za PostgreSQL sa TLS (`verify-ca`):
```
postgresql://gradix_user:gradix_password@db:5432/gradix?sslmode=verify-ca&sslrootcert=/etc/ssl/certs/coolify-ca.crt
```

### TLS CA cert mapiranje (Coolify):
- **Host put:** `/data/coolify/ssl/coolify-ca.crt`
- **Kontejner put (PostgreSQL klijent):** `/etc/ssl/certs/coolify-ca.crt`
- **Docker volume:** `- /data/coolify/ssl/coolify-ca.crt:/etc/ssl/certs/coolify-ca.crt:ro`
- **Dodatni env za PostgreSQL klijent (`pg`):**
  - `PGSSLROOTCERT=/etc/ssl/certs/coolify-ca.crt`
  - `PGSSLMODE=verify-ca`

> **NAPOMENA:** Prilikom prelaska sa MySQL na PostgreSQL, potrebno je regenerisati migracije (`prisma migrate dev --name init_postgres`) ili resetovati bazu (`prisma migrate reset`). Postojeće MySQL migracije (`2026..._phase_01_foundation` itd.) neće raditi direktno na PostgreSQL.

---

## 3. JWT / Autentifikacija

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | `string` (min 32 znaka) | ✅ | Tajna za `access` token | `.env.coolify` (zamijeniti `change-me-...`!), Coolify `JWT_ACCESS_SECRET` |
| `JWT_REFRESH_SECRET` | `string` (min 32 znaka) | ✅ | Tajna za `refresh` token | `.env.coolify`, Coolify `JWT_REFRESH_SECRET` |

> **UPOZORENJE:** Za produkciju `JWT_ACCESS_SECRET` i `JWT_REFRESH_SECRET` MORAJU imati najmanje 32 znaka. Koristiti `openssl rand -base64 32` za generisanje.

---

## 4. MinIO (objektno skladište) — postojeće iz Gradix v1

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `MINIO_ENDPOINT` | `string` | ✅ | URL ili hostname MinIO servera (npr. `minio` ili `localhost`) | `.env.coolify`, `docker-compose.yml` (`minio` servis), Coolify `MINIO_ENDPOINT` |
| `MINIO_PORT` | `int` | ✅ | **Interni** port MinIO API-ja (`9000`, fiksan u compose-u) | `.env.coolify`, `.env.example`, Coolify `MINIO_PORT` |
| `MINIO_IMAGE` | `string` | ❌ | Registry referenca MinIO image-a (default `ghcr.io/coollabsio/minio:latest`) | `.env.example`, Coolify `MINIO_IMAGE` |
| `MINIO_USE_SSL` | `bool` (`"true"` / `"false"`) | ✅ | Koristi li MinIO SSL | `.env.coolify`, `docker-compose.yml` (`minio` servis), Coolify `MINIO_USE_SSL` |
| `MINIO_ACCESS_KEY` | `string` | ✅ | MinIO root korisnik (`minioadmin` za dev) | `.env.coolify`, `docker-compose.yml` (`MINIO_ROOT_USER`), Coolify `MINIO_ACCESS_KEY` |
| `MINIO_SECRET_KEY` | `string` | ✅ | MinIO root lozinka (`minioadmin` za dev — PROMIJENITI!) | `.env.coolify` (NE commitovati!), `docker-compose.yml` (`MINIO_ROOT_PASSWORD`), Coolify `MINIO_SECRET_KEY` |
| `MINIO_BUCKET` | `string` | ✅ | Ime bucketa (`gradix`) | `.env.coolify`, `docker-compose.yml`, Coolify `MINIO_BUCKET` |

---

## 5. CORS / Web pristup

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `CORS_ORIGIN` | `string` | ✅ | Dozvoljene domene za CORS (razdvojene zarezom) | `.env.coolify`, `docker-compose.yml` (`backend` servis), Coolify `CORS_ORIGIN` |

> **Primjer za produkciju:** `https://gradix.local,https://app.gradix.local`

---

## 6. Seed / Demo podaci

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `SEED_PASSWORD` | `string` (min 10 znaka) | ✅ (ako se pokreće seed) | Lozinka za seed korisnike (`platform@gradix.local`, `admin@gradix.local`, itd.) | `.env.coolify`, `docker-compose.yml`, Coolify `SEED_PASSWORD` |

> **UPOZORENJE:** `SEED_PASSWORD` mora imati najmanje 10 znakova (`MIN_PASSWORD_LENGTH` u kodu). Promijeniti za produkciju — ne koristiti `GradixSeed1`!

---

## 7. Redis (opcionalno — za buduće BullMQ / queue radnike)

Gradix v1 **ne koristi Redis** (`Nema Redis/BullMQ` u `PLAN_FREEZE.md` i `DECISIONS.md`).

`docker-compose.yml` **ne pokreće** Redis servis — sve `REDIS_*` varijable su
opcione i rezervisane za buduće faze. Ako koristiš eksterni Redis sa TLS-om,
CA certifikat mountaj kroz Coolify Persistent Storage (nema hardkodovanih
host putanja u compose fajlu).

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `REDIS_HOST` | `string` | ❌ | Hostname GLOBALNOG Redis servera (`redis.global`) — NE `redis` servis u compose | `.env.coolify`, Coolify `REDIS_HOST` |
| `REDIS_PORT` | `int` | ❌ | TLS port globalnog Redis (`6379`) | `.env.coolify`, Coolify `REDIS_PORT` |
| `REDIS_PASSWORD` | `string` | ❌ | Redis ACL lozinka | `.env.coolify`, Coolify `REDIS_PASSWORD` |
| `REDIS_TLS_CA_FILE` | `string` | ❌ | Put do TLS CA cert fajla **unutar kontejnera** (ako ga montiraš) | Coolify Persistent Storage |
| `REDIS_PREFIX` | `string` | ❌ | Prefix za Redis ključeve (npr. `gradix:queue:`) | `.env.coolify`, aplikacija (BullMQ `prefix` opcija) |

---

## 8. Frontend (Vite / React) — opcionalno

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `VITE_API_URL` | `string` | ❌ | Apsolutni URL backenda. **Vite ga čita u build fazi** (`docker build --build-arg`), ne u runtime-u. | `frontend/.env`, Coolify *Build Arguments* |
| `BACKEND_URL` | `string` | ❌ | URL backenda za nginx proxy (`/api`, `/socket.io`) — koristi se u runtime-u | `docker-compose.yml` (`frontend` servis), Coolify `BACKEND_URL` |
| ~~`FRONTEND_PORT`~~ | — | — | Uklonjeno: servisi ne objavljuju host portove (Coolify blue/green), koristi se `expose` + Coolify domena | — |

> **Preporučeno:** ostavi `VITE_API_URL` prazno — tada frontend koristi
> relativne `/api` i `/socket.io` pozive, a nginx ih proksira na
> `BACKEND_URL`. Time frontend radi na bilo kojoj domeni bez rebuild-a.
>
> Postavljanje `VITE_API_URL` u **runtime** env (kao ranije) nema efekta —
> vrijednost se „pekuje” u JavaScript bundle pri build-u.

---

## 9. TLS certifikati (Coolify specifično)

`docker-compose.yml` **više ne sadrži** hardkodovane bind mount-e za CA
certifikate: mount na nepostojeću host putanju Docker pretvara u direktorij i
time ruši start kontejnera. TLS se definiše kroz `DATABASE_URL`
(`sslmode=require` / `verify-ca`), a CA fajl — ako je potreban — montiraš
eksplicitno (Coolify → *Persistent Storage*):

| Host put (primjer) | Mapiranje u kontejneru | Svrha |
|---|---|---|
| `/data/coolify/ssl/cert.pem` | `/etc/ssl/certs/coolify-ca.crt:ro` | CA cert za PostgreSQL (`sslmode=verify-ca`) |
| `/data/coolify/ssl/redis-core/redis-ca.crt` | `/etc/ssl/redis/redis-ca.crt:ro` | CA cert za Redis TLS (opciono) |

> Detalji: [`DEPLOYMENT_COOLIFY.md`](./DEPLOYMENT_COOLIFY.md) §4.

---

## 10. Kako definisati u Coolify UI (korak-po-korak)

Kompletno uputstvo (uključujući dvije varijante deploya) je u
[`DEPLOYMENT_COOLIFY.md`](./DEPLOYMENT_COOLIFY.md). Kratka verzija:

1. **Novi resurs → Docker Compose**, `docker-compose.yml` iz root-a repoa.
2. **Environment Variables** (obavezno): `DATABASE_URL`,
   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Preporučeno: `CORS_ORIGIN`,
   `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_IMAGE`.
3. **Domena** → frontend servis, port **80** (nginx).
   Za direktan API pristup (mobilna aplikacija) dodaj domenu na backend,
   port **3000**, i tu domenu unesi u `CORS_ORIGIN`.
4. **Deploy.** Backend pri startu pokreće `prisma migrate deploy`
   (isključivo sa `RUN_MIGRATIONS=false`).
5. **Provjera:** `GET /api/health` na backendu, `GET /` na frontendu
   (oba su definisana kao healthcheck u `Dockerfile`-ovima).

> **VAŽNO:** `DATABASE_URL` i JWT tajne su u compose-u označene sa `:?` —
> ako neka nedostaje, deploy pada odmah sa porukom koja imenuje varijablu.
> To je namjerno: aplikacija ne smije startati sa praznim JWT tajnama.

---

## 11. Promjene u kodu zbog prelaska na PostgreSQL

Ove datoteke su ažurirane (`git diff`):

| Fajl | Promjena | Razlog |
|---|---|---|
| `backend/prisma/schema/foundation.prisma` | `provider = "postgresql"` | Prelazak sa MySQL |
| `backend/src/modules/prisma/prisma.service.ts` | Uklonjen `PrismaMariaDb` adapter; koristi `datasources: { db: { url } }` | PostgreSQL ne treba `adapter-mariadb` |
| `backend/prisma/seed.ts` | Uklonjen `PrismaMariaDb` adapter | Isto kao gore |
| `backend/src/modules/health/health.service.ts` | `mysql` → `postgres` u povratnoj vrijednosti | Tačnost naziva |

### `package.json` / `package-lock.json` (audit 2026-11)

- **Uklonjeno:** `mariadb`, `@prisma/adapter-mariadb`
- **Dodato:** `@prisma/adapter-pg`, `pg`
- **Prebačeno u `dependencies`:** `prisma` (CLI) i `dotenv` — potrebni su u
  produkcijskom kontejneru jer entrypoint pokreće `prisma migrate deploy`,
  a `prisma.config.ts` importa `dotenv`.
- **`package-lock.json` regenerisan** — bio je van sinhronizacije sa
  `package.json`, zbog čega je `npm ci` padao (i u CI-ju i u Docker buildu).

> Produkcijska slika koristi `npm ci --omit=dev`, a build faza
> `npm ci --include=dev` — vidi [`backend/Dockerfile`](./backend/Dockerfile).
