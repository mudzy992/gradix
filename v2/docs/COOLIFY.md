# Gradix v2 — Coolify resource `gradix-web` (testna domena gradix.ba101.top)
#
# KAKO SE KORISTI
#   1. Coolify → Project → Environment (npr. `test`) → + New Resource → Docker Compose
#      (Empty / "Docker Compose" sa git izvorom; NIJE "Nixpacks".)
#   2. Source: GitHub repo, branch `arena/37e610e9-gradix` (ili `main` kad se spoji).
#   3. Base Directory: `/v2`
#      Docker Compose Location: `/infra/coolify/docker-compose.yml`
#   4. Environment Variables: prepiši iz tabele ispod (samo imena — vrijednosti unosiš ti).
#   5. Domain: `https://gradix.ba101.top` → kontejner port `3000`, TLS on (Let's Encrypt).
#   6. Deploy. Prvi deploy gradi sliku ~3–5 min (pnpm install + next build).
#
# Redoslijed pri startu kontejnera:
#   provjera env → (RUN_MIGRATIONS=true) psql provjera + migracije → node server.js
# Ako baza nije dostupna ili AUTH_SECRET < 32 znaka, kontejner PADA sa jasnom porukom
# umjesto da radi u polupokvarenom stanju.

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

## 5. Demo podaci (opciono, jednom)

Coolify → resource `gradix-web` → Terminal:

```sh
cd /app && DATABASE_ADMIN_URL="$DATABASE_URL" SEED_PASSWORD='<tvoja lozinka>' \
  node -e "console.log('seed se pokreće iz build faze, vidi niže')"
```

Seed je razvojni alat (TypeScript, traži `tsx`), pa se **ne** izvršava u runtime slici.
Dva načina:
* **Preporučeno:** privremeno uključi `RUN_SEED=true` u compose-u (build stage ima tsx),
  ili
* pokreni seed sa svoje mašine protiv javno dostupne baze (nije preporučeno).

Ako demo podaci nisu potrebni, preskoči — aplikacija radi sa praznom bazom, samo nema
korisnika za prijavu.

## 6. Provjera poslije deploya

```sh
curl -s https://gradix.ba101.top/api/health   # {"status":"ok"}
curl -s https://gradix.ba101.top/api/ready    # postgres ok, migrations.applied, databaseRole
```

`/api/ready` mora vratiti `"is_super": false, "bypass_rls": false`. Ako vrati `true`,
RLS ne štiti i to se rješava u §4 prije bilo kakve upotrebe.
