# STATUS — Gradix v2

**Faza:** 1 (postavljanje) · **Datum:** 2026-11-07 · **Kapija:** mini-kapija 2 (koraci 6–7) i priprema za G1
**Sljedeće:** vlasnik provjerava demo; bez njegove riječi ne idem na G1 ni Fazu 2.

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
| 9 | CI | ⚠️ workflow napisan, **neizvršen** (nema GH runnera u sandboxu) |
| 10 | Docker + staging | ⚠️ Dockerfile i entrypoint napisani, **neizgrađeni**; staging čeka vlasnika |
| 11 | Pravila kao kod + skillovi | ⚠️ lint/typecheck/granična validacija da; skillovi ne |

**Provjereno lokalno:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (47 testova: 26 domain, 8 db, 8 web, 5 mobile), migracije na praznoj bazi, demo tok kroz `curl` i kroz integracijske testove.

## Ne radi / nije urađeno

- **`packages/contracts` i OpenAPI iz koda** nisu urađeni; API je tipiziran ručno u `apps/mobile/src/api/client.ts`. Ovo je dug, ne zaborav.
- **Docker slika nije izgrađena** (nema Dockera u sandboxu). Dockerfile je napisan po `output: standalone` i nije dokazan.
- **CI nije pokrenut.** Workflow uključuje korak `prisma generate` — to je i provjera ADR 0002.
- **Staging ne postoji** — čeka Coolify env (lista u `docs/GH-SECRETS.md`).
- **Skillovi** (`new-resource`, `db-migration`, `ui-screen`, `mobile-offline-entity`) nisu napisani.
- **Rate limit prijave je u memoriji procesa** — ne dijeli se između replika. Redis dolazi kad bude druga replika.
- **Nema `logout-all`, liste sesija, promjene lozinke, pozivnica** — R1.
- **Mobilni ima jedan entitet (`note`)**; radni dan/ture/gorivo su R4/R5.
- **Dizajn je minimalni shell** (tokeni + dvije stranice). Dva smjera su Faza 2.
- **Nema `apps/worker`** — namjerno, nema još nijedan pozadinski posao.
- **`.npmrc` koristi `shamefully-hoist=true`** jer `react-native-web` u pnpm strukturi ne razrješava `AssetRegistry`; to je tehnički dug koji treba svesti na `public-hoist-pattern`.

## Otvoreno za vlasnika

1. **Demo** po `docs/DEMO-G1.md` — reci prolazi/ne prolazi.
2. **Coolify env**: `DATABASE_URL` (rola `gradix_app`), `DATABASE_ADMIN_URL`, `AUTH_SECRET`. Bez njih nema staginga.
3. **Bucket `gradix-v2`** — potreban prije R5, ne prije G1.
4. **Redis ACL** (`infra/redis/acl-v2.txt`) — nije potreban u ovoj fazi; javim kad bude.
5. **Prisma u CI-ju:** ako korak `prisma generate` prođe, ADR 0002 se mijenja u „Prisma u CI/Coolify, SQL-first lokalno“ (tvoja odluka 2 je već u tom smjeru — treba samo potvrda iz zelenog CI-ja).
