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
| `DATABASE_ADMIN_URL` | konekcija vlasnika šeme/migratora, odvojena od `DATABASE_URL` | Obavezno kad je `RUN_MIGRATIONS=true`; ne koristi se za aplikacijske upite. |
| `AUTH_SECRET` | 48+ slučajnih bajtova, base64 | Generiši: `openssl rand -base64 48`. Min 32 znaka. Rotacija odjavljuje sve korisnike. |
| `RUN_MIGRATIONS` | `true` | Prvi deploy `true`; poslije može ostati `true` (idempotentno). |

## 2. Preporučeno i staging servisi

| Varijabla | Vrijednost | Zašto |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` samo dok tražiš grešku. |
| `TRUST_PROXY` | `1` | Coolify je jedan proxy hop; bez ovoga `x-forwarded-for` nije pouzdan. |
| `TZ` | `Europe/Sarajevo` | Datumi u logovima i izvještajima. |
| `PGSSLMODE` | `verify-full` | Ako je u `DATABASE_URL` već `sslmode=verify-full` + `sslrootcert`, ovo je suvišno ali ne smeta. |
| `POSTGRES_CA_FILE` | `/data/coolify/ssl/coolify-ca.crt` | CA za TLS prema bazi. Compose ga montira na `/etc/ssl/certs/coolify-ca.crt`; ako je na drugom mjestu na hostu, promijeni ovdje. |
| `POSTGRES_CA_MOUNT_CREATE_PATH` | `false` | `false` = deploy padne jasno ako CA na hostu ne postoji. |
| Redis dijagnostika (fiksno u Compose) | `redis-core:6380`, user `gradix_v2`, prefix `gradix:stg:`, CA `/run/secrets/redis-ca.crt` | Host, port, ACL user, prefix i CA putanja se ne override-uju preko Coolify env-a. Redis nije runtime zavisnost aplikacije. |
| `REDIS_PASSWORD` | postojeća lozinka za `gradix_v2` kao Coolify secret | Jedina promjenljiva Redis postavka; potrebna za AUTH/probe. Ako nije unesena, autentifikovani Redis test se preskače — ne šalju se neautentifikovane komande. Nikad ne stavljati lozinku u repo ili log. |
| `MINIO_ENDPOINT` | `http://minio:9000` | Fiksni interni Compose DNS za server-side S3; ne dodavati Coolify override. |
| `MINIO_BUCKET` / `MINIO_REGION` | `gradix-stg` / `us-east-1` | Fiksni staging bucket i region; ne dodavati Coolify override. Init kreira bucket i bucket-scoped app policy. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO server admin secrets | Oba su obavezna Coolify secrets; Compose odbija prazne vrijednosti umjesto da MinIO krene sa `minioadmin:minioadmin`. Identični su samo na MinIO serveru i `minio-init`, ne u web appu. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | zaseban staging app user | Access key mora imati najmanje 3 znaka i razlikovati se od `MINIO_ROOT_USER`; secret najmanje 8 znakova. App-only creds za web i `minio-init`; ne postavljati ih na MinIO server. Ukloni stare server-side varijable istih naziva iz Coolify MinIO servisa. |
| `MINIO_CORS_ALLOWED_ORIGIN` | tačan web origin, npr. `https://gradix.ba101.top` | Compose ga postavlja kao MinIO server-wide `MINIO_API_CORS_ALLOW_ORIGIN`; nije bucket CORS. Bez patha i završnog `/`. |
| `SERVICE_FQDN_MINIO`, `SERVICE_FQDN_MINIO_9000` | Coolify-managed magic varijable za MinIO servis | API ruta ostaje na portu `9000`. |
| `SERVICE_FQDN_MINIO_CONSOLE_PROXY` | Coolify-managed magic varijabla za proxy servis | Console hostname se veže na `minio-console-proxy`, čiji jedini javni port za Coolify je `8080`; proxy prosljeđuje interno na MinIO `9001`. |
| `MINIO_BROWSER_REDIRECT_URL` | `https://minio-console.gradix.ba101.top` | Javni HTTPS redirect URL za Console; isti hostname kao Coolify domain na `minio-console-proxy`. |
| `SEED_PASSWORD` | jaka lozinka (≥10 znakova) | Samo za ručni demo seed (vidi §5). Ne ostavljati trajno. |

### 1.1. Tačna tabela varijabli (čišćenje Coolifyja radi se po ovoj tabeli)

Legenda: **F** = fiksirano u Compose-u (ne unositi u Coolify env), **S** = Coolify tajna koju
unosi operator, **M** = mora biti postavljena (može i nejavna vrijednost), **X** = ne smije
postojati u Coolify env-u.

| Varijabla | Vrsta | Gdje / napomena |
|---|---|---|
| `DATABASE_URL` | S, M | Coolify secret; aplikacijska rola `gradix_app` |
| `DATABASE_ADMIN_URL` | S, M kad je `RUN_MIGRATIONS=true` | Coolify secret; entrypoint je **briše iz okruženja procesa** poslije migracija |
| `AUTH_SECRET` | S, M | ≥32 znaka |
| `AUTH_LOGIN_LIMIT` | M (default iz koda 5) | 1–50; aplikacija odbija start izvan raspona |
| `AUTH_LOGIN_WINDOW_MS` | M (default iz koda 60000) | **milisekunde**, 10000–3600000; `5` je greška i aplikacija neće startati |
| `RUN_MIGRATIONS` | M | `true` na stagingu |
| `NODE_ENV` | F | `production` u Compose-u |
| `PORT` | F | `3000` u Compose-u |
| `HOSTNAME` | F | `0.0.0.0` u Compose-u |
| `LOG_LEVEL` | M | `info` (Coolify default iz Compose-a) |
| `TRUST_PROXY` | M | `1` (jedan Coolify proxy hop) |
| `TZ` | M | `Europe/Sarajevo` |
| `PGSSLMODE` | M | `verify-full` |
| `POSTGRES_CA_FILE` | M | host putanja CA; Compose je montira u kontejner |
| `MINIO_ENDPOINT` | F | `http://minio:9000` |
| `MINIO_BUCKET` | podesiva (default `gradix-stg`) | ne smije biti `gradix` (v1); aplikacija odbija start inače |
| `MINIO_REGION` | podesiva (default `us-east-1`) | |
| `MINIO_PUBLIC_ENDPOINT` | S, M za priloge | javni HTTPS S3 API hostname (port 9000) |
| `MINIO_CORS_ALLOWED_ORIGIN` | M | tačan web origin, npr. `https://gradix.ba101.top` |
| `MINIO_ACCESS_KEY` | S, M | app-only, **≥20 znakova**, različit od `MINIO_ROOT_USER` |
| `MINIO_SECRET_KEY` | S, M | app-only, **≥32 znaka** |
| `MINIO_ROOT_USER` | S, M | samo `minio` i `minio-init` servisi; nikad web |
| `MINIO_ROOT_PASSWORD` | S, M | samo `minio` i `minio-init` servisi; nikad web |
| `MINIO_BROWSER_REDIRECT_URL` | M | `https://minio-console.gradix.ba101.top` |
| `SERVICE_FQDN_MINIO`, `SERVICE_FQDN_MINIO_9000` | F (Coolify magic) | upravlja Coolify, ne upisivati ručno |
| `SERVICE_FQDN_MINIO_CONSOLE_PROXY` | F (Coolify magic) | upravlja Coolify, ne upisivati ručno |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_USER` / `REDIS_PREFIX` / `REDIS_TLS_CA_FILE` | podesive (zadane vrijednosti u Compose-u) | `redis-core` / `6380` / `gradix_v2` / `gradix:stg:` / `/run/secrets/redis-ca.crt`; `REDIS_PREFIX` mora počinjati sa `gradix:` i ne smije biti v1 prefiks `gradix:` — aplikacija odbija start s jasnom porukom. Korisnik nije hard-kodiran u kodu, samo je zadana Compose vrijednost |
| `REDIS_PASSWORD` | S | jedina Redis tajna; postojeća ACL lozinka za `gradix_v2` |
| `SEED_DEMO` | podesiva (default `false`) | kad je `false` i demo firma postoji, preflight samo upozorava (nikad ne briše) |
| `SEED_PASSWORD` | S, privremeno | samo za ručni seed (§5); poslije ukloniti. Entrypoint je briše iz okruženja procesa |
| `REDIS_CA_FILE` | **X** | uklonjen; jedini CA env je `REDIS_TLS_CA_FILE` |
| `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_DATA_DIR` | **X** | naslijeđeni v1 nazivi; Compose ih ne čita |
| `EXPO_PUBLIC_API_URL` | nije Coolify web varijabla | **build-time za mobilnu aplikaciju**: pripada `apps/mobile/.env` odnosno EAS build okruženju, ne web kontejneru |

MinIO server je dio ovog Compose stacka i koristi sliku `ghcr.io/coollabsio/minio:latest`.
Njegov `/data` je read/write bind na tačnu host putanju `/mnt/shared-app-files/gradix-v2/minio`;
Compose traži da direktorij već postoji (`create_host_path: false`) kako ne bi tiho pokrenuo prazan
storage. Prije deploya pripremi host direktorij i prava za MinIO kontejner. Ako stari deploy koristi
named volume `gradix-stg-minio-data`, prvo kopiraj i provjeri postojeće podatke u novu putanju;
volume se ovim ne briše, ali novi Compose ga više ne koristi — ne uklanjati ga dok migracija nije
provjerena. MinIO koristi unutrašnji DNS `minio`, staging bucket `gradix-stg` i odvojene root/app
ključeve. Putanja `/data` je fiksna u Composeu, nije env varijabla. `minio-init` se gradi iz
`infra/minio/Dockerfile.init`: taj image koristi zvanični Quay image
`quay.io/minio/aistor/mc:RELEASE.2025-12-19T20-11-44Z`, kopira init skriptu i policy u image i
postavlja `/bin/bash /init.sh` kao image entrypoint. Ovo izbjegava nedostupan Docker Hub `minio/mc`
i 403 za GHCR mirror, a bash entrypoint sprečava da `mc` protumači `/bin/sh` kao svoju komandu.
Compose ne postavlja runtime `entrypoint` override. Ukloni eventualni Command/Entrypoint override sa
`minio-init` servisa u Coolify UI, kako bi se sačuvao image entrypoint. Ovaj MinIO server build
bucket `PutBucketCors` API vraća kao `NotImplemented`, zato `mc cors set` nije dio bootstrap-a;
Compose podešava server-wide CORS kroz `MINIO_API_CORS_ALLOW_ORIGIN`. MinIO i Redis nisu uslov za
podizanje v2 aplikacije; njihova nedostupnost prikazuje se u opcionalnoj dijagnostici, ali ne preskače
niti mijenja PostgreSQL preflight.

### 2.1. Uključivanje priloga i browser URL-ova

1. Zadrži postojeći javni HTTPS S3 API domain na Compose servisu `minio`, port `9000` (npr.
   `https://minio.gradix.ba101.top`). **Ne** mijenjaj postojeći API host da pokazuje na Console.
2. U Coolify → service `minio-console-proxy` → **Domains** dodaj
   `https://minio-console.gradix.ba101.top`. Koristi njegov port `8080` (jedini expose port); ne
   pokušavaj postaviti `9001` u Coolifyju. Proxy sluša na `8080` i prosljeđuje zahtjeve interno na
   `minio:9001`, pa Coolify više ne mora održavati port override za Console. DNS za oba hosta mora
   voditi na Coolify proxy, a oba Coolify domaina moraju imati TLS. Uključi i `HTTP → HTTPS` za
   Console domain; ako ispred Coolifyja imaš još jedan proxy/CDN, koristi HTTPS do origin-a, ne
   `Flexible` režim.
3. Postavi `MINIO_BROWSER_REDIRECT_URL` na `https://minio-console.gradix.ba101.top` bez patha,
   završnog `/` ili porta. Postavi `MINIO_PUBLIC_ENDPOINT` u web servis na HTTPS S3 API hostname
   (port `9000`), bez patha/query-a. Web storage koristi `MINIO_ENDPOINT=http://minio:9000` za
   server-side I/O i odvojeni public signer za browser URL-ove; u produkciji interni hostname ili
   HTTP public URL odbija storage config.
4. Console je namjerno javno routable uz **MinIO native login only**; nema dodatnog IP allowlist,
   VPN ili SSO/access-gateway sloja. Koristi snažne, jedinstvene `MINIO_ROOT_USER`/
   `MINIO_ROOT_PASSWORD` Coolify secrets za Console login. Te root tajne pripadaju samo MinIO
   serveru i `minio-init`; `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` su odvojene app-only tajne za web i
   `minio-init`. Init skripta idempotentno napravi `gradix-stg` i bucket-scoped app policy; MinIO
   server CORS allowlist se podesi globalno iz `MINIO_CORS_ALLOWED_ORIGIN`.
5. Sačekaj `phase=s3.browser_cors status=PASS` u app logu: probe koristi presigned PUT/GET kroz
   S3 API hostname, provjerava CORS i `Content-Disposition: inline`, pa briše testni objekat. Ako
   API endpoint/CORS/policy nije spreman, prilozi ostaju isključeni umjesto da browser dobije
   interni `minio` URL.

`MINIO_PUBLIC_ENDPOINT` mora biti javni HTTPS S3 API hostname (port 9000), ne interni
`http://minio:9000`; to je odvojen endpoint od web origin-a u `MINIO_CORS_ALLOWED_ORIGIN` i od
Console URL-a na portu 9001. `MINIO_BROWSER_REDIRECT_URL` mora pokazivati samo na Console hostname.
Dijagnostika potvrđuje javni S3 API endpoint (HTTPS, ne-local hostname) i njegov odgovor; ne
zamjenjuje završni test otvaranja Consolea i browser priloga nakon deploya.

### 2.2. Redis ACL koji dijagnostika traži (Redis se ne koristi u aplikaciji)

Aplikacija Redis uopšte ne koristi (rate limit prijave je PostgreSQL); dijagnostika je
informativna i ništa ne blokira. Da `redis.auth_rw` bude PASS, ACL korisnik `gradix_v2` treba:

- ključ-obrazac: `~gradix:stg:*` (dijagnostika piše isključivo pod `gradix:stg:diag:`),
- komande: `+ping +set +get +del +pttl` (dijagnostika koristi i `expire` obrazac kroz
  `SET ... PX`, pa gdje ACL to razdvaja dodati i `+expire`),
- AUTH sa korisnikom i lozinkom preko TLS-a (port 6380, CA po §3.6).

Dijagnostika u `redis.auth_rw` ispisuje sanitizovano ime Redis greške (npr. `WRONGPASS`,
`NOPERM`), komandu koja je pala (`failed_command`) i `key_pattern` — bez lozinke i bez
vrijednosti ključeva. Audit postojećeg korisnika: `v2/infra/redis/acl-v2.txt`.

### 2.3. Čišćenje probnih objekata dijagnostike u bucketu

Dijagnostika svoj probni objekat briše u `finally` bloku i na kraju runa (`phase=s3.cleanup`).
Ako je stari run (prije ove popravke) ostavio objekte pod prefiksom `gradix:diag/` u bucketu
`gradix-stg`, uklanjaju se jednom naredbom sa hosta koji ima `mc` i app/root kredencijale:

```sh
mc alias set stg http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc rm --recursive --force "stg/gradix-stg/gradix:diag/"
```

## 3. Nepotrebno za v2 staging

`EXPO_PUBLIC_API_URL` se postavlja samo u `apps/mobile/.env.example`; `CORS_ORIGIN` je naslijeđeni
v1 naziv. Ukloni stare/ručne override vrijednosti za `MINIO_ENDPOINT`, `MINIO_BUCKET`,
`MINIO_REGION`, `MINIO_PORT`, `MINIO_USE_SSL` i `MINIO_DATA_DIR` — staging Compose fiksira interni
endpoint, bucket, region i `/data` bind. Ne dodavati ni override za `REDIS_HOST`, `REDIS_PORT`,
`REDIS_USER`, `REDIS_PREFIX` ili `REDIS_TLS_CA_FILE` — Compose ih fiksira prema postojećem ACL-u.
Ukloniti i stari `REDIS_CA_FILE`; jedini Redis CA env je interni, fiksni `REDIS_TLS_CA_FILE`.
Popis varijabli koje operator stvarno unosi je u `v2/.env.example`.

## 3.5. Mreže: `db_net` i `redis_net` su eksterne, MinIO je isti stack

Postgres i staging Redis su postojeći infrastrukturni servisi na `db_net` i `redis_net`.
Compose ih **ne kreira**; web se samo priključuje. MinIO je drugačiji: `web`, `minio` i
`minio-init` dijele Coolifyjev Compose `default` network, pa aplikacija koristi isti-stack DNS
`http://minio:9000`. MinIO se ne spaja na v1 mrežu ni v1 storage.

```yaml
networks:
  default:            # Coolify stack/proxy + web/minio same-stack DNS
  db_net:
    external: true    # postojeći Postgres
  redis_net:
    external: true    # postojeći Redis
```

Ako `db_net` ili `redis_net` ne postoji, deploy pada sa `network ... declared as external, but
could not be found`. Provjeri obje prije deploya:

```sh
docker network ls | grep -E "db_net|redis_net"
```

Ako mreža ne postoji, kreiraj je tek nakon što potvrdiš da Postgres/Redis resursi koriste baš tu
mrežu. Coolify **ne** priključuje resource na te mreže automatski. Postgres resource mora imati
`Connect to Predefined Network` uključen i biti na `db_net`; Redis mora biti dostupan webu kroz
`redis_net` ako želiš da opcionalna dijagnostika do njega dođe.

Za javne priloge zadrži Coolify route za postojeći S3 API hostname na `minio:9000`. Dodaj
`minio-console.gradix.ba101.top` u Coolify Domains na zasebnom servisu `minio-console-proxy`, koji
sluša na `8080` i interno prosljeđuje na `minio:9001`; nema Coolify port overridea na MinIO servisu.
`MINIO_PUBLIC_ENDPOINT` je javni HTTPS API hostname, a `MINIO_BROWSER_REDIRECT_URL` Console HTTPS
hostname. `MINIO_ENDPOINT` ostaje interni `http://minio:9000`; nikad ne zamjenjuj taj interni
endpoint javnim za server-side operacije. Datoteke `infra/minio/init-staging.sh` i
`staging-policy.json` mountaju se u odnosu na Base/Project Directory `/v2`.

## 3.6. CA putanje

Postgres i Redis CA su dva odvojena certifikata i mounta:

| Namjena | HOST putanja | KONTEJNER putanja / varijabla |
|---|---|---|
| Postgres TLS | `/data/coolify/ssl/coolify-ca.crt` (`POSTGRES_CA_FILE`) | `/etc/ssl/certs/coolify-ca.crt`; ova putanja ide u `DATABASE_URL` kao `sslrootcert=` |
| Redis TLS | `/data/coolify/ssl/redis-core/redis-ca.crt` | `/run/secrets/redis-ca.crt`; `REDIS_TLS_CA_FILE` je fiksiran na ovu putanju |

Za Postgres je `POSTGRES_CA_FILE` host putanja, dok `sslrootcert` pokazuje unutar kontejnera. Redis
koristi direktan, read-only file bind:
`/data/coolify/ssl/redis-core/redis-ca.crt` → `/run/secrets/redis-ca.crt`. `create_host_path: false`
zahtijeva da host fajl postoji; provjeri da je certifikat čitljiv UID-u aplikacije (1001). Web image
unaprijed kreira direktorij `/run/secrets`, a `REDIS_TLS_CA_FILE` je fiksiran na bind target. Ako je
CA pogrešan ili neispravan, TLS probe pada; verifikacija je i dalje uključena (`rejectUnauthorized:
true`) i ne smije se isključivati radi zaobilaženja certifikata.

Ne postavljati `REDIS_CA_FILE` niti override `REDIS_TLS_CA_FILE`. Ako Postgres uopšte ne koristi TLS
(npr. ista Docker mreža), može se izostaviti `sslrootcert` uz `sslmode=disable` ili `require`.

## 4. Baza: odvojena rola aplikacije i migratora

Za deploy se koriste dvije različite konekcije:

| Konekcija | Namjena | Obavezne osobine |
|---|---|---|
| `DATABASE_URL` | aplikacijski upiti | `gradix_app`; nije vlasnik nijedne tabele; nije superuser; nema `BYPASSRLS` |
| `DATABASE_ADMIN_URL` | bootstrap i migracije | vlasnik šeme/objekata ili druga administratorska rola sa svim potrebnim bootstrap, DDL i grant pravima; koristi se samo kad `RUN_MIGRATIONS=true` |

`RUN_MIGRATIONS=true` traži `DATABASE_ADMIN_URL`; entrypoint ne koristi aplikacijsku rolu kao
rezervni migrator. Ako se migracije izvršavaju izvan kontejnera, postavi `RUN_MIGRATIONS=false`;
preflight se i dalje izvršava kao `DATABASE_URL` prije starta web procesa.

**Model u kojem je `gradix_app` vlasnik tabela nije podržan za deploy.** `FORCE ROW LEVEL SECURITY`
ne mijenja pravilo: runtime preflight namjerno pada ako je aplikacijska rola vlasnik, superuser,
ima `BYPASSRLS`, ili može preuzeti vlasničku rolu. Administratorska konekcija može biti superuser;
ona se ne koristi za aplikacijske upite.

Poslije migracija, `infra/docker/entrypoint-web.sh` poziva `packages/db/preflight-checks/run.sh`
**kroz `DATABASE_URL`**, a zatim tek pokreće server. Isti kritični DB preflight se vrti u CI-ju
pod `gradix_app`. RLS, scope, privilegije ili nebezbjedna aplikacijska rola zaustavljaju start;
preflight provjerava sve javne tabele/sekvence prema `packages/db/preflight-checks/privilege-matrix.tsv`,
RLS politike, višak/manjak efektivnih prava i kontrolisane SECURITY DEFINER funkcije.

Tek nakon uspješnog DB preflighta, entrypoint pokreće `node /app/diagnostics/run.mjs` u pozadini.
Ova Redis/S3 dijagnostika je best-effort, ne mijenja exit code preflighta i ne blokira web `Ready`;
svaka faza ima timeout, ukupni budžet je manji od 10 sekundi. Izvještava Redis config/prefix,
DNS/TCP/TLS, CA/ACL/PING/prefiksirani SET/PTTL/GET/DEL i MinIO DNS/TCP/TLS, app kredencijale,
bucket/object read-write-delete, browser presigned PUT/GET, CORS i inline display headers.
Tajne i potpisani URL-ovi se nikad ne ispisuju. Redis trenutno ne koristi application code:
rate limit prijave je PostgreSQL funkcijama i DB greška odbija prijavu (fail-closed), pa je Redis
outage policy za app „not applicable“. Redis/S3 dijagnostički `FAIL` sam po sebi nikad ne obara deploy.

Migrator mora imati `CREATE` na šemi `public` i potrebna prava za migracije/ekstenziju. Uobičajeni
Coolify setup je odvojena rola `gradix` kao `DATABASE_ADMIN_URL` i `gradix_app` kao
`DATABASE_URL`. `db-apply.sh` je idempotentan; `grants.sql` prvo skida stare široke ACL/default
privilegije, pa dodaje samo `needed` prava iz matrice. Aplikacijska rola nema pristup
`schema_migrations`, `platform_users` ili `login_attempts`/njegovoj sekvenci. `users` i `companies`
su pod posebnim RLS pravilima za tenant, login i pozivnicu; procjenu i rollback vidi ADR 0013.

## 5. Demo podaci (opciono, jednom) — radi iz slike

Seed je u runtime slici kao `seed.mjs` (u build fazi se kompajlira iz `scripts/seed.ts`,
pa runtime ne treba `tsx` ni dev zavisnosti).

Coolify → resource `gradix-web` → **Terminal**:

```sh
cd /app && SEED_PASSWORD='jaka-lozinka' ./seed.sh
```

Skripta je idempotentna (provjereno: dva pokretanja zaredom, isti ishod) i piše tenant tabele
kroz tenant scope, pa aplikacijska rola ne treba biti vlasnik šeme. Nalozi: `ured@demo.ba`,
`vlasnik@demo.ba`, `sef@demo.ba` (firma 1) i `vlasnik@druga.test` (firma 2) — svi sa `SEED_PASSWORD`.

Bez seeda aplikacija radi, ali nema korisnika za prijavu (`/api/auth/login` → 401).

### 5.1. SEED_DEMO — uklanjanje demo firme (implementirano)

- Seed radi samo ručno (§5). Varijabla `SEED_DEMO` (default `false`) govori da je demo
  očekivan; kad je `SEED_DEMO=false`, a firma `niskogradnja-demo` postoji u bazi,
  entrypoint pri startu ispisuje **upozorenje i ništa ne briše**.
- Uklanjanje je eksplicitna naredba u jednoj transakciji i traži doslovnu potvrdu slug-a:

```sh
DATABASE_ADMIN_URL=... REMOVE_DEMO_CONFIRM=niskogradnja-demo \
  pnpm --filter @gradix/web exec tsx scripts/remove-demo.ts
```

Bez `REMOVE_DEMO_CONFIRM=niskogradnja-demo` skripta staje prije bilo kakve izmjene.
Briše sve redove demo firme (tenant tabele se otkrivaju iz kataloga), samu firmu i demo
korisnike (`@demo.ba`) koji ne pripadaju nijednoj drugoj firmi — sve ili ništa.

### 5.2. Novi demo sukobi (kad se postojeći razriješe)

Razriješen sukob se ne može vratiti na OPEN (guard nepromjenjivosti u bazi to
brani i tako mora ostati). Kad demo sukobi „potroše" razrješenja, novi se
prave administratorskom naredbom — postojeći se ne diraju. Naredba radi
samo za demo firmu (slug `niskogradnja-demo`) i staje prije ikakvog upisa
za svaku drugu firmu (pokriveno testom). Pravi 3 nova sukoba: preklopljen
unos radnika i šefa, unos s odstupanjem sata telefona i jedan stariji od
praga podsjetnika firme:

```sh
DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/demo-sukobi.ts
```

### 5.3. Demo podaci iz fajlova (radnici, mašine, rokovi)

Demo firmu puni sintetičkim podacima iz `v2/docs/demo-podaci/`
(`radnici-popunjeno.xlsx`, `masine-popunjeno.xlsx`, `rokovi-popunjeno.xlsx`;
izmišljeni podaci). Radnici i mašine idu kroz isti servis kao Uvoz iz
aplikacije (isto pravilo duplikata: radnik = ime+prezime ili telefon;
mašina = inventarska oznaka), rokovi postaju obaveze s verzijama povezane
po oznaci mašine, imenu radnika ili šifri projekta — nepovezivo se
prijavljuje i preskače. Datumi rokova (sidro 12. 11. 2026) pomjeraju se
prema današnjem danu. Naredba je idempotentna i radi samo za demo firmu;
baza se otvara aplikacijskom rolom (`DATABASE_URL`, servis uvoza se oslanja
na RLS), a administratorska služi samo da se demo firma pronađe po slug-u:

```sh
DATABASE_ADMIN_URL=... DATABASE_URL=... \
  pnpm --filter @gradix/web exec tsx scripts/seed-demo-podaci.ts
```

## 11. Retencija podataka (razvojne pretpostavke)

> Ovo su razvojne pretpostavke, **ne pravno mišljenje**. Prije produkcije
> ih potvrđuje pravnik ili računovođa. Gdje ima smisla, rok je postavka
> firme (npr. `companies.conflict_reminder_days` za podsjetnik i
> `sync_conflict_retention_days` za payload sukoba već postoje); ostalo su
> konstante u administratorskim naredbama dok se ne pokaže potreba za
> postavkom.

| Podatak | Rok | Stanje |
|---|---|---|
| Sesije, pokušaji prijave, istekli tokeni pozivnica i resetovanja | brisanje 30 dana nakon isteka | naredba `scripts/retention-cleanup.ts` (ispod) |
| Tombstone i sync change log | 90 dana | kako je implementirano u sync sloju |
| Originalni payload razriješenog sukoba | razrješenje + 90 dana; odluka i razlog ostaju | kako je implementirano (guard + purge) |
| Audit trag | 24 mjeseca | čuva se; čišćenje nije implementirano |
| Radni dani, sati i ispravke | 10 godina | čuva se; čišćenje nije implementirano |
| Lični podaci radnika koji je otišao | anonimizacija umjesto brisanja, razvojno 5 godina nakon prestanka; historija sati ostaje cjelovita | samo dizajn (ispod), bez implementacije |
| Prilozi (skenovi isprava) | dok obaveza traje + 5 godina; ljekarski nalazi se ne čuvaju, samo datum isteka | čuva se; čišćenje nije implementirano |
| Sigurnosne kopije | 30 dana dnevne, 12 mjesečnih | operativna postavka backup posla (C.2, čeka odobrenje) |
| Projektna dokumentacija | do kraja garantnog roka + dogovoreni period | čuva se; čišćenje nije implementirano |

Tehničko čišćenje bez ličnih podataka (sesije, pokušaji prijave, istekli
tokeni) radi se administratorskom naredbom, pod administratorskom rolom
baze, nikad iz aplikacije i nikad automatski. Podrazumijevano je dry-run:

```sh
<!-- Tačan popis tabela koje naredba smije dirati: sessions, login_attempts,
     invitations, password_resets. Popis je izvezen kao RETENTION_TABLES iz
     scripts/retention-cleanup.ts i test retention.integration.test.ts ga
     provjerava statički (izvor naredbe) i ponašanjem (poslovne tabele
     netaknute prije/poslije --primijeni). -->
DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/retention-cleanup.ts --dry-run
DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/retention-cleanup.ts --primijeni
```

**Anonimizacija radnika (samo dizajn, nije implementirano).** Kad prođe
rok nakon prestanka radnog odnosa: ime i prezime zamjenjuju se oznakom
(npr. „Bivši radnik #<id>"), telefon/email/napomene s ličnim podacima se
brišu, veza na korisnički nalog se uklanja; red radnika, radni dani, sati,
ispravke i obaveze ostaju, da historija sati i obračuna ostane cjelovita.
Anonimizacija bi bila administratorska naredba s dry-run izvještajem,
jedna transakcija po radniku i zapis u audit trag (bez ličnih podataka u
zapisu). Čeka zasebno odobrenje i pravnu potvrdu roka.

## 6. Provjera poslije deploya

```sh
curl -s https://gradix.ba101.top/api/health   # {"status":"ok"}
curl -s https://gradix.ba101.top/api/ready    # postgres ok, databaseRole (no schema_migrations access)
```

Očekivani `/api/ready` (primjer; stvarne provjere role/RLS/prava odradi interni preflight):

```json
{"status":"ok","checks":{"postgres":{"status":"ok","latencyMs":18},
 "databaseRole":{"role":"gradix_app","is_super":false,"bypass_rls":false,
                 "database":"gradix","can_create":false}}}
```

Opcionalnu dijagnostiku možeš pokrenuti ručno i bez web restarta:

```sh
cd /app && node ./diagnostics/run.mjs
```

Svaki red ima `phase=... status=PASS|FAIL|SKIP cause=... action=...`. Dijagnostika ne emituje
lozinke, ključeve, tokene ni signed URL-ove. Redis/S3 faze nisu `/api/ready` gate; `Ready` i
PostgreSQL preflight ostaju kriteriji za app podizanje.

**R4a-1 staging mini-gate nakon scoped push/pull API koraka 5:** deploy staging sa ovom granom,
sačekaj da app log izričito kaže `Ready`, pa zalijepi ovdje cijeli DB preflight izlaz i sve
`phase=redis...` / `phase=s3...` dijagnostičke redove. Pregled se radi prije koraka 6 (SQLite
migracija/outbox); ne nastavljati korak 6 dok Ready i logovi nisu pregledani i staging stanje
potvrđeno. `s3.browser_cors` mora biti `PASS` prije tvrdnje da browser prilozi rade.

Tri stvari koje se čitaju iz ovoga:

* `is_super:false` i `bypass_rls:false` — osnovni atributi role. **Vlasništvo tabela i RLS politike** provjerava interni preflight prije starta; `/api/ready` ih ne zamjenjuje.
* `database` — **stvarno** ime baze kojoj je pool spojen. Ako piše nešto drugo od očekivanog
  (npr. `postgres` ili generisano ime), `DATABASE_URL` gleda pogrešnu bazu.
* `can_create:false` — očekivano: aplikacijska rola ne kreira tabele, to radi migracija
  kroz `DATABASE_ADMIN_URL`. Ako je `true`, rola ima više prava nego što joj treba.

Za punu, read-only provjeru staginga/produkcije pokreni preflight kao postojeći
`DATABASE_URL` aplikacijski principal (ne admin). U runtime slici ovo je jedna `psql` komanda:

```sh
cd /app/db/preflight-checks && psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f 001_security.sql -f 002_privileges.sql
```

Očekivani izlaz završava sa `PREFLIGHT OK` za RLS, matricu, non-RLS allowlist i funkcije; bilo
koji višak ili manjak prava vraća non-zero exit code. TSV se učitava lokalno od psql klijenta,
zato komanda radi iz direktorija `/app/db/preflight-checks`. Ako URL sadrži Prisma `schema`
parametar, koristi `./run.sh` umjesto sirovog URL-a; skripta ga ukloni bez diranja TLS opcija.

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
| `DATABASE_ADMIN_URL nedostaje` | `RUN_MIGRATIONS=true`, ali migrator nije podešen | §1, §4 |
| `GREŠKA: DATABASE_URL sadrži HTML entity `&amp;`` | copy/paste iz HTML-a | zamijeni `&amp;` sa `&` |
| `PREFLIGHT: DATABASE_URL je spojen kao superuser` / `PREFLIGHT: aplikacijska rola ... ima BYPASSRLS` | aplikacijska rola je previše privilegovana | Promijeni atribute role kao DBA, zatim ponovi deploy; preflight neće pustiti server. |
| `PREFLIGHT: DATABASE_URL rola ... vlasnik je tabela` | migracijska i aplikacijska rola su spojene | Postavi odvojenu `DATABASE_URL` ne-vlasničku rolu i `DATABASE_ADMIN_URL` za migracije; preflight neće pustiti server. |
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
