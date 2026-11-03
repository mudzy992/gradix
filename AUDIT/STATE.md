# AUDIT/STATE.md — živi dnevnik

> Pravilo: ovaj fajl se ažurira u **svakom** commitu.

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; radi se direktno na grani.

## Trenutna faza / segment / korak

**FAZA 2–4 ✅ završene; KAPIJA 2 prošla** („nastavi dalje“ = odobrenje; Q1–Q5 usvojeni po preporuci,
zapisani kao D-012…D-016 i mogu se mijenjati). **Izvršavanje segmenata u toku.** Vlasnik odobrio prelazak
preko KAPIJE 1 („Nastavi dalje“), pa se radi do **KAPIJE 2** bez zaustavljanja.

## Zadnji commit i CI

| | |
|---|---|
| Zadnji commit | `BE-08` (migracija: 51 FK indeks, 19 audit akcija, parcijalni unique timer indeksi; seed: prod vs demo) |
| CI | ⏳ `fix(ci) … [BE-08]` — docker gate zelen, audit traži regenerisanu matricu |
| Zadnji potvrđeno zelen run | [41585201977](https://github.com/mudzy992/gradix/actions/runs/41585201977) ✅ 6/6 · prije: 41584897234 (BE-07) ✅ 6/6, 41584220516 (BE-06 STATE) ✅ 6/6, 41583988902 (BE-06) ✅ 6/6, 41536108972 (BE-05) ✅ 6/6, 41534087012 (BE-04) ✅, 41531577934 (BE-03 STATE) ✅, 41531137887 (BE-03) ✅ 6/6, 41528279151 (BE-02) ✅ 6/6, 41524479730 (BE-01/2) ✅, 41522506769 (BE-01/1), 41522506769 (BE-01/1), 41515682989 (INF-03), 41514693571 (INF-02), 41513947158 (INF-01) |
| Sljedeća kapija | nema — izvršavanje segmenata po planu (§3), izvještaj nakon svakog |

## Hronologija (šta je urađeno)

### 2026-11-02 — priprema infrastrukture (prije audita)
- `c6dbcad` Dockerfile `--include=dev` · `be3bbc7` MinIO image · `a1ca82f` bez host portova + mreže
- `645f669` seed u produkcijskoj slici · `5679a4b` CA mount-ovi + MinIO na hostu

### 2026-11-02 — FAZA 0 (`A-00`, `e531ca2`)
- Pročitana sva dokumentacija; mapiran repo; izmjeren obim.
- `AUDIT/00_PROJECT_UNDERSTANDING.md` + pitanja P1–P10.

### 2026-11-02 — FAZA 1.1 (`A-01`)
- `AUDIT/01_DOCS_VS_REALITY.md`: 32 provjerene tvrdnje (15 ✅ / 8 ⚠️ / 3 ❌ / 6 ❓) po
  oblastima: infrastruktura, backend, frontend, mobile, CI; svaka sa `fajl:linija` dokazom.
- Najteži nalazi: **MySQL vs PostgreSQL** (❌, riješeno odlukom D-001), email je stub (❌),
  `pull_request` trigger (❌ prema novim pravilima), nema env validacije/a11y/coverage praga.

### 2026-11-02 — FAZA 1.2 (`A-02`)
- **Penzionisano 85 dokumenata** u `docs/_retired/` (originalne putanje zadržane), svaki sa
  banerom „⚠️ PENZIONISANO“; `docs/_retired/INDEX.md` sa opisom svakog fajla.
- Uklonjeno (odluka D-010): `backup/migrations/**` (9 MySQL fajlova; vraćanje iz `5679a4b`).
- `.cursorrules` i novi `.cursor/rules/00_project.mdc` postali pokazivači na `docs/` (D-011).
- Reference na penzionisane dokumente u `docker-compose*.yml`, Dockerfile-ovima, entrypointu i
  `tsconfig.build.json` preusmjerene na `docs/INFRASTRUCTURE.md`.

### 2026-11-02 — FAZA 1.3 (`A-03`)
- Nova dokumentacija (jedini izvor istine): `docs/README.md` (indeks) + `ARCHITECTURE.md`,
  `INFRASTRUCTURE.md`, `BACKEND.md`, `FRONTEND.md`, `MOBILE.md`, `TESTING.md`, `CI.md`,
  `CONVENTIONS.md`, `DECISIONS.md` (D-001…D-011 odobrene + D-020…D-027 implementirane).
- U `DECISIONS.md` zapisani svi odgovori vlasnika na P1–P10 (PostgreSQL konačan, penzionisanje
  dokumenata, mobile bez objave, Maestro, test piramida, zavisnosti uz zapis, bez staginga,
  nova paleta + WCAG 2.2 AA, produkcijski seed = 1 platform admin, brisanje MySQL backup-a).
- Provjereni relativni linkovi u `docs/*.md` i `AUDIT/*.md` (13 fajlova, 0 pokvarenih).

### 2026-11-02 — FAZA 2 (`A-04`, master plan)
- `AUDIT/02_MASTER_AUDIT_PLAN.md`: mjerljivi kriteriji završetka po sloju, pravila izvršavanja
  (jedan segment = kod + testovi + docs + dokaz + zelen CI), redoslijed, 59 segmenata sa
  ulazom/rizikom/DoD, izbor alata sa alternativama i obrazloženjem, zavisnosti, rizici, Q1–Q5.
- `scripts/audit/segments.json`: mašinski čitljiv registar 59 segmenata (STD 2, CI 7, INF 7,
  BE 18, FE 16, MOB 7, TEST 2), svi na `planned`.
- Nijedan alat nije dodan u ovom koraku (plan predviđa: Prettier svuda, oxlint za frontend,
  Jest `coverageThreshold`, Playwright + axe-core, Maestro, `gitleaks`, pino, zod).

### 2026-11-02 — FAZA 3 (`A-05`, inventar + matrica pokrivenosti)
- `scripts/audit/lib.mjs`, `inventory.mjs`, `check-coverage.mjs` (bez novih zavisnosti: node
  builtin + ručni CSV parser), `AUDIT/COVERAGE_MATRIX.csv` (jedan red po izvornom fajlu).
- CI job `audit` pokreće `check-coverage`; crveno ako fajl nije u matrici, ako je označen
  `pregledano` bez zapisa ili ako segment iz `segments.json` nema red u matrici.

### 2026-11-02 — FAZA 4 (`A-06`, skeletoni segmenata)
- `scripts/audit/scaffold-segments.mjs` generiše `AUDIT/segments/<ID>.md` (10 sekcija) iz
  `segments.json` + matrice; postojeće ne prepisuje (`--force`, `--check`).
- **59/59 segmenata** ima skeleton; svaki u sekciji 2 već ima tačan spisak svojih fajlova iz
  matrice (procesni segmenti imaju `scopeReason` umjesto liste).
- `AUDIT/02_MASTER_AUDIT_PLAN.md` §9.1: tabela 10 sekcija; §5: inventar + gate dodati u tabelu alata.

### 2026-11-02 — CI-01 (`A-07`, okidači)
- `pull_request` trigger **uklonjen**; `push` samo `main` + `arena/0bc0e56e-gradix`; glob `arena/**`
  zamijenjen tačnim imenom grane (F-CI-01-01/02). `workflow_dispatch` ostaje.
- Gate je uhvatio drift matrice (`loc` za `ci.yml`) → `check-coverage` sada provjerava i `loc`, pa
  se takav drift vidi lokalno, ne samo u CI-ju.

### 2026-11-02 — STD-01 + STD-02 (`A-08`, guardrail)
- Korijenski `package.json` (**bez zavisnosti**) sa `check:all`, `check:docs`, `check:secrets`,
  `check:logs`, `check:compose`, `check:coverage-matrix`, `audit:inventory`, `audit:segments`.
- `scripts/standards/`: orkestrator (11 koraka, `--only`, `--ci`, `--list`), docs guard (255
  provjera), secret skener (6 pravila), `console.log` guard, compose guard (13 invarijanti) +
  `allowlist.json` sa 3 izuzetka (svaki sa razlogom).
- `backend/package.json` + `lint:check`/`typecheck`; `frontend/package.json` + `lint:check`/`typecheck`.
- CI job `audit` sada pušta `npm run check:all -- --only=coverage,segments,docs,secrets,logs,compose`.
- Negativni testovi izvedeni (pokvaren link → exit 1, uklonjen CA mount → exit 1).
- Odgovori na Q1–Q5 zapisani kao **D-012…D-016** (paleta B, email bez lažnog uspjeha, Redis
  ostaje, bundle 250 kB, coverage floor 40 %).

### 2026-11-02 — CI-03 (`A-09`, pinning/timeouti/cache)
- Sve GitHub akcije pinovane na commit SHA (`actions/checkout`, `setup-node`, `upload-artifact`,
  `docker/setup-buildx-action`, `docker/build-push-action`) uz komentar taga.
- `timeout-minutes` na svih 6 jobova (5/15/20/15/20/30) — dug C7 zatvoren.
- Cache potvrđen (npm po paketu, Docker `type=gha`); job `audit` svjesno bez cache-a.

### 2026-11-02 — CI-04 (`A-10`, coverage ratchet)
- CI sada mjeri pokrivenost (`npm run test:cov`) i pušta **ratchet**:
  `scripts/standards/check-coverage-ratchet.mjs` vs `backend/coverage-baseline.json`.
  Baseline je **izmjereno** stanje (linije 0,18 %), ne želja; 40 % ostaje cilj faze (D-016).
- Artefakt `backend-coverage` (lcov + summary, 7 dana) + tabela pokrivenosti u `GITHUB_STEP_SUMMARY`.
- Negativan test izveden: baseline 5 % → exit 1.
- `check:all` ima 12 koraka; `backend/coverage-baseline.json` ušao u matricu (TEST-01).

### 2026-11-02 — INF-01 (`A-11`, compose/mreže/env)
- Novi guard `scripts/standards/check-env.mjs` (67 provjera): svaka varijabla iz compose/entrypoint/
  Dockerfile/backend/frontend/mobile postoji u `.env.example`; `.env.example` ↔ `.env.coolify` parity;
  mrtve varijable = upozorenje; **zabrana referenci na penzionisane dokumente iz konfiguracije**.
- Popravljeno: `.env.example`/`.env.coolify` dobili `PORT`, `MINIO_PORT`, `REDIS_TLS_CA_FILE`;
  4 reference na penzionisan `DEPLOYMENT_COOLIFY.md` → `docs/INFRASTRUCTURE.md`.
- Dokumentovano (bez promjene ponašanja): `JWT_REFRESH_SECRET` je tada bio obavezan u compose-u, a
  kod ga nije čitao → **riješeno u BE-02** (varijabla uklonjena, D-029); `REDIS_*` se prenose, kod
  ih ne čita (INF-07, D-014).
- Negativan test: uklonjen `MINIO_PORT` → exit 1.

### 2026-11-02 — INF-02 (`A-12`, backend slika)
- Produkcijska backend slika **više ne radi kao root**: `USER node`, `--chown=node:node` na svim
  `COPY` koracima, Prisma keš u `/home/node/.cache`, `HOME=/home/node`.
- Novi guard `scripts/standards/check-image.mjs` (7 provjera bez Dockera): non-root prije
  `ENTRYPOINT`, healthcheck na `/api/health`, exec forma, `set -e` + `exec "$@"`, SSL preflight
  prije migracija, `dist/prisma/seed.js` u buildu.
- Negativan test: stari Dockerfile (bez `USER`) → exit 1. Stvarna verifikacija = CI job `docker`
  (build + seed iz produkcijske slike).
- **Run 41514362265 je pao** (job `docker`, korak „Root Dockerfile-ovi moraju biti identični“):
  izmijenjen je samo `backend/Dockerfile`. Popravka: korijenska kopija sinhronizovana + guard
  `check-image` sada provjerava i identičnost (`F-INF-02-05`).

### 2026-11-02 — INF-03 (`A-13`, nginx + frontend slika)
- **Popravljena tiha greška:** `add_header` u `location /assets/` i `=/index.html` poništavao je
  nosniff/X-Frame-Options/Referrer-Policy iz `server` bloka → headeri sada ponovljeni.
- Dodati `Content-Security-Policy` (bez vanjskih izvora, `script-src 'self'`), `Permissions-Policy`,
  `server_tokens off`.
- Guard `check:image` proširen na frontend (17 provjera): STOPSIGNAL, CSP, nasljeđivanje headera,
  proxy/SPA rute, identičnost **oba** para korijenskih Dockerfile-ova.
- `docs/INFRASTRUCTURE.md` §10 (nginx: proxy, keš, headeri, CSP, zamka `add_header`).

### 2026-11-02 — BE-01 (`A-14`, temelj API-ja — jezgro)
- **Env validacija** (`backend/src/config/env.ts`, bez nove zavisnosti — D-017): sve greške odjednom,
  imenovane varijable; `ConfigModule.forRoot({ validate })`, pa aplikacija ne starta sa pola konfiguracije.
- **Bootstrap**: `.catch` sa jasnom porukom + `exit 1`; `enableShutdownHooks()` (SIGTERM → Prisma
  `$disconnect`); `PORT` iz `ConfigService`.
- **Bezbednosne popravke**: Swagger isključen u produkciji (`ENABLE_API_DOCS`), prazan `CORS_ORIGIN`
  u produkciji = same-origin (D-018), neočekivane greške se loguju a klijent dobija generički 500,
  `429/503` mapirani na `RATE_LIMITED`/`SERVICE_UNAVAILABLE`.
- **Testovi**: 29 ukupno (env 14, filter 4, envelope 4, timer 2 + …); coverage 0,18 % → **2,50 %**,
  baseline podignut.
- Guard `check:env` sada traži i da svaka backend varijabla bude **validirana**; popravljen glob bug
  u `check-secrets` koji je propuštao `*.spec.ts` (lažni pozitiv se pojavio odmah).
- Segment ostaje `in-progress`: schema (6), config fajlovi (5) i preostali guardovi u sljedećem prolazu.
- Prvi run (`41521969883`) pao na **lintu** — `prettier` pravila; fajlovi formatirani, `no-unsafe-member-access`
  u testu zamijenjen tipiziranim pristupom. Ponovljeni run zelen.

### 2026-11-02 — BE-01 drugi prolaz (`A-15`, šema + config) → segment `done`
- Pregledana sva 6 `prisma/schema/*.prisma` (1115 linija), `backend/package.json`, `tsconfig*`,
  `nest-cli.json`, `eslint.config.mjs`, `prisma.config.ts`, `storage-path.ts`.
- Novi guard **`check:schema`**: svaki FK mora imati vodeći indeks. Nađen **51** takav slučaj →
  zaključan u `backend/prisma/index-baseline.json` (guard pada na svaki novi, upozorava na zastarjele).
- **Ništa u šemi nije mijenjano** — indeksi su migracija, a `User.email` unique je odluka o
  podacima/auth-u. Obje odluke su u `AUDIT/segments/BE-01.md` §10 (F-BE-01-07, F-BE-01-08).
- CI ne tipuje testove (`nest build` ih isključuje) → preneseno u TEST-01 (F-BE-01-09).
- Matrica: 474 fajla, 65 pregledano (13,7 %).

### 2026-11-02 — BE-02 (auth) → segment `done`
- **Nalaz (visoko):** `rotate()` je provjeravao samo token, ne i korisnika — deaktiviran korisnik,
  ugašena firma ili korisnik bez rola mogli su **do 30 dana** obnavljati pristup. Sada odluku
  donosi čista funkcija `evaluateRefreshToken` (`auth-token-rules.ts`, 6 ishoda, 9 unit testova),
  a svaki negativan ishod gasi sve sesije korisnika.
- **Nalaz (visoko):** `POST /auth/reset` vraćao `{ ok: true }` bez promjene lozinke → sada
  **`501 AUTH_RESET_NOT_AVAILABLE`**; frontend `/reset` više ne nudi formu koja glumi uspjeh.
- **Nalaz (visoko):** `JWT_REFRESH_SECRET` bio obavezan (`:?`) u compose-u/CI-ju, a nijedan kod ga
  nije čitao → **uklonjen** iz 6 fajlova (9 pojava) i zapisan kao **D-029** (refresh = neprozirni
  token, SHA-256 hash, rotacija + reuse detekcija).
- **Retencija:** dnevni cron (03:00) briše istekle tokene i opozvane starije od 7 dana
  (`REFRESH_RETENTION_DAYS`); `forgot`/`reset` dobili 5/min throttle; `PLATFORM_ADMIN` izuzet od
  pravila „ugašena firma“ (usklađeno sa `JwtStrategy`).
- Testovi: `npx jest src/config src/modules/auth` → **28/28**; `check:all` (8 koraka) ✅;
  matrica **476 fajlova / 76 pregledano (16,0 %)**.

### 2026-11-02 — BE-03 (korisnici, role, scope) → segment `done`
- **Nalaz (visoko):** ADMIN sa `users.write` mogao je resetovati lozinku SUPER_ADMIN-u i preuzeti
  nalog (eskalacija u dva zahtjeva). Dodato **D-030** + `common/rbac/role-hierarchy.ts`
  (`assertCanManageTarget` u `PATCH /users/:id` i `reset-password`).
- **Nalaz (visoko):** `projectListWhere` je koristio `tenantCompanyId!` → `companyId: undefined`
  u Prisma-i znači **bez filtera po firmi**. Sada `requireTenant()` → `403`.
- Ostalo: `scopeByCompany` 500 → 403; pretraga korisnika/projekata `mode: 'insensitive'`;
  `resolvePermissions` deny-by-default za nepoznatu rolu; `throwUnique` čita `meta.target`.
- **Testovi:** 54 unit testa u `src/common` (hijerarhija, permisije, vremenske zone + DST,
  datumi, tranzicije projekta, opseg rola). Matrica **476 fajlova / 99 pregledano (20,8 %)**.
- **Za vlasnika:** F-BE-03-06 (`hidesBudget` — MECHANIC/ACCOUNTANT vide budžet) = odluka, ne bug fix.
- Tri iteracije do zelenog: (1) `41529872217` ❌ e2e — `throwUnique` je čitao samo `meta.target`
  pa je unikat emaila vraćao `CONFLICT`; ispravka = `meta.target` **+ fallback na cijeli `meta`**.
  (2) `41530476307` ❌ lint — nepotrebna tvrdnja (`error.meta as …`), uklonjena.
  (3) **`41531137887` ✅ 6/6.**

### 2026-11-02 — BE-04 (firme, podešavanja, audit) → segment `done`
- **Nalaz (visoko):** pad **audit** upisa vraćao je 500 klijentu iako je poslovna izmjena već
  committed → `AuditService.write` je sada best-effort (loguje, ne ruši) — **D-031**.
- **Nalaz (srednje):** `PUT /settings` nije bio atomski (prvi ključevi ostaju upisani ako treći
  padne) → validacija svih ključeva pa jedna `$transaction`; realtime/audit tek poslije upisa.
- **Nalaz (srednje):** `GET /company` je tražio `settings.write` za čitanje → `settings.read`.
- **DRY:** `requireTenantCompany` (bilo 4 kopije, 3 različita ponašanja) i `readUniqueTarget`
  (bilo 2 verzije; jedna je pravila `CONFLICT` umjesto `AUTH_EMAIL_TAKEN`).
- Registar podešavanja sada nosi i validaciju (`coerceSettingValue`) → testira se bez baze;
  `NaN`/`Infinity` više ne prolaze kao brojevi.
- **Testovi:** **102/102** lokalno (16 novih). Matrica **476 fajlova / 119 pregledano (25,0 %)**.
- Prvi run (`41533565788`) pao na **lintu** (`no-unsafe-assignment` u `audit.service.spec.ts` —
  `jest.Mock` generici); spec prepisan bez vlastitog tipa i bez cast-ova, `Logger.prototype` spy
  → **`41534087012` ✅ 6/6**.
- **Za vlasnika:** F-BE-04-10 (nema PostgreSQL RLS) i D-031 dug (transakcioni audit za finansije).

### 2026-11-02 — BE-05 (projekti, faze, dodjele, dokumenti, količine) → segment `done`
- **Nalaz (visoko):** `PATCH /projects/:id/quantities/:qtyId` tražio je samo **vidljivost** projekta;
  `create` je tražio dodjelu. Sada i `patch` zove `assertScopedWrite`.
- **Nalaz (visoko):** `"abc"` kao `plannedQty`/`plannedBudget` stizao je do Prisma `Decimal` → 500.
  Novo `common/utils/decimal.ts` (`parseDecimalString`, `parseNonNegativeDecimal`) → 400 sa imenom polja.
- **Nalaz (srednje):** arhiviran projekat se dalje mogao mijenjati → `409 PROJECT_TERMINAL`.
- **Nalaz (srednje):** `recalcProgress` je radio `1 + 2×N` upita → dva upita + čiste funkcije
  `taskPercent`/`averagePercent` (testovi bez baze).
- **Otvoreno (B8):** `AuditAction` je zatvoren enum bez akcija za izmjenu projekta/dodjele/faze/
  dokumenta/količine → te izmjene se ne audituju; proširenje enuma ide u **BE-08** (migracija).
- **Testovi:** **107/107**. Matrica **490 fajlova / 136 pregledano (27,8 %)**.
- **Incident (zapisano):** prvi run `41535401598` ❌ — zamjena teksta u `quantities.service.ts`
  nije ubacila import (`parseNonNegativeDecimal` nedefinisan → 500 u e2e), a uveden je i duplikat
  `common/utils/decimal.ts` pored postojećeg `decimal-input.ts`. Oba popravljena; **novi lokalni
  gate:** `tsc --noEmit -p tsconfig.build.json | grep -E "TS2304|TS2552"` (hvata nedefinisane
  identifikatore iako Prisma tipovi nisu dostupni).
- **Zeleno:** `106cca5` → **`41536108972` ✅ 6/6**.

### 2026-11-03 — BE-06 (zadaci i dispečing) → segment `done`
- **Nalaz (srednje):** `?status=` je bio slobodan string castan u Prisma enum → `?status=GOTOVO`
  rušilo je upit (500). Sada `@IsIn(TASK_STATUSES)` → 400; cast u servisu uklonjen.
- **Nalaz (srednje):** duplikat dodjele, duplikat zavisnosti i duplikat u `assigneeIds` vraćali su
  **500** (unique constraint). Sada `409` (dodjela/zavisnost) i deduplikacija niza.
- **Nalaz (srednje):** odluka o statusu zadatka bila je ugrađena u `syncTaskStatus` bez testa →
  čista `nextTaskStatus()` + 6 testova (terminalni statusi, IN_PROGRESS/PAUSED/ASSIGNED/PENDING).
- Provjera izvršilaca: jedan `findMany` umjesto N upita.
- **Incident:** run `41583755392` crven — `tasks.dto.ts` uvezao tip kroz value import (`isolatedModules`)
  → **TS1484**; popravljeno `type` modifikatorom. Lokalni `tsc` filter je promašio zbog `head -10`
  (ispred su `TS2307` artefakti); sada se skenira bez ograničenja i uz `TS1484`.
- **Testovi:** **113/113**. Matrica **492 fajlova / 147 pregledano (29,9 %)**.
- **Otvoreno:** B8 (audit akcije za zadatke) → BE-08; best-effort notifikacije → BE-16.

### 2026-11-03 — BE-07 (timer i ispravke) → segment `done`
- **Nalaz (visoko):** zatvaranje timera nije bilo atomično — sesija se zatvori, pa minuti na zadatak,
  sati na mašinu, status i progres odvojeno; pad u sredini = **izgubljene zarade**. Sada jedan `$transaction`.
- **Nalaz (srednje):** `pause`/`resume` nisu atomični, a offline replay je imao vlastitu kopiju logike →
  `pauseSession`/`resumeSession` (transakcija) dijeljene između HTTP i sync puta.
- **Nalaz (srednje):** `/timer/me`, `start`, `pause`, `resume`, `stop` i `GET /timer` vraćali su sirove redove
  (`companyId`, `deviceId`, u nadzoru i **tuđe** `deviceId`/`localId`) → `serializeTimerSelf` / `serializeCrewTimer`
  (potonji daje `elapsedMinutes`); sync pull zadržava puni `serializeTimer`.
- **Nalaz (srednje):** ispravke TIMER/TRIP/FUEL nisu bile atomične sa zapisom ispravke → transakcija.
- **Nalaz (nisko):** cron je čitao `timer.maxOpenHours` po sesiji → keš po firmi; `?entityType=` u listi ispravki
  je bio slobodan string → `@IsIn`; `findByLocalId` je koristio `companyId ?? ''` → `requireCompany`.
- **Provjereno i odbačeno:** sumnja na cross-tenant curenje u `GET /amendments` — `where` je bio u oba upita.
- **Testovi:** **122/122** (+9). Matrica **494 fajla / 165 pregledano (33,4 %)**.
- **B-stavka:** parcijalni unique indeks za otvorene timere (korisnik, mašina) → **BE-08**.

### 2026-11-03 — BE-08 (seed, migracije, demo podaci) → segment `done`
- **Nalaz (visoko):** 51 strani ključ bez vodećeg indeksa (Postgres ih ne indeksira sam) → `@@index` u šemi
  + `CREATE INDEX` u novoj migraciji `20261103120000_be08_indexes_audit`; baseline ispražnjen.
- **Nalaz (visoko, B8):** `AuditAction` je bio zatvoren enum → izmjene projekta, dodjele, faze, dokumenta,
  količine, zadatka, priloga i zavisnosti **nisu audituju**. Sada 19 novih akcija + pozivi u 8 servisa.
- **Nalaz (srednje, F-BE-07-09):** dva otvorena timera ista osoba/mašina moguća pri trci → parcijalni
  unique indeksi (`WHERE "closedAt" IS NULL`); aplikacija već mapira P2002 na 409.
- **Nalaz (visoko, P9):** seed je u produkciji punio demo firmu i poznate lozinke → `SEED_DEMO` prekidač
  (default `false` = samo `platform@gradix.local`); CI e2e i Playwright postavljaju `true`.
- **Incident:** run `41585836789` — migracija, seed i e2e ✅, ali Docker gate je padao jer je tražio
  ≥2 korisnika nakon produkcijskog seeda. Gate sada provjerava oba režima (1 korisnik + rola
  `PLATFORM_ADMIN` bez `SEED_DEMO`; ≥2 sa `SEED_DEMO=true`).
- **Testovi:** **124/124** (+2 env). Matrica **495 fajlova / 170 pregledano (34,3 %)**.
- ⚠️ **Za vlasnika prije produkcijske migracije:** provjeriti duple otvorene timere (SQL u `AUDIT/segments/BE-08.md` §8)
  i odlučiti koje zatvoriti — to je izmjena stvarnih podataka.

## Šta je sljedeće (tačan sljedeći korak)

1. Push + provjera CI (mora biti zelen) — run se upisuje u ovu tabelu.
2. **BE-09** (flota i IoT) — sljedeći segment po planu.
3. Prenesene odluke: F-BE-01-07 + F-BE-01-10 (indeksi → **jedna BE-08 migracija**),
   F-BE-01-08 (`User.email` globalno unique — ostaje do novih dokaza), F-BE-02-07 (reset preko
   emaila = zaseban segment).
4. Nakon svakog segmenta: kratak izvještaj u chatu; bez PR-ova.

## Otvorena pitanja / blokatori

Nema blokatora za FAZU 3/4. **Za izvršavanje segmenata treba odgovoriti Q1–Q5**
(`AUDIT/02_MASTER_AUDIT_PLAN.md` §8):
- **Q1** — paleta: dva predloga (A: „Gradix Green“; B: „Slate/Teal“) za FE-01.
- **Q2** — SMTP: uključiti pravu dostavu ili ukloniti lažni „success“ (BE-16).
- **Q3** — Redis: zadržati (rate-limit/cache) ili ukloniti (INF-07).
- **Q4** — budžet bundle-a: 250 kB gzip kao granica (FE-06).
- **Q5** — pod pokrivenosti testova: 40 % kao početni prag (TEST-01/CI-04).
