# Gradix — Kompletna lista environment varijabli (Coolify / PostgreSQL / TLS)

Ovaj dokument opisuje sve `env` varijable potrebne za pokretanje Gradix aplikacije u produkciji (Coolify) nakon prelaska sa MySQL na PostgreSQL i prilagodbe TLS certifikata.

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
| `POSTGRES_DB` | `string` | ✅ | Ime baze (npr. `gradix`) | `.env.coolify`, `docker-compose.yml` (`db` servis), Coolify `POSTGRES_DB` |
| `POSTGRES_USER` | `string` | ✅ | DB korisnik (npr. `gradix_user`) | `.env.coolify`, `docker-compose.yml`, Coolify `POSTGRES_USER` |
| `POSTGRES_PASSWORD` | `string` | ✅ | DB lozinka | `.env.coolify` (NE commitovati u git!), Coolify `POSTGRES_PASSWORD` |
| `DATABASE_URL` | `string` | ✅ | Potpuni PostgreSQL URL sa TLS parametrima | `.env.coolify`, `docker-compose.yml` (`backend` servis `environment`) |

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
| `MINIO_PORT` | `int` | ✅ | Port za API (`9000`) | `.env.coolify`, `docker-compose.yml` (`ports`), Coolify `MINIO_PORT` |
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

Gradix v1 **ne koristi Redis** (`Nema Redis/BullMQ` u `PLAN_FREEZE.md` i `DECISIONS.md`). Međutim, za Coolify kompatibilnost i buduće faze (`Redis geo`, `BullMQ` kada `cron` ne staže), Redis servis je uključen u `docker-compose.yml` sa TLS mapiranjem.

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `REDIS_HOST` | `string` | ❌ (ako nema Redis u v1) | Hostname Redis servera (`redis`) | `.env.coolify`, `docker-compose.yml` (`redis` servis), Coolify `REDIS_HOST` |
| `REDIS_PORT` | `int` | ❌ | TLS port (`6379`) | `.env.coolify`, `docker-compose.yml`, Coolify `REDIS_PORT` |
| `REDIS_PASSWORD` | `string` | ❌ | Redis ACL lozinka | `.env.coolify`, Coolify `REDIS_PASSWORD` |
| `REDIS_TLS_CA_FILE` | `string` | ❌ | Put do TLS CA cert fajla unutar kontejnera | `.env.coolify`, mapiran sa hosta: `/data/coolify/ssl/redis-core/redis-ca.crt` |
| `REDIS_PREFIX` | `string` | ❌ | Prefix za Redis ključeve (npr. `gradix:queue:`) | `.env.coolify`, aplikacija (BullMQ `prefix` opcija) |

---

## 8. Frontend (Vite / React) — opcionalno

| Varijabla | Tip | Obavezno | Opis | Kako definisati |
|---|---|---|---|---|
| `VITE_API_URL` | `string` | ✅ | URL za backend API (za frontend build) | `.env.coolify`, `frontend/.env`, `docker-compose.yml` (`frontend` servis), Coolify `VITE_API_URL` |

> **Primjer:** `http://gradix-backend:3000` (unutar `docker-compose` mreže) ili `https://api.gradix.local` (producija).

---

## 9. TLS certifikati (Coolify specifično)

Ove varijable se ne koriste direktno u aplikaciji kao `process.env`, ali su ključne za `docker-compose.yml` i `Dockerfile`:

| Cert / Put | Mapiranje u kontejneru | Svrha |
|---|---|---|
| `/data/coolify/ssl/coolify-ca.crt` | `/etc/ssl/certs/coolify-ca.crt:ro` | CA cert za PostgreSQL (`sslmode=verify-ca`) |
| `/data/coolify/ssl/redis-core/redis-ca.crt` | `/etc/ssl/redis/redis-ca.crt:ro` | CA cert za Redis TLS (`redis-cli --tls --cacert ...`) |

---

## 10. Kako definisati u Coolify UI (korak-po-korak)

1. **Kreiraj projekat** (`Project`) u Coolify za Gradix.
2. **Dodaj resurs (`Resource`) — PostgreSQL** (ili koristi `docker-compose.yml` sa `db` servisom kao što je gore definisano).
3. **Dodaj `Environment Variables`** za `backend` servis:
   - `DATABASE_URL` — kopiraj iz `.env.coolify` (zamijeni `gradix_user`, `gradix_password` stvarnim lozinkama ili Coolify `DATABASE_URL` ako koristiš Coolify DB resurs).
   - `JWT_ACCESS_SECRET` — generisati (`openssl rand -base64 32`) i unijeti.
   - `JWT_REFRESH_SECRET` — generisati i unijeti.
   - `CORS_ORIGIN` — zamijeni sa stvarnim domenama.
   - `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` — zamijeni sa sigurnim ključevima.
   - `SEED_PASSWORD` — postavi jaku lozinku (min 10 znakova).
4. **Dodaj `Volumes`** za TLS certifikate:
   - `Host: /data/coolify/ssl/coolify-ca.crt` → `Container: /etc/ssl/certs/coolify-ca.crt`
   - `Host: /data/coolify/ssl/redis-core/redis-ca.crt` → `Container: /etc/ssl/redis/redis-ca.crt`
5. **Postavi `Ports`** za `backend`: `3000:3000` (ili `443` ako koristiš proxy / nginx).
6. **Postavi `Depends On`** (`backend` zavisi od `db` i `minio`).
7. **Pokreni deploy** (`Deploy`) i provjeri `Logs` (`docker-compose logs -f backend`).

> **VAŽNO:** Prije prvog deploy-a sa PostgreSQL, potrebno je osigurati da `prisma` migracije postoje za PostgreSQL (`provider = "postgresql"`). Ako prelaziš sa MySQL, pokreni lokalno:
> ```bash
> # 1. Promijeni provider u foundation.prisma
> # 2. Regeneriši migracije (opcionalno — reset za novu bazu)
> cd backend && npx prisma migrate reset --force
> # 3. Pokreni seed (ako želiš demo podatke)
> npx prisma db seed
> # 4. Za produkciju: deployaj sa `prisma migrate deploy`
> #    (u Dockerfile: `npx prisma migrate deploy && node dist/main`)
> ```

---

## 11. Promjene u kodu zbog prelaska na PostgreSQL

Ove datoteke su ažurirane (`git diff`):

| Fajl | Promjena | Razlog |
|---|---|---|
| `backend/prisma/schema/foundation.prisma` | `provider = "postgresql"` | Prelazak sa MySQL |
| `backend/src/modules/prisma/prisma.service.ts` | Uklonjen `PrismaMariaDb` adapter; koristi `datasources: { db: { url } }` | PostgreSQL ne treba `adapter-mariadb` |
| `backend/prisma/seed.ts` | Uklonjen `PrismaMariaDb` adapter | Isto kao gore |
| `backend/src/modules/health/health.service.ts` | `mysql` → `postgres` u povratnoj vrijednosti | Tačnost naziva |

### Potrebne promjene u `package.json` (nije automatski primijenjeno zbog `package-lock.json`):

- **Ukloniti:** `mariadb`, `@prisma/adapter-mariadb`
- **Dodati (opcionalno):** `pg` (za direktne PostgreSQL upite — nije obavezno za Prisma 7, ali preporučeno za neke nestandardne operacije)

> **NAPOMENA:** Zbog nedostatka `node_modules` u sandboxu, `npm install` nije pokrenut. Prije produkcijskog `docker build`-a, potrebno je pokrenuti `npm ci` (ili `npm install`) u `backend` direktoriju da bi se primijenile nove zavisnosti.
