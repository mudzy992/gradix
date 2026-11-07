# STATUS — Gradix v2

**Faza:** 1 (postavljanje) · **Datum:** 2026-11-07 · **Kapija:** mini-kapija 2 (koraci 6–7) + Coolify isporuka
**Sljedeće:** vlasnik diže resource po `docs/COOLIFY.md`; bez njegove riječi ne idem na G1 ni Fazu 2.

## Gotovo

| # | Korak | Stanje |
|---|---|---|
| 1 | pnpm workspace, TS strict, ESLint, Turbo, `AGENTS.md` | ✅ |
| 2 | `docs/STATUS.md`, 6 ADR-a | ✅ |
| 3 | Lokalno okruženje (compose + skripta jednom komandom) | ⚠️ compose napisan, **neizvršen** (nema Dockera u sandboxu) |
| 4 | `packages/db`: šema, 4 migracije, role bootstrap | ✅ prolazi na praznoj bazi |
| 5 | Tenant scope + RLS spike | ✅ 8/8 na pravoj bazi |
| 6 | Prijava, zaštićena stranica, `/api/me`, jedan zapis | ✅ 8/8 integracijskih testova |
| 7 | Mobilni kostur + offline zapis i sync | ✅ 5/5 testova; web izlaz se builda |
| 8 | `contracts` (OpenAPI iz koda) | ❌ nije urađeno — vidi „ne radi“ |
| 9 | CI | ✅ **zelen na GitHub Actions** (`daabf07`, 57 s): lint, typecheck, migracije, 49 testova, `prisma generate`, migracija na praznoj bazi |
| 10 | Docker + staging | ✅ compose za Coolify (`infra/coolify/`), `.env.example`, entrypoint; slika **nije izgrađena lokalno** (nema Dockera) — standalone server dokazan |
| 11 | Pravila kao kod + skillovi | ⚠️ lint/typecheck/granična validacija da; skillovi ne |

**Provjereno lokalno:** `pnpm lint` (0), `pnpm typecheck` (4/4), `pnpm test` (**49** testova: 26 domain, 10 db, 8 web, 5 mobile), migracije na praznoj bazi, demo tok kroz `curl` i kroz integracijske testove.

**Provjereno u oba modela baze** (ovo je bilo otvoreno, sada zatvoreno):

| Model | Rola | db testovi | web testovi | seed |
|---|---|---|---|---|
| A — dvije role | migracije: `postgres`, app: `gradix_app` | 10/10 | 8/8 | ✅ |
| B — jedna rola (Coolify) | `gradix_app` vlasnik baze i tabela | 10/10 | 8/8 | ✅ (2× zaredom, idempotentno) |

Model B je dodatno dokazan kroz **produkcijski standalone server** (`node apps/web/server.js`):
`/api/health` 200, `/api/ready` (`is_super:false, bypass_rls:false`, 5 migracija),
prijava 200, `/api/me` izolovan (3 mašine vs 1), sync push idempotentan (`duplicate:true`),
batch >200 → 400, `since` u budućnosti → 400, odjava → `/api/me` 401.

## Ne radi / nije urađeno

- **`packages/contracts` i OpenAPI iz koda** nisu urađeni; API je tipiziran ručno u `apps/mobile/src/api/client.ts`. Ovo je dug, ne zaborav.
- **Docker slika nije izgrađena** (nema Dockera u sandboxu). Dokazano je ono što se dokazati može: `output: standalone` build + pokretanje `server.js` protiv prave baze. Prvi `docker build` se dešava na Coolifyju i to je prva prava provjera Dockerfilea.
- **CI je bio mrtav kod** i to je otkriveno u ovoj kapiji: workflow je stajao u `v2/.github/workflows/`, a GitHub izvršava samo `.github/workflows/` u korijenu. Sada je `.github/workflows/ci-v2.yml` sa `paths: v2/**`. Prvi zelen run: `daabf07`.
- **Staging ne postoji** — čeka tvoj Coolify deploy; uputstvo i tačne varijable: `docs/COOLIFY.md`.
- **Skillovi** (`new-resource`, `db-migration`, `ui-screen`, `mobile-offline-entity`) nisu napisani.
- **Rate limit prijave je u memoriji procesa** — ne dijeli se između replika. Redis dolazi kad bude druga replika.
- **Nema `logout-all`, liste sesija, promjene lozinke, pozivnica** — R1.
- **Mobilni ima jedan entitet (`note`)**; radni dan/ture/gorivo su R4/R5.
- **Dizajn je minimalni shell** (tokeni + dvije stranice). Dva smjera su Faza 2.
- **Nema `apps/worker`** — namjerno, nema još nijedan pozadinski posao.
- **`.npmrc` koristi `shamefully-hoist=true`** jer `react-native-web` u pnpm strukturi ne razrješava `AssetRegistry`; to je tehnički dug koji treba svesti na `public-hoist-pattern`.

## Otvoreno za vlasnika

1. **Coolify resource** po `docs/COOLIFY.md`: Base Directory `/v2`, compose
   `/infra/coolify/docker-compose.yml`, tri varijable (`DATABASE_URL`, `AUTH_SECRET`,
   `RUN_MIGRATIONS=true`), domena `https://gradix.ba101.top` → port 3000.
2. **Rola u bazi** (jednom, kao superuser): `ALTER ROLE gradix_app NOSUPERUSER NOBYPASSRLS;`
   — bez ovoga `/api/ready` prijavi `is_super:true` i aplikacija odbija poslovne upite.
3. **GH secrets:** za sada **nijedan** nije potreban (`docs/GH-SECRETS.md`).
4. **Demo** po `docs/DEMO-G1.md` — reci prolazi/ne prolazi.
5. **Bucket `gradix-v2`** — potreban prije R5, ne prije G1.
6. **Redis ACL** (`infra/redis/acl-v2.txt`) — nije potreban u ovoj fazi; javim kad bude.
7. ~~Prisma u CI-ju~~ — **zatvoreno:** `prisma generate` je zelen u CI-ju (`daabf07`), ADR 0002
   je time potvrđen u modelu „Prisma u CI/Coolify, SQL-first lokalno“.
