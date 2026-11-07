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
| `DATABASE_URL` | `postgresql://gradix_app:LOZINKA@HOST:5432/BAZA?sslmode=verify-full&sslrootcert=/etc/ssl/certs/coolify-ca.crt` | `HOST` = **interni** hostname iz Coolify resource-a Postgres (`Connect to Predefined Network`), nikad javni UUID hostname. `BAZA` = tačno ime baze iz tog resource-a (`current_database()`), ne pretpostavka. `&` piši kao `&`, **nikad** `&amp;`. |
| `DATABASE_ADMIN_URL` | isto, samo rola `gradix` | **Obavezno u modelu C** (§4). Bez njega migracije padaju sa „nema CREATE na šemi public“. |
| `AUTH_SECRET` | 48+ slučajnih bajtova, base64 | Generiši: `openssl rand -base64 48`. Min 32 znaka. Rotacija odjavljuje sve korisnike. |
| `RUN_MIGRATIONS` | `true` | Prvi deploy `true`; poslije može ostati `true` (idempotentno). |

## 2. Preporučeno

| Varijabla | Vrijednost | Zašto |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` samo dok tražiš grešku. |
| `TRUST_PROXY` | `1` | Coolify je jedan proxy hop; bez ovoga `x-forwarded-for` nije pouzdan. |
| `TZ` | `Europe/Sarajevo` | Datumi u logovima i izvještajima. |
| `PGSSLMODE` | `verify-full` | Ako je u `DATABASE_URL` već `sslmode=verify-full` + `sslrootcert`, ovo je suvišno ali ne smeta. |
| `POSTGRES_CA_FILE` | `/data/coolify/ssl/coolify-ca.crt` | CA za TLS prema bazi. Compose ga montira na `/etc/ssl/certs/coolify-ca.crt`; ako je na drugom mjestu na hostu, promijeni ovdje. |
| `POSTGRES_CA_MOUNT_CREATE_PATH` | `false` | `false` = deploy padne JASNO ako CA na hostu ne postoji. `true` = Docker tiho napravi prazan direktorij (izbjegni: `pg` onda pada sa ENOENT na `ca`). |

> **Redis CA se NE montira u Fazi 1.** Nijedan dio koda ne čita `REDIS_*`, a mount je
> RUŠIO deploy kad tog fajla nema (`bind source path does not exist`). Vraća se u istom
> commitu u kojem Redis zaista uđe u upotrebu.
| `SEED_PASSWORD` | jaka lozinka (≥10 znakova) | Samo ako pokrećeš demo seed ručno (vidi §5). Ne ostavljati trajno. |

## 3. Ne treba u Fazi 1

`MINIO_*`, `REDIS_*`, `EXPO_PUBLIC_API_URL` (mobilni se gradi lokalno), `CORS_ORIGIN`
(prazno = same-origin, što je i cilj jer je jedan domen i `/api` na njemu).
Puni spisak sa objašnjenjima: `v2/.env.example`.

## 3.5. Mreže: `db_net` i `redis_net` su eksterne (v1 D-021)

Baza i Redis **nisu** na Coolifyjevoj default mreži — žive na postojećim mrežama hosta.
Compose se na njih samo priključuje:

```yaml
networks:
  default:            # Coolifyjev proxy (mora ostati da bi domen radio)
  db_net:
    external: true    # NE kreira se ovdje
```

`redis_net` je priključen (pripremljen za Redis), ali **Redis CA mount NIJE** — vidi §3.6.
Svaka `external` mreža je uslov koji mora biti ispunjen na hostu: ako `redis_net` ne
postoji, deploy pada sa `network redis_net declared as external, but could not be found`.
Zato provjeri obje:

```sh
docker network ls | grep -E "db_net|redis_net"
```

Ako mreža ne postoji, deploy pada sa `network db_net declared as external, but could not
be found`. Provjera na serveru:

```sh
docker network ls | grep db_net
# ako fali:
docker network create db_net 2>/dev/null || true
```

Coolify **ne** priključuje resource na te mreže automatski — zato su navedene u compose-u.
Isto važi za Postgres resource: mora mu biti uključeno `Connect to Predefined Network`
(inače nije na `db_net` i hostname iz `DATABASE_URL` se ne razrješava).

## 3.6. CA: dvije različite putanje (česta zabuna)

Postoje **dvije** putanje i one nisu ista stvar:

| Gdje | Putanja | Šta je |
|---|---|---|
| HOST (server) | `/data/coolify/ssl/coolify-ca.crt` | fajl koji Coolify drži; vrijednost `POSTGRES_CA_FILE` |
| KONTEJNER | `/etc/ssl/certs/coolify-ca.crt` | gdje ga mount čini vidljivim; ovo ide u `DATABASE_URL` |

Ako u `POSTGRES_CA_FILE` upišeš putanju **u kontejneru**, Docker tumači da takav fajl
postoji na hostu i deploy padne (`bind source path does not exist`). Greška je ista ako
upišete obrnuto. Pravilo: **`POSTGRES_CA_FILE` = host, `sslrootcert` = kontejner.**

Ako baza uopšte ne koristi TLS (npr. ista Docker mreža), najjednostavnije je:
`DATABASE_URL` bez `sslrootcert`, sa `sslmode=disable` ili `require`.

## 4. Baza: koja rola radi šta (modeli A / B / C)

Tri postavljanja rade. Razlika je **ko radi migracije**, i to je jedina stvar koju treba
podesiti. Sva tri su provjerena testovima (db 10/10, web 8/8) na pravoj bazi.

| Model | Vlasnik šeme | Aplikacija | `DATABASE_ADMIN_URL` | Kada |
|---|---|---|---|---|
| **C** (tvoj, preporučen) | `gradix` | `gradix_app` | **obavezan** (rola `gradix`) | Coolify gdje je bazu kreirao administrator |
| B | `gradix_app` | `gradix_app` | prazan | kad je `gradix_app` vlasnik baze |
| A | `postgres` (superuser) | `gradix_app` | obavezan | stari lokalni setup |

### Zašto `DATABASE_ADMIN_URL` mora biti `gradix` u modelu C

Migracija kreira tabele i politike — to traži `CREATE` na šemi `public`. U modelu C tu
privilegiju ima **samo vlasnik šeme** (`gradix`). `gradix_app` namjerno NEMA `CREATE`:
aplikacijska rola ne smije sama sebi dodati tabelu bez RLS-a. Ako se `DATABASE_ADMIN_URL`
ostavi prazan, entrypoint to kaže odmah i jasno:

```
GREŠKA: rola koja radi migracije nema CREATE na šemi public.
  Postavi DATABASE_ADMIN_URL na vlasnika šeme (u Coolifyju: konekcija role 'gradix'),
```

U Coolifyju: Postgres resource → **Terminal** → `psql -U gradix -d <baza>` je već otvoren,
pa samo provjeri `\du gradix_app` (mora biti `NOSUPERUSER`, bez `BYPASSRLS`) i
`\dn+ public` (vlasnik `gradix`).

### RLS ostaje na snazi i u modelu C

`FORCE ROW LEVEL SECURITY` važi i za vlasnika tabela, a `gradix_app` nije ni superuser ni
`BYPASSRLS`, pa izolacija firmi drži. Provjera ide pri prvom upitu: ako rola može zaobići
RLS, aplikacija pada sa `TenantSecurityError` (fail-closed) umjesto da tiho miješa firme.
`/api/ready` prijavljuje `is_super`, `bypass_rls` i **`database`** (stvarno ime baze kojoj
je pool spojen) — to je najbrža provjera da URL gleda pravu bazu.

### SQL koji je vlasnik izvršio (ispravan, samo jedna dopuna)

```sql
CREATE ROLE gradix_app WITH LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE gradix TO gradix_app;
GRANT USAGE ON SCHEMA public TO gradix_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gradix IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gradix_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gradix IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gradix_app;
```

Ovo je tačno. Dvije napomene: `GRANT USAGE ON SCHEMA` važi za objekte koji **već** postoje,
`ALTER DEFAULT PRIVILEGES` za one koje `gradix` kreira **poslije** — oba su potrebna, i oba
su gore. `db-apply.sh` ih ionako primjenjuje sam (idempotentno) pri svakom deployu.

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

Očekivani `/api/ready` (primjer, provjeren na modelu C):

```json
{"status":"ok","checks":{"postgres":{"status":"ok","latencyMs":18},
 "migrations":{"applied":5},
 "databaseRole":{"role":"gradix_app","is_super":false,"bypass_rls":false,
                 "database":"gradix","can_create":false}}}
```

Tri stvari koje se čitaju iz ovoga:

* `is_super:false` i `bypass_rls:false` — RLS stvarno štiti (inače §4).
* `database` — **stvarno** ime baze kojoj je pool spojen. Ako piše nešto drugo od očekivanog
  (npr. `postgres` ili generisano ime), `DATABASE_URL` gleda pogrešnu bazu.
* `can_create:false` — očekivano: aplikacijska rola ne kreira tabele, to radi migracija
  kroz `DATABASE_ADMIN_URL`. Ako je `true`, rola ima više prava nego što joj treba.

## 7. Ako padne — šta znači koja poruka

| Poruka | Uzrok | Rješenje |
|---|---|---|
| `Dockerfile not found ... resolve : lstat /artifacts/infra` | `context` nije relativan na Base Directory | `context: .` (§0) |
| `failed to calculate checksum ... /app/apps/web/public: not found` | prazan direktorij nije u gitu | §9 |
| `DATABASE_URL mora biti postavljen u Coolifyju` | varijabla nije unesena u UI | §1 |
| `AUTH_SECRET je prekratak` | manje od 32 znaka | `openssl rand -base64 48` |
| `GREŠKA: baza nije dostupna nakon 10 pokušaja` | host/port, mreža, CA ili `&amp;` u URL-u | poruka sama ispiše host i **zadnju grešku** — gledaj nju: `ENOENT ... coolify-ca.crt` = CA nije montiran (§2), `could not translate host name` = pogrešan/vanjski host, `password authentication failed` = lozinka ili rola |
| `network db_net declared as external, but could not be found` | mreža ne postoji na hostu | §3.5 |
| `psql: error: missing "=" after "→" in connection info string` | dijagnostička poruka je ušla u URL (bug u entrypointu, popravljen) | ažuriraj granu; sve poruke sada idu na stderr |
| `GREŠKA: DATABASE_URL traži CA na '/etc/ssl/certs/coolify-ca.crt', ali tog fajla nema u kontejneru` | CA nije montiran | §2, `POSTGRES_CA_FILE` |
| `GREŠKA: rola koja radi migracije nema CREATE na šemi public` | model C bez `DATABASE_ADMIN_URL` | §4 |
| `GREŠKA: DATABASE_URL sadrži HTML entity `&amp;`` | copy/paste iz HTML-a | zamijeni `&amp;` sa `&` |
| `TenantSecurityError` / `/api/ready` vraća `is_super:true` | rola je superuser ili `BYPASSRLS` | `ALTER ROLE gradix_app NOSUPERUSER NOBYPASSRLS;` |
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
