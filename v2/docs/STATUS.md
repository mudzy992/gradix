# STATUS — Gradix v2

**Faza:** 1 · **Datum:** 2026-11-07 · **Kapija:** **G1 odobren**, **R1a ✅**, **R1b ✅**,
**dizajn v2 ✅**, **R2a ✅**, **R2b ✅**, **R3 ✅**, **A ✅**, **B ✅ lokalno + CI**.
**Sljedeće:** R4a-1 implementacija je odobrena. Dizajn je odobren „ovako“: worker self-entry glavni
tok, ured read-only na 360/1440 u obje teme; grupni unos šefa ostaje R4a-2. Kod za korake 1–3
iz `docs/PLAN-R4.md` je pripremljen; R3/R4 migracije, PostgreSQL integracije i staging preflight
nisu izvršeni. Ovdje je obavezan stop: prvo staging preflight i pregled loga vlasnika; bez te kapije
ne počinju naredni koraci ni UI korak 7.
Planovi i odluke: `docs/PLAN-R3.md`, `docs/PLAN-R4.md`, `docs/R3-ODSTUPANJA.md`,
`docs/DECISIONS/0009`–`0013`.

**A:** commit `a9d3174`; GitHub Actions run `42582658045` prošao, uključujući ephemeral Docker build.
Slika nije objavljena niti zadržana poslije runnera. **B:** commit `d93ceb3`; GitHub Actions run
`42588871034` prošao, uključujući negativni dokaz da preflight odbija višak prava i preflight poslije
integracija na popunjenoj bazi. Lokalno su `pnpm lint`, `pnpm typecheck`, puni test suite, prazna/
popunjena baza i seed pod ne-superuser migratorom prošli. Staging/produkcija nisu nezavisno
provjereni iz sandboxa.

## Gotovo

| # | Korak | Stanje |
|---|---|---|
| 1 | pnpm workspace, TS strict, ESLint, Turbo, `AGENTS.md` | ✅ |
| 2 | `docs/STATUS.md`, 6 ADR-a | ✅ |
| 3 | Lokalno okruženje (compose + skripta jednom komandom) | ⚠️ compose napisan, **neizvršen** (nema Dockera u sandboxu) |
| 4 | `packages/db`: šema, 4 migracije, role bootstrap | ✅ prolazi na praznoj bazi |
| 5 | Tenant scope + RLS spike | ✅ 8/8 na pravoj bazi |
| 6 | Prijava, zaštićena stranica, `/api/me`, jedan zapis | ✅ 8/8 integracijskih testova |
| 7 | Mobilni kostur + offline zapis i sync | ✅ 5/5 testova; **native (android) bundle se builda** — `expo export -p android` |
| R1a | Pristup: pozivnice, reset, obavezna promjena, deaktivacija, rate limit u bazi | ✅ 9/9 integracijskih testova, 24 snimka svih stanja |
| R1b | Matrica rola (pregled), dodjela rola i opsega, audit trag sa filterima | ✅ funkcionalno (23/23 testa), dizajn prepisan u „dizajn v2“ |
| Dizajn v2 | Tokeni (6 boja, obje teme), `next/font`, okvir, primitivi, svi ekrani, mobilni sa istim tokenima | ✅ kod + testovi + 68 snimaka; **vlasnik odobrio 2026-11-08**, referenca dopunjena |
| 8 | `contracts` (OpenAPI iz koda) | ❌ nije urađeno — vidi „ne radi“ |
| 9 | CI | ✅ **zelen na GitHub Actions** (`daabf07`, 57 s): lint, typecheck, migracije, 49 testova, `prisma generate`, migracija na praznoj bazi |
| 10 | Docker + staging | ✅ compose za Coolify (`infra/coolify/`), `.env.example`, entrypoint; slika **nije izgrađena lokalno** (nema Dockera) — standalone server dokazan |
| 11 | Pravila kao kod + skillovi | ⚠️ lint/typecheck/granična validacija da; skillovi ne |
| R2a | Radnici, mašine, kategorije kao podaci, uvoz iz Excela | ✅ kapija prošla uživo 2026-11-09 |
| R2b | Obaveze s rokom: verzije, prilozi, izvedeno stanje, mobilni „Moji rokovi“ | ✅ kapija prošla uživo 2026-11-09 |
| R3 | Projekti, dodjele, opseg, blokada/iznimka | ✅ kod + testovi; `scope` novi red = `SELF`; entrypoint i CI preflight koriste `DATABASE_URL`; oba mehanizma preklapanja prolaze u GitHub run `42588871034` |
| R4a-1, koraci 1–3 | Assignment history, sync cursor, workday/entry/receipt/conflict baza | ⚠️ SQL, RLS/ACL/preflight i testovi pripremljeni; static checks prolaze, ali migracije, PostgreSQL integracije i staging preflight nisu izvršeni; stop prije koraka 4+ i UI 7 dok staging gate ne prođe |

**Provjereno lokalno (2026-11-08, dizajn v2):** `pnpm lint` (0), `pnpm typecheck` (4/4), `pnpm turbo run test --force` (**152** testa: db 10, domain 34, mobile 20, web 88), `pnpm test:a11y` (33 testa, axe WCAG 2.1 AA), `next build` (sve rute), mobilni `expo export -p web` i `expo start --web` u obje teme, `expo export -p android` (od R1c, RN 0.88.1).

**Dizajn v2 — šta je mašinski dokazano:** paleta (samo šest heksova u `globals.css`, nijanse preko `color-mix`), web i mobilni tokeni se ne raziđu, AA kontrast u obje teme za tekst, tihi tekst, fokus i tekst na primarnoj akciji, oblik iz reference (ploča 18 / kartica 16 / polje 12 / pilula) i okvir (`apps/web/src/design/tokens.test.ts`, 15 testova). Tastatura i a11y su takođe testovi: `apps/web/src/components/shell.test.tsx` (13) i axe na okviru, listi korisnika, matrici, auditu i oba dijaloga (33 testa u `pnpm test:a11y`).

**Mobilni native bundle:** `expo export -p android` prolazi (`entry-*.hbc`, 2,6 MB) — ovim je otkriven i popravljen bug `react-native/setup-env` (RN 0.86 → 0.88.1). `expo export -p web` prolazi i sa neusklađenim verzijama, zato je u CI dodata provjera `pnpm check-expo`.

**Historijski testovi u oba modela baze** (ne predstavljaju podržanost oba deploy modela):

| Model | Rola | db testovi | web testovi | seed |
|---|---|---|---|---|
| A — dvije role | migracije: `postgres`, app: `gradix_app` | 10/10 | 8/8 | ✅ |
| B — jedna rola (Coolify) | `gradix_app` vlasnik baze i tabela | 10/10 | 8/8 | ✅ (2× zaredom, idempotentno) |

Model B je istorijski bio testiran kroz **standalone server**, ali zatvaranje R3 sada zahtijeva
odvojenu aplikacijsku rolu: runtime preflight namjerno ODBIJA `DATABASE_URL` rolu koja je vlasnik
tabela, superuser ili ima `BYPASSRLS`. Podržan deploy je model sa ne-vlasničkom aplikacijskom rolom.

## Ne radi / nije urađeno

- **Mobilni u Expo Go nije još otvoren na telefonu** — bundle i Metro su dokazani u sandboxu, veza telefon → Metro nije (mora vlasnik, `docs/MOBILE-EXPO-GO.md`).
- **R4 push/pull API i offline outbox** još nisu urađeni; planirani su u koracima 4–6 `docs/PLAN-R4.md`. Ovaj rez staje nakon DB koraka 3; ne pravi se UI prije staging kapije.
- **Docker slika nije izgrađena** (nema Dockera u sandboxu). Dokazano je ono što se dokazati može: `output: standalone` build + pokretanje `server.js` protiv prave baze. Prvi `docker build` se dešava na Coolifyju i to je prva prava provjera Dockerfilea.
- **CI je bio mrtav kod** i to je otkriveno u ovoj kapiji: workflow je stajao u `v2/.github/workflows/`, a GitHub izvršava samo `.github/workflows/` u korijenu. Sada je `.github/workflows/ci-v2.yml` sa `paths: v2/**`. Prvi zelen run: `daabf07`.
- **Staging/produkcija:** sandbox nema njihove `DATABASE_URL` konekcije, pa aplikacijska rola, vlasništvo i ACL nisu nezavisno provjereni. Novi runtime preflight (RLS, app ACL matrix i višak/manjak prava) je u B; vlasnik ga mora pokrenuti baš kroz postojeći `DATABASE_URL` na svakoj okolini. Odbija start ako je aplikacijska rola vlasnik/superuser/BYPASSRLS. Uputstvo i jedna `psql` komanda: `docs/COOLIFY.md`.
- **Skillovi** (`new-resource`, `db-migration`, `ui-screen`, `mobile-offline-entity`) nisu napisani.
- **Rate limit prijave je u memoriji procesa** — ne dijeli se između replika. Redis dolazi kad bude druga replika.
- ~~Nema `logout-all`, liste sesija, promjene lozinke, pozivnica~~ — **R1a urađen.**
- **Opseg „dodijeljeni projekti“ nije u R1b** — odluka vlasnika, a **R3**, ne R2 (`docs/PLAN-R3.md`);
  `PROJECTS` i `project_ids` su uklonjeni iz baze i API-ja. Dodjela projekta dobija **posebnu
  dozvolu `projects.assign`**, ne `users.manage`. Iznimku od blokade odobrava **još uža dozvola
  `projects.override`** (OWNER, ADMIN) — ko dodjeljuje, ne odobrava pravilo sam sebi
  (`docs/DECISIONS/0010`).
- **Mobilni ima jedan entitet (`note`)**; radni dan/ture/gorivo su R4/R5.
- **Provjera privatnosti** (`pnpm check-privacy`) je CI korak prije testova: pada na JMBG, na polja
  ličnih podataka u kodu i na emailove van `*.test`/`example.*`/`@demo.ba`; ima samoprovjeru.
- **`packages/contracts`** drži envelope, kodove grešaka, šeme, registar ruta, tipizirani klijent i
  `openapi.json`. Web i mobilni koriste isti klijent; `pnpm --filter @gradix/contracts check` u CI-ju
  pada ako `openapi.json` nije regenerisan.
- **Crvena za grešku** je izričit token (`#b42318` / `#ff9b90`) uz šest boja palete; `--success` je
  uklonjen i uspjeh koristi `--tint`. Podloge stanja moraju biti ΔE ≥ 5 jedna od druge (test).
- **Dizajn v2** je prepisan po `docs/design/DESIGN.md` + `reference.html` (okvir, primitivi, svi
  ekrani, obje teme, mobilni sa istim tokenima). Stari smjerovi A/B i R1c okvir su **obrisani**.
- **Osam elemenata je bilo van reference** (dijalozi, prazna stanja, učitavanje, prijava, lozinke,
  matrica rola, drawer, mobilna akcija). Vlasnik ih je 2026-11-08 odobrio, pa su dopunjeni u
  `reference.html` i `DESIGN.md` u istom commitu (`docs/DEMO-DIZAJN.md` §4).
- **Mobilni fontovi** su statičke instance istih `woff2` fajlova kao web (`manrope-500/600/700/800`,
  `plex-mono-500`), spojeni latin + latin-ext; web ostaje `next/font/local`.
- **`expo-secure-store` nema web implementaciju** — sav pristup skladištu ide kroz
  `apps/mobile/src/lib/store.ts` (na uređaju Keychain, na webu `localStorage`). Bez toga se
  ekran na webu rušio. Isto važi za ključ `gx-theme` (SecureStore ne prima crticu).
- **Nema `apps/worker`** — namjerno, nema još nijedan pozadinski posao.
- **`.npmrc` koristi `shamefully-hoist=true`** jer `react-native-web` u pnpm strukturi ne razrješava `AssetRegistry`; to je tehnički dug koji treba svesti na `public-hoist-pattern`.

## Otvoreno za vlasnika

1. **R4a-1 plan i dizajn:** vlasnik je odobrio dizajn „ovako“ i odobreni plan (`docs/PLAN-R4.md`).
   Izrada je ograničena na R4a-1 i po mini-kapijama; R4a-2/R4b se ne implementiraju u ovom rezu.
2. **Coolify resource** po `docs/COOLIFY.md`: Base Directory `/v2`, compose
   `/infra/coolify/docker-compose.yml`, `DATABASE_URL` aplikacijska rola + odvojeni
   `DATABASE_ADMIN_URL` kad `RUN_MIGRATIONS=true`, `AUTH_SECRET`, domena
   `https://gradix.ba101.top` → port 3000.
3. **Staging aplikacijska rola:** potvrditi runtime preflight izlaz (`DATABASE_URL`, ne admin konekcija).
   Vlasnička rola nije podržana; `infra/docker/entrypoint-web.sh` odbija start ako preflight
   utvrdi da je `DATABASE_URL` superuser, vlasnik tabele ili ima `BYPASSRLS`.
4. **GH secrets:** za sada **nijedan** nije potreban (`docs/GH-SECRETS.md`).
5. **Demo** po `docs/DEMO-G1.md` — reci prolazi/ne prolazi.
6. **Bucket `gradix-v2`** — potreban prije R5, ne prije G1.
7. **Redis ACL** (`infra/redis/acl-v2.txt`) — nije potreban u ovoj fazi; javim kad bude.
8. ~~Prisma u CI-ju~~ — **zatvoreno:** `prisma generate` je zelen u CI-ju (`daabf07`), ADR 0002
   je time potvrđen u modelu „Prisma u CI/Coolify, SQL-first lokalno“.
9. **R4 staging gate:** poslije primjene koraka 1–3, pokrenuti `cd /app/db/preflight-checks &&
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f 001_security.sql -f 002_privileges.sql`
   kroz aplikacijsku `DATABASE_URL` rolu (ne admin) i zalijepiti cijeli izlaz iz deploy loga prije
   nastavka na kasnije korake ili UI korak 7 (`docs/COOLIFY.md` §6).
