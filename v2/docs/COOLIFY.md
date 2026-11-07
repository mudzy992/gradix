# Gradix v2 — Coolify resource (testna domena gradix.ba101.top)

# KAKO SE KORISTI
#   1. Coolify → Project → Environment → + New Resource → Docker Compose (NIJE Nixpacks!).
#   2. Source: GitHub repo, grana **arena/37e610e9-gradix** (vidi §0 — grana mora imati fix).
#   3. Base Directory: `/v2`
#      Docker Compose Location: `/infra/coolify/docker-compose.yml`
#   4. Environment Variables: iz tabele §1 (samo imena — vrijednosti unosiš ti).
#   5. Domain: `https://gradix.ba101.top` → kontejner port `3000`, TLS on (Let's Encrypt).
#   6. Deploy. Prvi build ~4–6 min (pnpm install + next build + seed bundle).

## 0. Kako Coolify razrješava putanje (ovo je bio prvi pad deploya)

Coolify pokreće build iz **kopije repoa** i postavlja `--project-directory` na Base Directory:

```
docker compose --project-directory /artifacts/<id>/v2 -f /artifacts/<id>/v2/infra/coolify/docker-compose.yml build
```

Zato se `build.context` i `dockerfile` odnose na **Base Directory**, a ne na lokaciju compose fajla.
Uz Base Directory `/v2`:

| Polje | Vrijednost | Razrješava se u |
|---|---|---|
| `context` | `.` | `/artifacts/<id>/v2` — korijen monorepa |
| `dockerfile` | `infra/docker/Dockerfile.web` | `/artifacts/<id>/v2/infra/docker/Dockerfile.web` |

Prva verzija je imala `context: ../..`, što se iz `/artifacts/<id>/v2` razriješilo u `/artifacts`,
pa je build pao sa:

```
Dockerfile not found for service web at ../../infra/docker/Dockerfile.web, skipping ARG injection.
resolve : lstat /artifacts/infra: no such file or directory
```

Ako ikad promijeniš Base Directory, `context` se mijenja s njom — provjeri oba polja zajedno.

**Grana:** Coolify je bio podešen na `v2-bootstrap`. Ta grana i `arena/37e610e9-gradix` su u ovom
trenutku na istom commitu, ali fix iz §0 postoji samo na `arena/37e610e9-gradix`. Postavi granu u
Coolifyju na `arena/37e610e9-gradix` (ili fast-forward `v2-bootstrap` na taj commit), inače se
build ponavlja sa starom greškom.

## 1. Obavezno (bez ovoga deploy pada — namjerno)

| Varijabla | Vrijednost koju unosiš | Napomena |
|---|---|---|
| `DATABASE_URL` | `postgresql://gradix_app:LOZINKA@HOST:5432/gradix?schema=public` | `HOST` = ime Postgres resource-a u Coolifyju na istoj mreži (npr. `postgresql-abc123`) ili `127.0.0.1` ako je host-network. `gradix_app` je ujedno vlasnik šeme (vidi §4). |
| `AUTH_SECRET` | 48+ slučajnih bajtova, base64 | Generiši: `openssl rand -base64 48`. Min 32 znaka. Rotacija odjavljuje sve korisnike. |
| `RUN_MIGRATIONS` | `true` | Prvi deploy `true`; poslije može ostati `true` (idempotentno). |

## 2. Preporučeno

| Varijabla | Vrijednost | Zašto |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` samo dok tražiš grešku. |
| `TRUST_PROXY` | `1` | Coolify je jedan proxy hop; bez ovoga `x-forwarded-for` nije pouzdan. |
| `TZ` | `Europe/Sarajevo` | Datumi u logovima i izvještajima. |
| `PGSSLMODE` | `prefer` | Unutar Coolify mreže TLS nije potreban; `require` ako baza nije na istoj mreži. |
| `SEED_PASSWORD` | jaka lozinka (≥10 znakova) | Samo ako pokrećeš demo seed ručno (vidi §5). Ne ostavljati trajno. |

## 3. Ne treba u Fazi 1

`MINIO_*`, `REDIS_*`, `EXPO_PUBLIC_API_URL` (mobilni se gradi lokalno), `CORS_ORIGIN`
(prazno = same-origin, što je i cilj jer je jedan domen i `/api` na njemu).
Puni spisak sa objašnjenjima: `v2/.env.example`.

## 4. Baza: jedan korisnik je dovoljan (i bezbjedan)

Tvoj setup — baza `gradix` i korisnik `gradix_app` kao vlasnik — **radi ispravno**.
Dokazano na pravoj PostgreSQL instanci, ne tvrdnjom:

* `FORCE ROW LEVEL SECURITY` važi **i za vlasnika tabela**, pa izolacija firmi drži i kad
  `gradix_app` posjeduje šemu (provjereno: bez `app.company_id` → 0 redova; tuđa firma →
  `new row violates row-level security policy`).
* Aplikacija pri prvom upitu provjerava da rola nije `SUPERUSER` i nema `BYPASSRLS`.
  Ako jeste, `/api/ready` i svaki poslovni upit padaju sa `TenantSecurityError`
  (fail-closed) — bolje pasti nego tiho miješati firme.

Zato je dovoljno:

```sql
-- Jednom, kao superuser (Coolify → Postgres → Terminal). NE mijenja lozinku.
ALTER ROLE gradix_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
```

`DATABASE_ADMIN_URL` **ne moraš** postavljati: ako ga nema, entrypoint koristi
`DATABASE_URL` za migracije (vlasnik šeme = `gradix_app`). U modelu sa dvije role
(admin radi migracije, app se samo spaja) ovdje upišeš admin konekciju.

Migrationske skripte same provjeravaju da li rola postoji, pa ne padaju na tuđem setupu.

## 5. Demo podaci (opciono, jednom) — radi iz slike

Seed je u runtime slici kao `seed.mjs` (u build fazi se kompajlira iz `scripts/seed.ts`,
pa runtime ne treba `tsx` ni dev zavisnosti).

Coolify → resource `gradix-web` → **Terminal**:

```sh
cd /app && SEED_PASSWORD='jaka-lozinka' ./seed.sh
```

Skripta je idempotentna (provjereno: dva pokretanja zaredom, isti ishod) i piše tenant tabele
kroz RLS scope, pa radi i kad je `gradix_app` vlasnik šeme. Nalozi: `ured@demo.ba`,
`vlasnik@demo.ba`, `sef@demo.ba` (firma 1) i `vlasnik@druga.ba` (firma 2) — svi sa `SEED_PASSWORD`.

Bez seeda aplikacija radi, ali nema korisnika za prijavu (`/api/auth/login` → 401).

## 6. Provjera poslije deploya

```sh
curl -s https://gradix.ba101.top/api/health   # {"status":"ok"}
curl -s https://gradix.ba101.top/api/ready    # postgres ok, migrations.applied, databaseRole
```

`/api/ready` mora vratiti `"is_super": false, "bypass_rls": false`. Ako vrati `true`,
RLS ne štiti i to se rješava u §4 prije bilo kakve upotrebe.

## 7. Ako padne — šta znači koja poruka

| Poruka | Uzrok | Rješenje |
|---|---|---|
| `Dockerfile not found ... resolve : lstat /artifacts/infra` | `context` nije relativan na Base Directory | `context: .` (§0) |
| `failed to calculate checksum ... /app/apps/web/public: not found` | prazan direktorij nije u gitu | §9 |
| `DATABASE_URL mora biti postavljen u Coolifyju` | varijabla nije unesena u UI | §1 |
| `AUTH_SECRET je prekratak` | manje od 32 znaka | `openssl rand -base64 48` |
| `GREŠKA: baza nije dostupna nakon 10 pokušaja` | pogrešan host/port ili baza nije na istoj mreži | provjeri da je `HOST` ime Postgres resource-a, ne `localhost` |
| `TenantSecurityError: Rola ... je SUPERUSER` | `gradix_app` je superuser | §4, `ALTER ROLE` |
| `permission denied for function auth_memberships` | stara baza bez lookup politika | migracije se primjenjuju same (`RUN_MIGRATIONS=true`) — provjeri log koraka „provjera baze i primjena migracija“ |
| Healthcheck `unhealthy` | kontejner sluša, ali `/api/health` ne vraća 200 | provjeri `PORT`; aplikacija sluša na 3000 |
| `Cannot find module 'argon2'` ili `.node` greška | slika je Alpine, a prebuilt argon2 traži glibc | slika je namjerno `node:22-slim` (§8) |

## 8. Zašto Debian slim, a ne Alpine

`argon2` dolazi sa prebuilt binarijem. Musl varijanta traži `libstdc++.so.6`, kojeg
`node:22-alpine` nema (provjereno čitanjem simbola `.node` fajla). Alpine bi tražio ručnu
instalaciju `libstdc++` u runtime fazi i nosio rizik da se to tiho pokvari pri sljedećem
`apk` sloju. `node:22-slim` ima glibc koji prebuilt očekuje; cijena je ~40 MB veća slika.

## 9. `public/` i prazni direktoriji (drugi pad builda)

```
COPY --from=builder /app/apps/web/public ./apps/web/public
→ failed to calculate checksum ... "/app/apps/web/public": not found
```

Git **ne prati prazne direktorije**. `apps/web/public` je postojao u radnom stablu, ali ne i u
Coolify klon repoa, pa je `COPY` tražio put koji ne postoji. Provjera prije svakog ovakvog
deploya — pusti ovu petlju i vidi ima li `NEMA`:

```sh
cd v2 && for d in apps/web/public packages/db/bootstrap packages/db/prisma/migrations; do
  [ "$(git ls-files "$d" | wc -l)" -gt 0 ] && echo "OK   $d" || echo "NEMA $d"
done
```

Riješeno na dva nivoa: `public/` ima sadržaj (`favicon.png`, `robots.txt`) **i** Dockerfile
radi `RUN mkdir -p apps/web/public` prije kopiranja. Ako neki budući direktorij ostane prazan,
istu grešku će dati i isti lijek je: sadržaj u git ili `mkdir -p` prije `COPY`.

## 10. Dokaz iz klona (kako sam provjerio build bez Dockera)

Build je simuliran **iz `git archive` grane** (dakle iz istog sadržaja koji Coolify klonira),
fazu po fazu: `pnpm install --frozen-lockfile --filter @gradix/web...` → `next build` →
`esbuild` seed → slaganje runtime rasporeda → `entrypoint.sh` sa `RUN_MIGRATIONS=true`.
Rezultat: migracije prošle, `/api/health` 200, `/api/ready` sa `is_super:false`,
`/login` 200, `/favicon.png` 200, `/robots.txt` 200, seed iz slike prošao, prijava 200.
