# AUDIT/STATE.md — živi dnevnik

> Pravilo: ovaj fajl se ažurira u **svakom** commitu.

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; radi se direktno na grani.

## Trenutna faza / segment / korak

**FAZA 2–4 ✅ završene; KAPIJA 1 i KAPIJA 2 ✅ prošle.** Vlasnik je dao blanket odobrenje
(„Postupi po svojoj preporuci sve i nastavi dalje“), pa se segmenti izvršavaju **kontinuirano**, uz
kratak izvještaj poslije svakog. Trenutno: **46/59 segmenata `done`** (zadnji potvrđeni: FE-16); CI-02 i CI-05 su `in-progress`.

**Napomena vlasnika (2026-11-04):** na **mobile se ne prelazi** dok backend i frontend nisu kompletno
završeni; prethodno treba pregledati i naknadno dodane BE/FE fajlove u već zatvorenim segmentima.

## Zadnji commit i CI

| | |
|---|---|
| Zadnji commit | `test(audit): tenant i permission guardovi` — CI-05 djelimičan pregled; CI 41811628843 6/6 · prije: `fix(audit): kalendarski overflow datuma` — CI-05 djelimičan pregled i regresijski testovi · prije: `ci: CI-02` — ručno pokretanje sa izborom posla (`suite`/`verbose`/`tag`), `run-name` i `if:` na svih šest poslova — `in-progress` (dispatch nije potvrđen) · prije: `feat(fe): FE-16` — UI primitive: mjerljiv kontrast taba, prevedene oznake, fokusabilni regioni tabela i skrola (D-056) — `done` · prije: `feat(fe): FE-15` — zajednički sloj: mrežne greške kao `ApiError`, jedno mjesto za odjavu (`clearSession`), otporna pohrana, pošten CSV, paritet prijevoda (D-055) — `done` · prije: `feat(fe): FE-14` — javni sajt: stanja umjesto bijelog ekrana, SEO meta + `<html lang>`, otporni javni API i validne postavke prikaza (D-054) — `done` · prije: `feat(fe): FE-13` — administracija: forma samo nad učitanim podacima, status naloga, reaktivacija, prevedene postavke (D-052) — `done` · prije: `feat(fe): FE-12` — obračun i ERP: sati umjesto minuta, prevedeni statusi/kategorije, upit po tabu, stanja i labele (D-051) — `done` · prije: `feat(fe): FE-11` — ured: tenderi/servis/izvještaji, naziv mašine umjesto CUID-a, prevedena zaglavlja (D-049) — `done` · prije: `feat(fe): FE-10` — dnevnik/HSE/dokumenti: stanje roka, prava na akcije, pristupačan kalendar (D-048) — `done` · prije: `feat(fe): FE-09` — flota i logistika: prevedeni enumi, `formatHours`, tekstualna lista uz mapu (D-047) — `done` · prije: `feat(fe): FE-08` — projekti/zadaci: prevedeni enumi (D-046), stanja lista, paginacija, dt/dd — `done` · prije: `feat(fe): FE-07` — auth ekrani: AuthCard (jedno h1), greške uz polja, trajni alert za 429, pošten /reset, prekidač lozinke — `done` · prije: `test(fe): FE-06` — 16 Playwright testova (admin tok, radnik + timer, guardovi), jedna sesija po fajlu — `done` · prije: `test(fe): FE-06` — dashboard — 16 Playwright testova u 4 fajla (admin tok, radnik + timer, guardovi) + trace/retry dijagnostika — `done` · prije: `test(fe): FE-05` — testna okosnica (Vitest + Testing Library, jsdom, D-044), 28 testova, coverage ratchet, CI korak; usput ispravljen netačan FE-04 nalaz i konsolidovan `dash` i18n — `done` |
| CI | ✅ [41813089935](https://github.com/mudzy992/gradix/actions/runs/41813089935) — 6/6 (CI-05 docs) · ✅ [41812237273](https://github.com/mudzy992/gradix/actions/runs/41812237273) — 6/6 (Bell) · ✅ [41811628843](https://github.com/mudzy992/gradix/actions/runs/41811628843) — 6/6 (tenant guardovi + auth E2E) · ✅ [41811142444](https://github.com/mudzy992/gradix/actions/runs/41811142444) — 6/6 (kalendarski datumi) · ✅ [41809716135](https://github.com/mudzy992/gradix/actions/runs/41809716135) — 6/6 (CI-05 prototip) · ✅ [41807406907](https://github.com/mudzy992/gradix/actions/runs/41807406907) (CI-02 docs) · ✅ [41807005307](https://github.com/mudzy992/gradix/actions/runs/41807005307) — 6/6 (CI-02 push) · ✅ [41802676126](https://github.com/mudzy992/gradix/actions/runs/41802676126) (FE-16 docs) · ✅ [41802398309](https://github.com/mudzy992/gradix/actions/runs/41802398309) — **6/6** (`feat(fe): FE-16`, Frontend unit 334, Web E2E 31 — prvi pokušaj zelen) · prije: ✅ [41799751936](https://github.com/mudzy992/gradix/actions/runs/41799751936) — **6/6** (`docs(audit): FE-15 …`) · prije: ✅ [41799476716](https://github.com/mudzy992/gradix/actions/runs/41799476716) — **6/6** (`feat(fe): FE-15`, Frontend unit 301, Web E2E 31 — prvi pokušaj zelen) · prije: ✅ [41795078702](https://github.com/mudzy992/gradix/actions/runs/41795078702) — **6/6** (`docs(audit): FE-14 …`) · prije: ✅ [41794830116](https://github.com/mudzy992/gradix/actions/runs/41794830116) — **6/6** (`feat(fe): FE-14`, Web E2E 31 test — prvi pokušaj zelen) · prije: ✅ [41793092550](https://github.com/mudzy992/gradix/actions/runs/41793092550) — **6/6** (`docs(audit): FE-13 …`) · prije: ✅ [41792792936](https://github.com/mudzy992/gradix/actions/runs/41792792936) — **6/6** (`feat(fe): FE-13` + D-053, Web E2E 28 testova) · prije: ✅ [41789352928](https://github.com/mudzy992/gradix/actions/runs/41789352928) — **6/6** (`docs(audit): FE-12 …`) · prije: ✅ [41789093535](https://github.com/mudzy992/gradix/actions/runs/41789093535) — **6/6** (`feat(fe): FE-12`, Web E2E 26 testova) · prije: ✅ [41783115547](https://github.com/mudzy992/gradix/actions/runs/41783115547) — **6/6** (`docs(audit): FE-11 …`) · prije: ✅ [41782885474](https://github.com/mudzy992/gradix/actions/runs/41782885474) — **6/6** (`feat(fe): FE-11` + D-050, Web E2E 24 testa) · prije: ✅ [41779976740](https://github.com/mudzy992/gradix/actions/runs/41779976740) — **6/6** (`feat(fe): FE-10`, Web E2E 23 testa) · prije: ✅ [41737320120](https://github.com/mudzy992/gradix/actions/runs/41737320120) — **6/6** (`feat(fe): FE-09`, Web E2E 22 testa) · prije: ✅ [41735868494](https://github.com/mudzy992/gradix/actions/runs/41735868494) — **6/6** (`feat(fe): FE-08` + popravke; Web E2E 21 test) · prije: ✅ [41732607216](https://github.com/mudzy992/gradix/actions/runs/41732607216) — **6/6** (`feat(fe): FE-07`) · prije: ✅ [41730661179](https://github.com/mudzy992/gradix/actions/runs/41730661179) — **6/6** (`test(fe): FE-06 …` + popravke; Web E2E sa 16 testova) · prije: ✅ [41724035626](https://github.com/mudzy992/gradix/actions/runs/41724035626) — **6/6** (`test(fe): FE-05 …`, job `Frontend (lint + typecheck + test + build)`) · prije: ✅ [41714214228](https://github.com/mudzy992/gradix/actions/runs/41714214228) (FE-04 zapis) · ✅ [41713747923](https://github.com/mudzy992/gradix/actions/runs/41713747923) — **6/6** (FE-04) · ✅ [41712142337](https://github.com/mudzy992/gradix/actions/runs/41712142337) — **6/6** (D-041/D-042) · ✅ [41708189041](https://github.com/mudzy992/gradix/actions/runs/41708189041) (probe log) · ✅ [41703994353](https://github.com/mudzy992/gradix/actions/runs/41703994353) (FE-03) · ✅ [41696920558](https://github.com/mudzy992/gradix/actions/runs/41696920558) (FE-02) · ✅ [41693498226](https://github.com/mudzy992/gradix/actions/runs/41693498226) (FE-01) · drill [41666523647](https://github.com/mudzy992/gradix/actions/runs/41666523647) ✅ |
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

### 2026-11-03 — BE-09 (flota i IoT) → segment `done`
- **Nalaz (visoko):** `MachineAssignment` nije imao unique → mašina je mogla biti **istovremeno na dva
  projekta** (P2002 grana u `assign` bila mrtva). Sada pre-provjera → `409` + parcijalni unique indeks
  u migraciji `20261103140000_be09_machine_open_assignment`.
- **Nalaz (visoko):** koordinate se **nisu** provjeravale po opsegu — `lat: "999"` je prolazio iz IoT
  uređaja, telefona i u „nearby“ upitu. `common/utils/geo.ts` (`parseLatLng`) + 6 testova.
- **Nalaz (srednje):** GPS tačka i pozicija mašine nisu atomične → jedna `$transaction`; isto za
  `assign`/`unassign`/`decommission` (dva reda bez transakcije).
- **Nalaz (nisko):** mašina `IN_SERVICE` se mogla dodijeliti projektu (status se tiho mijenjao u ACTIVE)
  → `409 MACHINE_IN_SERVICE`; `unassign` više ne pregazi status „u servisu“.
- **Testovi:** **130/130** (+6). Matrica **498 fajlova / 190 pregledano (38,2 %)**.
- **B-stavka:** `AuditAction` za flotu i GPS uređaje → sljedeća migracija.
- ⚠️ **Za vlasnika prije produkcijske migracije:** provjeriti dvostruke otvorene dodjele mašina (SQL u
  `AUDIT/segments/BE-09.md` §8). Demo seed ne pravi dodjele → na svježoj bazi nema rizika.

### 2026-11-03 — BE-10 (logistika: ture, gorivo, šifarnici) → segment `done`
- **Nalaz (visoko):** `PATCH /fuel/:id` mijenjao litre/cijenu **bez `recalcSpend`** → `currentSpend`
  pogrešan (novac). Sada upis + obračun u jednoj transakciji, stari **i** novi projekat.
- **Nalaz (visoko):** isti `PATCH` primao `projectId` bez provjere vidljivosti/zapisivosti ni poklapanja
  sa dodjelom mašine → moguće prebaciti trošak na tuđi projekat. Sada isti `resolveProjectId` kao create.
- **Nalaz (srednje):** off-line replay je radio `create` pa `update` sa `localId/deviceId` — pad između
  je pravio duplikat pri ponovnom sync-u. Sada identitet u istom upisu (obrazac iz BE-07).
- **Nalaz (srednje):** koordinate tura i depoa nisu validirane → `parseOptionalLatLng` (oba ili nijedan).
- **Nalaz (srednje):** izmjena depoa: prazan `qrToken` prolazio, duplikat bio 500 → `400`/`409`.
- **Nalaz (srednje, odluka vlasnika):** `isSynced` je uvijek `true` → `PATCH/DELETE /trips` uvijek `403`,
  `/fuel` uvijek `409`. Rute su mrtve; opcije A/B/C u `AUDIT/segments/BE-10.md` §8.
- **Testovi:** **133/133** (+3). Matrica **498 fajlova / 205 pregledano (41,2 %)**.
- **B-stavke:** B9 (mrtve rute — odluka vlasnika), B10 (audit akcije za flotu i logistiku).

### 2026-11-03 — BE-10 dopuna: B9 (opcija A) + B10
- **Odluka vlasnika (B9 → opcija A):** mrtve rute **uklonjene**; zapis ture/goriva ostaje nepromjenjiv.
  - API: `PATCH/DELETE /api/trips/:id` i `PATCH/DELETE /api/fuel/:id` **više ne postoje** (`404`).
    Ispravke idu kroz `/amendments` (`TRIP`, `FUEL`, `TIMER`).
  - Kod: `trips.controller/fuel.controller` (rute), `TripsService.patch/remove`, `FuelService.patch`,
    `PatchTripDto`/`PatchFuelDto`, `assertSyncedImmutable` — sve obrisano. Bez mrtvog koda i bez
    održavanja putanje koja se ne može izvršiti (F‑BE‑10‑01/02/04 time postaju nevažeći).
  - `fleet.e2e-spec.ts`: test nepromjenjivosti sada čeka **`404`** (umjesto `403 TRIP_IMMUTABLE`).
  - Provjereno: `frontend` i `mobile` **nikad** nisu zvali te rute → nema klijentske regresije.
- **B10 (audit za flotu i logistiku):** `AuditAction` +17 vrijednosti
  (`MACHINE_CREATED/UPDATED/ASSIGNED/UNASSIGNED/DECOMMISSIONED`, `IOT_DEVICE_CREATED/UPDATED/ROTATED`,
  `TRIP_CREATED/COMPLETED`, `FUEL_CREATED`, `MATERIAL_CREATED/UPDATED/REMOVED`,
  `DEPOT_CREATED/UPDATED/REMOVED`) u migraciji `20261103160000_be10_fleet_audit_actions`
  (`ALTER TYPE … ADD VALUE`, PG ≥ 12 dozvoljava u transakciji).
  - Pozivi: `machines.service.ts` (5), `gps-devices.service.ts` (3), `trips.service.ts` (2),
    `fuel.service.ts` (1, **prije** notifikacije o anomaliji da se ne izgubi zapis), `catalog.service.ts` (6).
  - Time je zatvorena i B-stavka iz BE-09 (F‑BE‑09‑07: GPS/mašine nisu bili u auditu).
  - Šifarnici: `createDepot` je koristio inline `requireCompany(actor)` (izvučeno u `companyId`
    const radi audita), a `patchMaterial` je bio `return prisma.material.update(...)` — sada
    `const row = await …` + audit + `return row`.
  - `removeMaterial`/`removeDepot` pišu audit **poslije** brisanja: pad brisanja (FK) ne smije
    ostaviti zapis da je zapis uklonjen.
  - **E2E dokaz:** novi test u `fleet.e2e-spec.ts` prolazi kroz mašinu, GPS uređaj, materijal, depo,
    turu i gorivo pa čita `AuditEvent` direktno iz baze (API za audit još ne postoji).
- **Testovi:** **133/133**. Matrica **499 fajlova / 206 pregledano (41,3 %)**; `check:all` 9/9 (bez e2e).
- **Stanje segmenata:** `done` **21/59**; sljedeći **BE-14**.

### 2026-11-03 — BE-11 (dnevnik, HSE, fajlovi)
- **Nalaz (visoko):** PDF dnevnika je padao (`500`) na svakom tekstu sa `č`/`ć`/`đ` — WinAnsi font
  ne kodira ta slova. Sada `toWinAnsi` (preslovljavanje) + `wrapLines` (prelamanje po širini fonta).
- **Nalaz (srednje):** svako polje PDF-a se sjeklo na **110 znakova**, a `\n` se gubio — opis radova
  je tiho nestajao. Sada višeredni tekst i nove stranice; ispisuje se i lista fotografija.
- **Nalaz (srednje):** `POST /api/diary/:id/pdf` je tražio samo vidljiv projekat, **ne** `diary.read`
  → radnik je mogao izvući PDF. Sada `assertDiaryRead` + company scope.
- **Nalaz (srednje):** offline dnevnik nije bio idempotentan (`localId` bez `deviceId`, `create`+`update`)
  → replay je davao `DIARY_CONFLICT`. Sada `deviceId` u istom upisu + provjera prije upisa.
- **Nalaz (srednje):** `tempMin/tempMax` bez validacije (`abc` → 500), koordinate fotografije/incidenta
  bez opsega i „samo lat“, `?status=` incidenta cast-ovan u enum (500), `taskId` incidenta mogao biti
  tuđi → sada `400` (`parseDiaryTemp`, `parseOptionalLatLng`, `@IsIn`, scoping zadatka).
- **Nalaz (srednje):** download fajla bez `Content-Type`/`Content-Length` (browser dobija
  `octet-stream`), greška streama ostavlja odgovor da visi → `statObject` + headeri + `destroy`.
- **Nalaz (nisko):** notifikacije (dnevnik konflikt, HSE) su mogle pretvoriti uspješan upis u `500` →
  best-effort (D‑031); duplikat fotografije na replay → dedupe po `path`.
- **Testovi:** **141/141** unit (+8). Matrica **501 fajl / 224 pregledano (44,7 %)**; `check:all` 0 padova.
- **B-stavke:** **B11** — dnevnik/HSE/fajlovi nisu u auditu (sljedeća migracija).
- **Odluka vlasnika (opcija A):** prijavljivač vidi **svoje** HSE prijave. `hse.read` = domen
  (firma/dodijeljeni projekti), `hse.write` bez `hse.read` = samo vlastite prijave (+ ACK/CLOSE);
  tuđa prijava `404`. Zapisano kao **D‑033**; e2e test „WORKER list 403“ zamijenjen testom koji
  dokazuje scopiranje.
- **CI ispravka (run 41638725137 ❌):** e2e je padao jer radnik nije bio dodijeljen projektu, pa je
  `POST /api/incidents` vraćao `404` (vidljivost projekta) — u testu je dodana dodjela radnika
  („WORKER“) na projekat; kod nije mijenjan.
- **Zatvoreno:** `BE-11` — zelen CI **41636860530** (6/6) i **41639119312** (6/6, opcija A); 19/59 segmenata `done`.

### 2026-11-03 — BE-12 (dashboard i prisustvo)
- **Nalaz (srednje):** korisnik sa **više rola** dobijao je pogrešan dashboard (grane „prva koja
  upali“: `WORKER` prije `DRIVER`/`PM`). Sada `resolveDashboardView`: firma → PM/SS → DRIVER →
  WORKER/MACHINE_OPERATOR → MECHANIC; 5 unit testova (**D‑034**).
- **Nalaz (srednje):** prisustvo je vuklo **sve** GPS zapise firme u 30 min (100 ljudi × ping 15 s ≈
  12.000 redova) i dedupiralo u JS-u. Sada `DISTINCT ON (userId)` (`latest-locations.ts`) na indeksu
  `(companyId, userId, recordedAt)`; e2e provjerava da dashboard vraća prisutne.
- **Nalaz (srednje):** `GET /projects/:id/presence` je prikazivao bilo koga iz firme unutar geofence-a
  (i skenirao cijelu firmu). Sada samo **dodijeljeni** projektu; e2e: admin nije na listi projekta,
  ali jeste na dashboardu.
- **Nalaz (srednje):** **istekli** dokumenti su nestajali sa dashboarda (`daysLeft < 0` → filtriran);
  sada ostaju do 90 dana unazad (negativan `daysLeft`), uz cap 100 i `max` izvan petlje.
- **Nalaz (nisko):** mrtav kod — kartica `spend: null` koja se nikad nije dodala.
- **Testovi:** **158/158** unit (+17). Matrica **506 fajlova / 238 pregledano (47,0 %)**.
- **Otvoreno:** geofence notifikacija ide samom korisniku i piše se sinhrono u GPS ping (BE-16).
- **Zatvoreno:** `BE-12` — zelen CI **41640541231** (6/6), prvi pokušaj; 20/59 segmenata `done`.

### 2026-11-03 — BE-13 (payroll) + B11 (audit dnevnika/HSE)
- **Nalaz (visoko):** odluka o sesiji **nije bila atomska** (`findFirst` provjera → `update`). Dva
  paralelna zahtjeva (odobri/odbij) oba prođu provjeru; drugi pregazi prvog, a oba ostanu u auditu.
  Sada `updateMany` sa uslovom `approvalStatus='PENDING'` → druga odluka je `409 CONFLICT`.
- **Nalaz (visoko, **B12** — nije popravljeno):** iznos se računa **trenutnom** satnicom korisnika, pa
  povišica retroaktivno mijenja već odobrene mjesece. Preporuka: `hourlyRateSnapshot` na
  `TimerSession` + odluka vlasnika koji trenutak je mjerodavan (početak rada vs odobravanje).
- **Nalaz (srednje):** `parseDateOnly` je tiho prebacivao nepostojeće datume (`2026-02-31` → 3. mart)
  — za platni period to je pogrešan mjesec, za dnevnik pogrešan dan. Sada `400`; testirano.
- **Nalaz (srednje):** period bez gornje granice (`from=2000&to=2030`) vukao je sve sesije u memoriju;
  sada `PAYROLL_MAX_SPAN_DAYS = 366` → `400`. `year` van 1970–2999 → `400` (prije 500).
- **Nalaz (srednje):** pad notifikacije/e-maila poslije odbijanja davao je `500` za uspješnu odluku →
  best-effort (D‑031).
- **Nalaz (nisko):** export se uvijek zvao `payroll.xlsx` → sada `payroll-{from}_{to}.xlsx`.
- **B11 zatvoren:** 6 audit akcija (`DIARY_CREATED/UPDATED/PHOTO_ADDED/PDF_GENERATED`,
  `INCIDENT_CREATED/STATUS_CHANGED`) + migracija `20261103180000_be13_diary_hse_audit_actions`;
  e2e čita `AuditEvent`.
- **Svjesno ostaje:** PM/SS mogu odobravati ali ne i `summary`/`export` (`payroll.read` je odvojen);
  sesija bez trajanja ulazi kao 0 min.
- **Testovi:** **165/165** unit (+7). Matrica **508 fajlova / 252 pregledano (49,6 %)**.
- **Zatvoreno:** `BE-13` — zelen CI **41644091684** (6/6), prvi pokušaj; 21/59 segmenata `done`.
- **CI ispravke (run 41635959404 ❌):** (1) `files.service.ts` — `minio` tipizira `metaData` kao `any`,
  pa je lint tražio eksplicitno svodjenje na `Record<string, string | undefined>`; (2) e2e je čitao
  `data.user.company.id` sa `/api/me`, a taj endpoint vraća `data.company.id` (login vraća drugu
  strukturu). Oba popravljena u istom danu; novi run se upisuje ispod.
- **CI ispravka (run 41636435039 ❌ samo Audit):** matrica je bila zastarjela poslije zadnjih
  izmjena (`loc` se promijenio) → `inventory.mjs` ponovo pokrenut; kod i e2e su bili zeleni.

### 2026-11-03 — BE-14 (ERP-lite) + B12 (istorijska satnica, D‑035)
- **Odluka vlasnika (B12 → opcija A):** mjerodavna je satnica iz trenutka **rada/zatvaranja** sesije;
  plate se ne mijenjaju unazad. Zapisano kao **D‑035** (odbačene alternative: satnica na mjesečnom
  nalogu; retroaktivni preračun uz audit).
- **B12 zatvoren:** `TimerSession.hourlyRateSnapshot Decimal?(10,2)`; upis u **jedinoj** tački
  zatvaranja (`TimerForceCloseService.closeSession`) unutar postojeće transakcije → pokriva stop,
  force, auto-close i offline replay. Svi putevi iznosa koriste `payrollRate()` =
  `snapshot ?? user.hourlyRate` (`payroll-summary`, `serialize-payroll`, `erp/from-payroll`);
  `null` (stari redovi) pada na trenutnu satnicu, bez backfilla.
- **Nalaz (visoko):** zalihe su bile **check-then-insert** (`stockBalance` → `create`) — dva paralelna
  izlaza oba prođu provjeru i stanje ode u minus. Sada provjera + upis u jednoj SERIALIZABLE
  transakciji; `stock-balance.ts` prima `TransactionClient`.
- **Nalaz (srednje):** `apply-stock` je pod paralelizmom padao na unique `fuelEntryId` (`P2002` → 500).
  Sada se `P2002` prevodi u pobjednika trke (`200`, postojeći pokret); e2e: 3 paralelna zahtjeva →
  `[200, 200, 201]` i tačno 1 pokret.
- **Nalaz (visoko):** `DELETE /api/cost-entries/:id` — jedina destruktivna ERP operacija **bez audita**,
  a mijenja `Project.currentSpend`; `delete` + `recalcSpend` nisu bili atomični. Sada transakcija +
  `COST_ENTRY_REMOVED` sa `amount/category/date/source/sourceId/projectId` u `payload`.
- **Nalaz (srednje):** partneri i skladišta nisu imali **nikakav** audit → `PARTNER_CREATED`,
  `PARTNER_UPDATED`, `WAREHOUSE_CREATED`.
- **Migracija** `20261103190000_be14_payroll_snapshot_erp_audit` (kolona + 4 `ALTER TYPE … ADD VALUE`;
  aditivno, bez backfilla) — **šesta** migracija.
- **Svjesno ostaje:** liste troškova bez filtera perioda (`from`/`to`) — F‑BE‑14‑06, kandidat za FE.
- **Testovi:** **170/170** unit (+5, novi `payroll-amount.spec.ts`); e2e +3 (`erp`) +1 (`payroll`).
  Matrica **510 fajlova / 268 pregledano (52,5 %)**.
- **Zatvoreno:** `BE-14` — zelen CI **41648114505** (6/6); **22/59** segmenata `done`.

### 2026-11-03 — BE-15 (Ured: tenderi, servis, dokumenti, izvještaji)
- **Nalaz (visoko):** životni ciklus servisa nije bio atomski — start i complete/cancel su bili
  „provjeri pa upiši“ kroz 2–3 upisa; dva paralelna klika daju dvije dodjele, a pad između upisa
  ostavlja mašinu u `IN_SERVICE` bez zapisa. Sada je svaki prelaz **atomski claim**
  (`updateMany` + uslov) u transakciji sa promjenom statusa mašine i `recalcSpend`; gubitnik trke
  dobija `409`.
- **Nalaz (visoko):** konverzija tendera je pravila **dva projekta** iz jednog tendera pri duplom
  kliku. Sada transakcija + `updateMany({ status: 'WON', convertedProjectId: null })` claim;
  e2e: tri paralelna klika → `[201, 409, 409]`, tačno 1 projekat i 1 `TENDER_CONVERTED`.
- **Nalaz (srednje):** ured nije imao **nikakav** audit (tenderi, šabloni servisa, dokumenti) →
  12 novih akcija + migracija `20261103210000_be15_office_audit_actions` (**sedma**).
- **Nalaz (srednje):** `ServicesService.create` je primao `projectId`/`templateId` bez provjere
  firme (cross-tenant referenca) → `400 Invalid projectId`.
- **Nalaz (srednje):** `machine-hours` izvještaj **nije bio scopiran** — PM je vidio sate mašina sa
  svih projekata firme; sada `task.projectId in (scope)`. Ostali izvještaji su bili scopirani.
- **Nalaz (srednje):** period izvještaja bez granica (`from > to` tiho prazno, `2024→2026` u
  memoriju) → `400` preko `assertPeriodSpan` (366 dana); export više nije `{slug}.xlsx` nego
  `report-<slug>-<from>_<to>.xlsx`.
- **Nalaz (srednje):** `expiresAt` je neispravan datum **tiho** pretvarao u `null` (dokument bez
  roka izgleda kao trajan), a `submittedAt` je davao `500` → `common/utils/date-input.ts`
  (`parseIsoDateTime`, striktno, `400`) + 5 unit testova.
- **Nalaz (srednje):** pad notifikacije u servis cronu prekidao je cijeli prolaz → best-effort
  (D‑031). Trka dva procesa na `SCHEDULED` ostaje dokumentovana (1 replika).
- **Nalaz (nisko):** docs cron je za svaki dokument učitavao sve notifikacije firme → jedan upit po
  firmi; GPS cleanup briše u serijama po 10.000.
- **Testovi:** **180/180** unit (+10: `date-input.spec.ts`, `tender-status.spec.ts`);
  e2e `polish` +5. Matrica **514 fajlova / 292 pregledano (56,8 %)**.
- **Zatvoreno:** `BE-15` — zelen CI **41652116613** (6/6, prvi pokušaj); **23/59** segmenata `done`.

### 2026-11-03 — BE-16 (javni sajt, notifikacije, email, realtime) + B1
- **Nalaz (visoko, B1):** `EmailService.trySend` je vraćao `true` kad je `features.email` uključen,
  a **nije slao ništa**; `smtpCalls` je bio lažni dokaz. Sada po **D‑013** uvijek vraća `false` uz
  `logger.warn`/`debug` — nijedan tok ne prijavljuje uspjeh koji se nije desio. Pravi SMTP + reset
  token model ostaje zaseban posao (`POST /auth/reset` = `501`).
- **Nalaz (srednje):** gateway CORS je bio `origin: true` (reflektuje svaki origin) — sada
  `resolveCorsOrigin(NODE_ENV, CORS_ORIGIN)`, isto pravilo kao REST (D‑018).
- **Nalaz (srednje):** `joinCompanyWideToProject` je prolazio kroz **sve** socket-e procesa
  (`fetchSockets`) pri svakom novom projektu → sada soba `companywide:{id}` + jedan `socketsJoin`.
- **Nalaz (srednje):** `POST /public/assets` je uploadovao fajl **prije** provjere projekta →
  orphan fajl + `PublicAsset`. Sada validacija ide prva (`404`); e2e provjerava da broj asseta ostaje isti.
- **Nalaz (nisko):** N+1 upisa u `notifyRoles` → `createForUsers` (`createManyAndReturn`); javna
  slika sada nosi `Content-Length`/`nosniff`/CSP i ima `error` handler; deaktivirana firma se
  diskonektuje; uklonjen mrtav `join` handler.
- **Svjesno ostaje:** `POST /auth/forgot` vraća `200` bez slanja (anti-enumeracija, dokumentovano).
- **Testovi:** **186/186** unit (+6: `email.service.spec.ts`, `serialize-public.spec.ts`);
  e2e `public` +1 i `polish` zamijenjen test emaila. Matrica **516 fajlova / 311 pregledano (60,3 %)**.
- **Zatvoreno:** `BE-16` — zelen CI **41653715576** (6/6, prvi pokušaj); **24/59** segmenata `done`.

### 2026-11-03 — BE-17 (sync, serverska strana)
- **Nalaz (visoko):** `POST /sync/push` nije imao granicu broja itema → `@ArrayMaxSize(200)`
  (`SYNC_PUSH_MAX_ITEMS`); mobilni engine reže red na 200 da dugi offline red ne dobije `400`.
- **Nalaz (visoko):** `lastSyncTimestamp` je bio `new Date()` — red upisan između upita i odgovora
  imao je manji `updatedAt` i klijent ga **nikad** nije dobio. Sada `pullWatermark()` = najmanji
  zadnji `updatedAt` među kolekcijama koje su nešto vratile (D‑036); `serverTime` ostaje trenutak
  odgovora.
- **Nalaz (visoko):** paralelni replay istog `localId` rušio je **cijeli** batch `500` (`P2002`).
  Sada `dispatchIdempotent()` ponavlja dispatch jednom, a `mapPrismaError()` daje per-item
  `409`/`404`; nepoznate greške i dalje `500`.
- **Nalaz (srednje):** `pull` bez `take` (sve od `since`) → **1000** po kolekciji
  (`SYNC_PULL_LIMIT`); `since` u budućnosti je `400` (prije je klijent trajno ostajao bez podataka).
- **Nalaz (nisko):** katalog je vraćao sirove `materials` (`companyId`, vremenske oznake) →
  whitelist; neograničen katalog **prihvaćen** (offline rad traži cijeli šifarnik), prag ~2 MB za
  buduću odluku.
- **Svjesno ostaje:** `PHOTO` prije `DIARY` = `404 'Diary entry not synced yet'` (klijent ponavlja);
  push je sekvencijalan i prekida se na **nepoznatoj** grešci.
- **Testovi:** **190/190** unit (+4: `sync-watermark.spec.ts`); e2e `sync` +3 (limit batch-a,
  watermark, paralelni replay).
- **Matrica:** **518 fajlova / 321 pregledano (62,0 %)**; `check:all` 15 koraka / 0 palo (5 preskočeno).
- **Zatvoreno:** `BE-17` — **25/59** segmenata `done` (CI upisan u tabeli iznad).### 2026-11-03 — BE-18 (health API ugovor)
- **Nalaz (srednje):** `/api/health` je bio i liveness i readiness (baza na svaki poziv), a na tu
  rutu je vezan Docker `HEALTHCHECK` ⇒ pad baze je pravio restart-loop **žive** aplikacije. Sada je
  liveness bez baze, a `GET /api/health/ready` provjerava bazu i vraća `503` (D‑037).
- **Nalaz (srednje):** nema timeout-a na `SELECT 1` → zaglavljena baza drži zahtjev otvoren;
  sada `HEALTH_PROBE_TIMEOUT_MS = 2 s` (`Promise.race`, timer se čisti).
- **Nalaz (srednje):** pad baze je davao `500 INTERNAL` umjesto `503`; sada servis ne baca, vraća
  `status:'error'` + `error:'unreachable'` (bez hosta/kredencijala), log nosi samo tip greške.
- **Nalaz (nisko):** envelope na infrastrukturnom ugovoru → `@SkipEnvelope()` na obje rute (ravan
  `{status, uptimeSeconds, checks}`); nijedan klijent nije čitao stari oblik (samo `curl`/Docker,
  koji gledaju status kod). Throttle **nije** izuzet (healthcheck = 2/min).
- **Testovi:** **194/194** unit (+4: `health.service.spec.ts`); e2e `health` prepisan (liveness bez
  envelope-a, readiness sa `checks.postgres`).
- **Matrica:** **519 fajlova / 325 pregledano (62,6 %)**; `check:all` 15 koraka / 0 palo (5 preskočeno).
- **Zatvoreno:** `BE-18` — **26/59** segmenata `done` (CI upisan u tabeli iznad).### 2026-11-03 — INF-04 (strukturisano logovanje)
- **Nalaz (visoko):** nije bilo korelacionog ID-a — `500 INTERNAL_ERROR` se nije mogao povezati sa
  zapisom u Coolify logu. Sada `x-request-id` (validan klijentski se prihvata, inače `randomUUID`),
  vraća se u odgovoru, putuje kroz `AsyncLocalStorage` i nosi ga svaki log red (D‑038).
- **Nalaz (srednje):** Nest tekstualni log bez nivoa koji se može filtrirati → `JsonLogger`
  (`LoggerService`) piše jedan JSON red; `LOG_LEVEL` (`error|warn|info|debug`) je validiran env
  (prazno = `info` u produkciji, `debug` u razvoju, `error` u testovima).
- **Nalaz (srednje):** nije bilo zaštite od PII/tajni → `redact()` po imenu ključa (ugniježđeno),
  HTTP linija loguje samo `method/path` (bez query-ja), `status`, `durationMs`; nikad tijelo,
  headeri ni IP. Pravilo u BACKEND §5.1.
- **Nalaz (nisko):** bootstrap greška (`env`/baza) bila je `console.error` → sada JSON red;
  svaki zahtjev dobija `http_request` liniju (5xx = `error` nivo).
- **Zašto bez `pino`:** dvije do tri zavisnosti za isti izlaz; D‑038, alternativa ostaje otvorena.
- **Testovi:** **206/206** unit (+12: logging 11, env 1); e2e `health` +1 (`x-request-id`).
- **Guardrail:** `check:env` 88 varijabli (nova `LOG_LEVEL` u `.env.example` i `.env.coolify`);
  dug **I1** (nema strukturisanog logovanja) zatvoren.
- **Matrica:** **526 fajlova / 332 pregledano (63,1 %)**; `check:all` 15 koraka / 0 palo.
- **Zatvoreno:** `INF-04` — **27/59** segmenata `done` (CI upisan u tabeli iznad).### 2026-11-03 — INF-05 (readiness ugovor)
- **Nalaz (srednje):** readiness je provjeravao samo bazu, pa je instanca bila „spremna“ i kad MinIO
  ne radi (upload puca) i kad migracije nisu primijenjene. Sada `GET /api/ready` provjerava
  **Postgres + MinIO (`bucketExists`) + migracije** (`_prisma_migrations` vs folderi u slici).
- **Nalaz (srednje):** „deploy još migrira“ nije bio vidljiv → `applied < expected` = `pending` =
  `503`; `expected=null` (nema foldera u slici) = `unknown` i **ne** obara readiness. `COUNT(*)`
  (`BigInt`) se pretvara u `number` prije JSON-a.
- **Nalaz (nisko):** putanja nije bila po planu (§4.3) → readiness je na `/api/ready`, liveness
  ostaje `/api/health` (Docker `HEALTHCHECK` se ne mijenja).
- **Nalaz (nisko):** `MinioService` nije imao health metodu (samo interni `ensureBucket` retry) →
  `healthCheck()`; `MemoryMinioService` u e2e dobija istu metodu. `MINIO_SKIP=true` ⇒
  `{status:'ok', detail:'skipped'}` (iskreno, ne lažni uspjeh).
- **Testovi:** **209/209** unit (+3); e2e `health`: `/api/ready` sa tri provjere.
- **Matrica:** vidi tabelu gore; `check:all` 15 koraka / 0 palo.
- **Zatvoreno:** `INF-05` — **28/59** segmenata `done` (CI upisan u tabeli iznad).### 2026-11-03 — INF-06 (backup/restore) — u toku
- Dodate operativne skripte `scripts/ops/backup.sh` (custom-format `pg_dump` + `sha256` + retencija)
  i `scripts/ops/restore.sh` (traži `RESTORE_DATABASE_URL`, odbija isti URL i ime sa `prod`,
  provjerava `sha256`, `pg_restore --exit-on-error`, pa brojevi redova ključnih tabela).
- Novi workflow `.github/workflows/backup-restore.yml` (noćni `schedule` 03:30 UTC + ručni
  `workflow_dispatch`): migracije + seed → backup → restore u `gradix_restore` → poređenje brojeva
  redova i migracija; dump kao artefakt 7 dana.
- Runbook u `docs/INFRASTRUCTURE.md` §7 (RPO ≤ 24 h, RTO ≤ 1 h, šta skripte **ne** pokrivaju:
  MinIO objekti, env izvoz, PITR). Dugovi I2 (readiness) i I3 (backup drill) zatvoreni.
- **Otvoreno:** drill mora proći prvi put (ručno pokretanje) prije nego segment ide u `done`.
### 2026-11-03 — INF-06 (backup/restore) — završeno
- **Nalaz (visoko):** backup je bio pretpostavka (nije bilo skripte, retencije, provjere integriteta
  ni testa restore-a; dug I3). Sada `scripts/ops/backup.sh` (custom-format dump + `sha256` +
  retencija 7) i `scripts/ops/restore.sh` (traži `RESTORE_DATABASE_URL`, odbija isti URL i ime sa
  `prod`, provjerava `sha256`, `--exit-on-error`, pa brojevi redova ključnih tabela).
- **Dokaz:** noćni workflow `.github/workflows/backup-restore.yml` (03:30 UTC + ručno + push na
  aktivnu granu kad se mijenja `scripts/ops/**`): Postgres 16 → migracije + seed → backup →
  restore u `gradix_restore` → poređenje 8 tabela i broja migracija. Zelen drill **41662900597**
  (`User 9, Company 1, Project 1, Task 3`, migracije `7/7`).
- **Nalazi iz drill-a (svi popravljeni):** libpq ne prima Prisma `?schema=public` (`pg_conn()`);
  tabele su quoted Prisma imena (`"User"`, ne `users`); `migration_lock.toml` nije migracija
  (`find -type d`); schedule-only workflow se nije registrovao → `push` + `paths` (CI‑01 pravilo);
  job logovi nedostupni iz sandboka → dijagnostika kroz `::error::` anotacije.
- **Svjesno van obima:** MinIO objekti (`mc mirror` ručni korak), izvoz Coolify env-a, PITR/WAL.
  Runbook: `docs/INFRASTRUCTURE.md` §7 (RPO ≤ 24 h, RTO ≤ 1 h).
- **Zatvoreno:** `INF-06` — **29/59** segmenata `done` (CI upisan u tabeli iznad).


### 2026-11-03 — INF-07 (Redis aktiviran) — završeno
- **Odluka vlasnika:** Redis se aktivira (`redis-core:6380` — TLS port, mreža `redis_net`, TLS sa
  postojećim CA);
  ACL korisnika dodaje vlasnik lično kroz `redis-cli`, lozinku generiše on, prefiks također.
- **Nalaz (visoko):** `REDIS_*` je bila mrtva konfiguracija (I7) — throttle je bio memorijski po
  procesu, pa limit nije važio između replika i resetovao se restartom. Sada
  `backend/src/common/redis/` (`RedisService` + `FailoverThrottlerStorage` + `RedisModule`):
  `INCR`+`PEXPIRE NX`+`PTTL` u `MULTI` nad `<prefix>throttle:<throttler>:<key>`.
- **Fail-open:** prazan `REDIS_HOST` = staro ponašanje (memorijski storage); pad Redisa ⇒ isto, uz
  jedno `warn` logovanje; `/api/ready` prikazuje `checks.redis` ali **ne** vraća `503` zbog njega.
- **ACL:** `scripts/ops/redis-acl.sh` ispisuje `ACL SETUSER <user> reset on ><LOZINKA>
  ~<prefix>* +ping +multi +exec +incr +pexpire +pttl +get +set +del +exists +ttl` — bez `@admin`;
  lozinka ne postoji u repou/logovima. Runbook: `docs/INFRASTRUCTURE.md` §11.
- **Nova zavisnost:** `ioredis@5` uz pisano obrazloženje (D-039); env validacija: host bez lozinke
  = greška pri startu.
- **Zatvoreno:** `INF-07` — **30/59** segmenata `done` (CI upisan u tabeli iznad).


### 2026-11-03 — FE-01 (paleta) — predlozi spremni, čeka odluku vlasnika
- Vlasnik je ranije tražio **oba predloga** prije primjene; izrađeni tokeni za oba seta (svjetla +
  tamna tema) i vizuelni pregled istih komponenti jedan pored drugog:
  `docs/design/palette-preview.html` (interaktivno) + `palette-A.png`, `palette-B.png`,
  `palette-comparison.png`.
- **A „Gradix Green“**: primary `#0F5132`, akcenat amber `#B45309`, topla podloga `#F7F8F6`.
  **B „Slate / Teal“**: primary `#0F172A`, akcenat teal `#0F766E`, hladna podloga `#F8FAFC`.
- Svi parovi teksta prolaze **WCAG 2.2 AA** (najniži 5.02:1 u svjetloj, 6.29:1 u tamnoj temi);
  tabela kontrasta u `docs/design/FE-01-palette-proposals.md` §4.
- Primjena dira **samo** `frontend/src/index.css` (tokeni); komponente već koriste tokene.
- **Otvoreno:** vlasnik bira A / B / kombinaciju — tek tada `FE-01` prelazi u `done` i paleta ulazi
  na ekrane (FE-02…).

### 2026-11-03 — BE-18 (javni sajt, kontakt, pretraga, upload) → segment `done`
- Javne rute bez tokena (`/public/*`), rate-limit po IP-u, `PublicModule` odvojen od tenant scope-a;
  e2e `public.e2e-spec.ts` pokriva kontakt formu, pretragu i upload bez prijave.

### 2026-11-03 — FE-01 (tokeni i paleta) → segment `done`
- Vlasnik izabrao **„Kombinacija“** (D-040): svjetla tema `#F7F8F6` / `#14201A`, primarna `#0F5132`,
  akcent `#0F766E`, radius `0.75rem`; najniži kontrast **5.02:1** (WCAG 2.2 AA).
- Tokeni u `frontend/src/index.css`; komponente ih već koriste, pa primjena nije dirala ekrane.

### 2026-11-03 — FE-02 (shell i navigacija) → segment `done`
- `NAV_SECTIONS` (5 grupa: pregled → posao → teren → ured → administracija), `isNavItemVisible`
  (permission / `anyPermission` / obračun / plateau), `activeNavPath` = najduži prefiks,
  a11y shell (skip-link, fokus, `<html lang>`, naslov taba), lazy rute → bundle **207.7 kB gzip**.

### 2026-11-03 — FE-03 (a11y, WCAG 2.2 AA) → segment `done`
- Pravila primijenjena na shell i primitive: vidljiv fokus (unlayered CSS, jer `@layer base` gubi od
  `outline-none`), `role="alert"` za greške, labela + opis polja, reflow na 320 px bez horizontalnog
  skrola; Playwright test fokusa (prvi `Tab` u headless-u traži prethodni `focus()` na polje).

### 2026-11-03 — FE-04 (admin dashboard) → segment `done`
- **IA prije koda** (`docs/design/FE-04-dashboard-ia.md`, D-043): tri pitanja po roli (šta ističe, ko je
  na terenu, koliko trošimo), zone A–F, eksplicitno šta **ne** prikazuje (trendovi, realtime, drag).
- Ekran: zaglavlje sa lokalizovanim datumom, do 4 prečice filtrirane `isNavItemVisible` + `tenantReady`,
  KPI kartice sa ikonom i linkom, rokovi sortirani po hitnosti (boja **i** tekst), prisustvo sa avatarima,
  skeleton (`aria-busy`), trajna greška `role="alert"` + „Pokušaj ponovo“.
- **Bez novih backend upita** — dashboard pokazuje postojeće stanje i vodi dalje.

### 2026-11-03 — FE-05 (testovi) → segment `done`
- **Testna okosnica (D-044):** Vitest + Testing Library + jsdom + `@vitest/coverage-v8` (samo dev
  zavisnosti). Razlog: ESM + Vite projekat, isti alias `@` i TS pipeline bez druge konfiguracije.
- **28 testova / 4 fajla:** `dash()` (nula ≠ „nema podataka“), `navigation` (vidljivost, najduži prefiks,
  jedinstvene rute), `dashboard-page` (prečice po pravima, hitnost rokova, prisustvo, greška + retry,
  stanje bez firme), `i18n` (svi `dash.*`/`dashboard.*` ključevi; `dash` u tačno jednom modulu).
- **Coverage ratchet:** mjere se samo pokriveni moduli (95,1 % linija), pragovi 85/85/85/75 rastu po segmentu.
- **Ispravljen netačan FE-04 nalaz:** `dash` ključevi **nisu** bili sirovi — postojali su u `ops-bs.ts`;
  stvarni defekt je bio duplikat u `bs.ts`/`en.ts` koji `index.ts` spread tiho pregazi. Duplikat uklonjen,
  labele normalizovane, dodat test-guard. Ispravka upisana u `FE-04.md` i D-043.
- **Novo stanje na dashboardu:** platform admin bez izabrane firme vidi „Izaberite firmu…“, ne praznu mrežu.
- **CI:** job `frontend` sada ima `npm run test:cov` + artefakt `frontend-coverage`.

### 2026-11-03 — FE-06 (E2E tokovi) → segment `done`
- `flows.spec.ts` (7): prijava → dashboard (prevedene kartice, nema sirovih `dash.*`) → prečica
  „Projekti“ → lista → detalj sa fazama (`Zemljani radovi`), zadatak iz seed-a, `aria-current`,
  reflow 320 px + jedno `h1`; guardovi: `/projects` i `/tasks/:id` bez prijave → `/login`.
- `worker-flow.spec.ts` (3): radnik dobija **svoje** kartice (`Moji zadaci`, prisustvo nedostupno),
  prečice bez zabranjenih ekrana, **timer start → pauza → stop** na dodijeljenom zadatku
  (sa zaštitom od timera ostavljenog prethodnim runom).
- `playwright.config.ts`: `retries: CI ? 1 : 0`, `trace: 'retain-on-failure'`, screenshot na pad,
  html izvještaj — prije se trace **nije snimao** jer nije bilo retry-ja (F-FE-06-02).
- **Nalaz F-FE-06-01 (za FE-10/BE):** `WORKER` ima `hse.write` ali **ne** `hse.read`, pa radnik ne
  može otvoriti HSE ekran iako je glavni prijavljivač. Nije mijenjano — pravila rola su BE odluka;
  test trenutno stanje dokumentuje.
- **Rate-limit je oborio prvi run** (41727820440): 16 testova × prijava > 5/min po IP-u (D-042 daje
  pravi IP) → polovina padne na `/login`. Riješeno: `auth.setup.ts` pravi **jednu prijavu po roli** i
  čuva `storageState`; `guest` projekti (`login`, `a11y`, `guards`) rade bez sesije — **3 prijave po runu**.
- **Drugi pad (41728489546):** `storageState` je bio prazan iako je prijava prošla — bez „zapamti me“
  refresh token ide u **sessionStorage**, a `storageState` čuva samo localStorage. Setup sada čekira
  `#remember`, provjerava da stanje nije prazno, a `beforeEach` tvrdi `toHaveURL(/dashboard/)`.
  Na pad se objavljuje artefakt `playwright-artifacts` (html + trace).
- **Treći pad (41729231608):** `storageState` po testu ne radi jer backend **rotira** refresh token, a
  ponovnu upotrebu starog tretira kao krađu i gasi **sve** sesije (`revokeAll`). Isto pogađa korisnika
  sa dvije kartice → **F-FE-06-06** (preporuka za BE-02: grace period ili single-flight refresh).
  E2E sada koristi **jednu sesiju po fajlu** (`e2e/session.ts`), pa reuse ne postoji.
- **Četvrti run (41730126620):** sesije rade; padale su samo moje URL provjere jer aplikacija koristi
  **CUID** ID-jeve (`cmw197…`), a regex je tražio heksadecimalni UUID → ispravljeno (F-FE-06-07).
- **Zeleno:** [41730661179](https://github.com/mudzy992/gradix/actions/runs/41730661179) — 6/6, Web E2E prolazi
  sa svih 16 testova (admin 5, radnik 3, guest 8).
- **Ukupno 16 E2E testova** u 5 fajlova (`guest`/`admin`/`worker`).

### 2026-11-03 — FE-07 (auth stranice) → segment `done`
- **Nalaz (visoko):** `forgot`, `reset` i `change-password` **nisu imali `h1`** (naslov je bio `div`),
  a `forgot`/`change-password` **nisu prikazivali greške validacije** — forma je „ništa ne radi“.
  `min(10)` je bacao engleski Zod tekst; greške servera (uključujući **429** zbog 5 prijava/min) su
  bile toast poruke koje nestanu.
- **Riješeno:** `AuthCard` (jedan okvir → tačno jedno `h1`) za sva četiri ekrana; `Field error` sa
  `aria-invalid`/`aria-describedby`; trajni `role="alert"` za greške servera; uspjeh slanja upute je
  **stanje ekrana** (`role="status"`, email + „Pošalji na drugu adresu“); `/reset` ostaje pošten
  (BE vraća 501) i kaže šta korisnik sada može.
- **Novo:** `PasswordInput` sa prekidačem vidljivosti (`aria-pressed` + tekstualno ime) i
  `autoComplete` (`current-password`/`new-password`); dugme „Promijeni lozinku“ umjesto „Sačuvaj“.
- **Testovi:** 14 unit (`auth-pages.spec.tsx`) → ukupno **42**; 3 E2E (`auth-pages.spec.ts`) → ukupno
  **19**; `a11y.spec` ažuriran (prekidač lozinke je sada između polja i „zapamti me“).
- **Coverage ratchet proširen** na auth ekrane: linije **96,9 %**, grane 91,1 %.

### 2026-11-04 — FE-13 (administracija) → segment `done`
- **Nalaz (visoko):** ekran postavki je prikazivao formu firme **i kad `GET` padne** — prazna polja su
  se slala i mogla pregaziti naziv, JIB i adresu; registar je uz polje stavljao goli tehnički ključ i
  **engleski opis**, a prazno numeričko polje je upisivalo `0` (`Number('')`). Korisnici nisu imali
  **status** (deaktiviran je izgledao kao aktivan) ni **reaktivaciju** (deaktivacija je bila trajna iz
  UI-a), reset lozinke je išao jednim klikom; firme su imale prazno zaglavlje statusa i nijednu
  stanicu stanja; prebacivač firme je tiho ignorisao pad liste i `getMe`.
- **Riješeno:** forma (firma i registar) postoji samo uz `isSuccess`, sa skeletonima i trajnim
  `role="alert"` + retry; `accountStatus` + kolona „Status“ i akcija „Aktiviraj“ u korisnicima i
  firmama; potvrde za reset/deaktivaciju/reaktivaciju; prevedene postavke po ključu
  (`lib/settings-keys.ts` + `settings.keys.*`, opis sa backenda kao rezerva); brojevi se validiraju,
  prazno se ne upisuje; „Sačuvaj“ samo uz izmjene; labele na pretrazi i svim poljima; `caption`/broj/
  prazno stanje; kopiranje privremene lozinke sa fallbackom. **D-052**.
- **Usput nađeno (F-FE-13-18):** react-hook-form zadržava `required` pravila polja koja se odmontiraju
  (polja prvog admina postoje samo pri kreiranju firme) — uređivanje firme se **nije moglo sačuvati**.
  Validacija je premještena u `handleSubmit` (`form.setError`) + `shouldUnregister`.
- **Testovi:** 36 novih (ukupno **209**), coverage ratchet +10 fajlova: linije **91,62 %**, grane
  91,28 %, funkcije 87,11 %; E2E +2 (korisnici, postavke) → **28**.
- **CI epizoda:** run `41792084133` pao (Web E2E: `admin` i `worker` dijele seed → **D-053** serijski
  E2E; nova provjera tražila je ime i u meniju; `useIsPlatform` bez `roles`), popravljeno u
  `2febe55` → run **41792792936 = 6/6**.

### 2026-11-04 — FE-12 (obračun sati, ERP-lite) → segment `done`
- **Nalaz (visoko):** obračun je prikazivao **sirove minute** (`480`) i sirove iznose (`120.000000`),
  `REJECTED` je imao isti ton kao `PENDING`, a tabela nije imala `caption`, skeleton, prazno stanje ni
  trajnu grešku; export je gasio `objectURL` odmah i nosio fiksno ime; zbir se nije učitao
  supervizoru (zavisio od `payroll.read`). ERP je slao **sva četiri upita odmah** (i šifarnik
  materijala bez otvorenog lagera), nije imao nijedno prazno stanje ni grešku, kategorija/izvor
  (`MATERIAL`, `PAYROLL`) i tipovi partnera/skladišta su bili sirovi, dugme za knjiženje lagera je
  glasilo **„Količina“**, a polja su imala samo `placeholder`.
- **Riješeno:** `PAYROLL_STATUS`/`COST_CATEGORY`/`COST_SOURCE`/`PARTNER_TYPE`/`WAREHOUSE_TYPE` u
  `lib/labels.ts`; sati („8 h“) u koloni i zbiru uz minute u detalju; `formatAmount` svuda; ton po
  statusu; `caption`, skeleton, prazan mjesec sa uputom, trajni `role="alert"` + retry za listu i
  zbir; zaglavlje „Akcije“; export `obracun-YYYY-MM.xlsx` sa odgođenim revoke; ERP upiti po tabu
  (`enabled`), labele kroz `Field`, „Knjiži“ umjesto „Količina“, prazna stanja
  (`warehousesEmpty`/`materialsEmpty`/`stockEmpty`). **D-051**.
- **Testovi:** 22 nova (ukupno **173**), coverage ratchet +5 fajlova: linije **92,35 %**, grane 91,18 %,
  funkcije 88,66 % (`erp-page` 100 %, `payroll-page` 88,6 %, ERP tabovi 91,7–95,8 %); E2E +2 (obračun,
  ERP) → **26**.

### 2026-11-03 — FE-11 (tenderi, servis, izvještaji) → segment `done`
- **Nalaz (visoko):** servisni nalozi su prikazivali **`machineId` (CUID)** umjesto naziva mašine;
  izvještaji su imali zaglavlja kao sirove ključeve sa backenda (`plannedBudget`); export je brisao
  `objectURL` odmah poslije `click()`; iznosi su bili `12000.00`, dugme „Označi WON“.
- **Riješeno:** `tenderStatus`/`serviceStatus`/`formatAmount` u `lib/labels.ts`; naziv mašine iz
  `listMachines` (CUID samo fallback); prevedena zaglavlja izvještaja sa `defaultValue` (nepoznata
  kolona ostaje sirova), `caption` sa brojem redova i period `Od`/`Do`; tenderi dobili broj i praznu
  fazu, akcije prevedene, labele i poruke za obavezna polja; export sigurniji. **D-049**.
- **Testovi:** 23 nova (ukupno **151**), coverage ratchet +3 fajla: linije **92,0 %**, funkcije 88,4 %;
  E2E +1 (tenderi) → **24**.

### 2026-11-03 — FE-10 (dnevnik, HSE, dokumenti) → segment `done`
- **Nalaz (visoko):** HSE je prikazivao sirove `LOW`/`OPEN`/`ACK`, a dugmad „Potvrdi“/„Zatvori“ su
  vidjeli **svi** koji vide listu; ekran dokumenata je obećavao „upozorenja 30/15/5“, a uz dokument je
  stajao samo datum; u dnevniku su dani bili **dugmad koja ništa ne rade** sa imenima „01“, „02“,
  filter projekta se nije mogao poništiti, a konflikt je na nepotpune detalje **tiho** odustajao.
- **F-FE-06-01 (frontend dio) riješen:** `/hse` više nije vezan isključivo za `hse.read` — navigacija i
  ruta traže `hse.read` **ili** `hse.write`, jer backend (D-033) prijavljivaču daje samo njegove prijave.
- **Riješeno:** `hseSeverity`/`hseStatus`/`documentState`/`daysUntil` (30/15/5) u `lib/labels.ts`;
  stanja i labele na sva tri ekrana; kalendar sa zaglavljem dana, offsetom i punim imenom dana; sheet
  konflikta sa datumom i objašnjenjem. **D-048**.
- **Testovi:** 38 novih (ukupno **128**), coverage ratchet proširen na 4 fajla: linije **94,1 %**,
  funkcije 91,7 %; E2E +1 (HSE prazno stanje) → **23**; jsdom stubovi za Radix `Select`.

### 2026-11-03 — FE-09 (flota i logistika) → segment `done`
- **Nalaz (visoko):** tip i status mašine su bili **sirovi enumi** (`EXCAVATOR`, `IN_SERVICE`) sa istim
  tonom badge-a; sati rada kao `Decimal` string (`1234.500`); status ture kao `LOADED`/`UNLOADED` pod
  zaglavljem „Status“; jedinica materijala `M3`; **mapa je bila nepristupačna** (platno bez tekstualnog
  ekvivalenta) i sa bojama odbačene palate; `select` za dodjelu i polja za dodavanje nisu imali labele.
- **Riješeno:** `lib/labels.ts` proširen na `machineStatus/machineType/gpsSource/materialUnit/tripStatus`
  + `formatHours` („1.234,5 h“); sve tri tabele dobile `caption`, skeleton, trajnu grešku sa
  „Pokušaj ponovo“ i prazno stanje; mapa dobila prevedene balončiće, paletu C i **tekstualnu listu**
  ispod platna; polja dobila `<label>`, a jedinica se bira iz šeme. **D-047**.
- **Testovi:** 22 nova (ukupno **90**), coverage ratchet proširen na tri ekrana flote/logistike:
  linije **94,0 %**; E2E +1 (flota: „Kiper 1 · Kamion · Slobodna“) → **22**.

### 2026-11-03 — FE-08 (projekti, zadaci) → segment `done`
- **Nalaz (visoko):** liste su prikazivale **sirove enume** (`IN_PROGRESS`, `PENDING`, `URGENT`), svi
  badge-ovi istog tona, bez stanja učitavanja/greške/praznog stanja; detalj zadatka je na grešku
  zauvijek pisao „Učitavanje…“; paginacija je nudila „Dalje“ i kad nema strana.
- **Riješeno:** `lib/labels.ts` (D-046) — jedno mjesto za prevod **i** ton enuma (`URGENT`/`CANCELLED`
  crveno, `IN_PROGRESS` primarno) + `formatDuration` („1 h 35 min“); liste dobile skeleton
  (`aria-busy`), trajnu grešku sa „Pokušaj ponovo“, prazno vs. „nema rezultata“, `caption` sa ukupnim
  brojem i paginaciju sa granicama („Stranica X od Y“); pregled projekta je `dt`/`dd`, pretraga ima labelu.
- **Testovi:** 26 novih (ukupno **68**), coverage ratchet proširen (`labels`, projekti, zadaci):
  linije **96,5 %**, grane 93,2 %; E2E +1 (prevod kolona na tabli) → **20**.
- **Vlasnik potvrdio (2026-11-03):** Coolify env + frontend rebuild za D-041 su urađeni i testirani —
  taj korak se više ne vodi kao otvoren.
- **E2E pouka:** nova provjera je prvo pala jer sam pretpostavio `IN_PROGRESS`, a seedov projekat
  nema eksplicitan status → šema daje `PLANNING` („U planu“). Tvrdnja sada provjerava prevod tog
  statusa **i** da se nijedan sirov enum ne pojavljuje (runovi 41734726483, 41735245381).

### 2026-11-03 — CI dijagnostika i 429 u E2E (D-050)
- Run **41780990334** pao je u „Playwright testovi“, a anotacije su imale samo rep liste → dodat korak
  „Playwright sažetak padova“ (svaki pad kao `::error::` + ispis „Failed Tests“).
- Run **41781490823** otkrio je pravi uzrok: tri pada sa **retry 0 ms** = odbijeni zahtjevi, ne spor
  API. Backend drži 120 zahtjeva/min i 5 prijava/min, a `retries: 1` ponovo izvršava `beforeAll`
  (novu prijavu). Limiti su sada **konfigurabilni** (`THROTTLE_LIMIT`, `AUTH_LOGIN_LIMIT`,
  `AUTH_REFRESH_LIMIT`); defaulti nepromijenjeni, CI `web-e2e` diže na 1000/30/200. **D-050**.
- Dodat `expectNoLoadError(page)` u E2E: pad kaže „Ekran prikazuje grešku umjesto podataka: …“.
- **Potvrđeno** runom **41782885474**: Web E2E zelen sa podignutim limitima → uzrok je bio throttle,
  ne kod. Zeleni run je i backend (lint/unit/build) i E2E posao.

### 2026-11-04 — FE-14 (javni sajt) → segment `done`
- **Nalaz (visoko):** `/p/:slug` je jedini ekran bez prijave, a ponašao se kao interni: dok su podaci
  stizali bio je **prazan bijeli ekran**, svaka greška (500/429/mreža) izgledala je kao „stranica nije
  pronađena“, **nije bilo ponovnog pokušaja**, a pad liste projekata sklanjao je i firmu i kontakt.
  `<title>`/`description` su ostajali aplikacijski (dijeljeni link se zvao „Gradix“), `<html lang>` je
  bio zakucan na `bs` iako ekran ima BS/EN prebacivač, status projekta je bio **sirov enum** kad nema
  lokacije, slike nisu bile `lazy`, `<dl>` nije imao `dt`, a telefon/e-mail su bili mrtav tekst.
- **Nalaz (visoko, `lib/api-public.ts`):** `response.json()` bez zaštite — HTML odgovor proxy-ja
  (502/504) bacao je `SyntaxError`, a throttlerov 429 nije imao `error` polje (`body.error.code` na
  `undefined`); stranica zato nije mogla razlikovati „nema firme“ od „server je pao“.
- **Nalaz (visoko, `use-public-settings.ts`):** sirova postavka `app.timezone` išla je pravo u
  `Intl.DateTimeFormat` → nevalidna vrijednost (`GMT+1`, prazan string) rušila je **zvono obavještenja
  i dnevnik na svakom ekranu** (`RangeError`); format bez `dd`/`MM` tokena tiho je prikazivao isti dan.
- **Riješeno:** četiri stanja (`loading` sa skeletonom i `aria-busy`, `ready`, `missing` samo za 404,
  `error` sa `role="alert"` + retry); 429 poruka „sačekajte“; firma i projekti odvojeno; `projectStatus`
  + prijevod; `dl`/`dt`/`dd`; `lazy`/`async` slike sa dimenzijama; `tel:`/`mailto:`; SEO meta
  (`title`, `description`, `og:title/description/type/image`, `canonical`) uz **vraćanje na unmount**;
  `<html lang>` sinhronizovan; jezik iz aplikacije pa iz browsera; `ApiError` za ne-JSON i 429;
  validacija vremenske zone/formata sa fallbackom; kartica logotipa skrivena kad podaci firme padnu,
  upload sa stanjem i potvrdom; **3 nova E2E testa** za javni sajt (`guest` projekat).
- **Testovi:** 25 novih unit (ukupno **232** u 30 fajlova), 3 nova E2E (lista **31**); linije
  **91,62 %**, grane 91,28 %, funkcije 87,11 %; `tsc -b` i `oxlint` bez grešaka; `npm run check:all`
  15/0. **D-054.**

### 2026-11-04 — FE-15 (i18n, store, hookovi, helperi) → segment `done`
- **Nalaz (visoko, mrežni sloj):** mrežni pad (`fetch` odbija Promise) nije bio `ApiError` — korisnik je
  na bosanskom vidio `Failed to fetch`; izvoz (`apiBlob`) **nije** osvježavao token, pa je poslije 15
  minuta uvijek padao sa „Export failed“; ne-JSON tijelo proxy-ja na `/auth/refresh` bacalo je
  `SyntaxError`, a sesija je ostajala „otvorena“.
- **Nalaz (visoko, pokretanje):** pad mreže pri bootstrapu ostavljao je **neuhvaćen `rejection`** i
  `ready` se nikad nije postavljao — aplikacija je zauvijek stajala na „učitavanju“. Uz to je mrežni
  prekid na `getMe` odjavljivao korisnika i brisao ispravan refresh token.
- **Nalaz (visoko, privatnost):** odjava je brisala store i token, ali **ne keš upita** — na dijeljenom
  računaru sljedeći korisnik je vidio liste i `me` prethodnog. Odjava je bila rasuta na četiri mjesta.
- **Nalaz (visoko, pohrana):** blokirana pohrana (Safari privatni režim) rušila je aplikaciju već pri
  uvozu modula (`company-store` čita izbor firme na nivou modula).
- **Nalaz (srednje):** CSV izvoz bez BOM-a (kvare se `č/ć/ž` u Excelu), `\n` umjesto `\r\n`, formule iz
  ćelija se izvršavaju (CSV injection), link nije u dokumentu (Safari ignoriše preuzimanje);
  `formatDateTime` baca `RangeError` na neispravan datum/zonu i ruši ekran; `retry: 1` ponavlja i
  `403/404/429`; šest backend kodova grešaka nema prijevod (`429` = „ThrottlerException“ u UI-u).
- **Riješeno:** `networkError`/`readBody`/`clearSession` u `api-client` (uz 401 refresh za `apiBlob` i
  `RATE_LIMITED` za 429), `shouldRetry` (samo mreža i 5xx, jednom), zaštićena pohrana sa memorijskim
  fallbackom, CSV sa BOM/CRLF/anti-formula zaštitom i linkom u dokumentu, `formatDateTime` → `—`,
  `assignableRoles` tolerantan na `roles`, bootstrap uvijek postavlja `ready` i odjavljuje samo na
  401/403, sve odjave idu kroz `clearSession()`; **8 novih kodova grešaka** u bs+en i novi
  `i18n/parity.spec.ts` (paritet bs/en, vlasništvo sekcija, svaki backend `ERROR_CODES` preveden).
- **Testovi:** 67 novih unit (ukupno **301** u 41 fajlu); pokrivenost linija **92,23 %**, grane 88,38 %,
  funkcije 88,75 %; coverage ratchet proširen sa 14 fajlova (10 iz FE-15 + 4 iz FE-14 koje je FE-14
  propustio da doda). E2E nepromijenjen (**31**). **D-055.**
- **Usput:** test javnog sajta (FE-14) je povremeno padao jer je `beforeEach` praznio `<head>` poslije
  postavljanja naslova — redoslijed ispravljen, tvrdnje idu kroz `waitFor`.

### 2026-11-04 — FE-16 (UI primitive) → segment `done`
- **Nalaz (visoko, kontrast):** neaktivni tab je bio `text-foreground/60` — na `--muted` podlozi to je
  **4,26:1**, ispod granice 4,5:1 za tekst od 14 px (WCAG 2.2 AA). Tabovi su na ERP-u, obračunu i
  postavkama, pa je slab kontrast bio svuda. Sada `text-muted-foreground` (**5,02:1**), a test zabranjuje
  povratak na `/60`.
- **Nalaz (visoko, tastatura):** kontejner tabele (`overflow-x-auto`) i `ScrollArea` viewport nisu bili
  fokusabilni, pa korisnik bez miša **nije mogao** doći do kolona van ekrana (WCAG 2.1.1, axe
  `scrollable-region-focusable`). Sada su `region` + `tabIndex=0` + vidljiv fokus; sedam tabela dobija
  ime regiona (naslov ekrana), a E2E tvrdi da region prima fokus.
- **Nalaz (srednje, i18n):** oznaka za zatvaranje dijaloga i „šita“ bila je **hardkodirana na engleskom**
  („Close“) — čitač ekrana je u bosanskom interfejsu izgovarao engleski na svakom dijalogu; dugme u
  podnožju dijaloga bilo je vidljivo englesko. Sada `common.close` (bs „Zatvori“/en „Close“).
- **Nalaz (srednje):** `CardTitle` je `div`, pa dugačke stranice nisu imale strukturu naslova. Odluka
  (D-056): naslovi **ostaju** `h1`/`h2` van kartica, a kartice su **imenovani regioni** — bez preskočenih
  nivoa naslova. Usput: `Textarea` je dobila ista `aria-invalid`/`disabled` stanja kao `Input`.
- **Testovi:** 33 nova (`primitives.spec.tsx` 22, `overlays.spec.tsx` 11) — ukupno **334** unit testa u
  43 fajla; pokrivenost linija **92,57 %**, grane 88,40 %, funkcije 89,98 %. 19 UI fajlova dodato u
  coverage ratchet (15 fajlova 100 %, `alert-dialog`/`dialog` 92,3 %, `sheet` 90,9 %). E2E ostaje **31**
  (tvrdnja o regionu tabele ušla je u postojeći tok). **D-056.**

### 2026-11-04 — CI-02 (`workflow_dispatch` inputi) → segment `in-progress`
- **Nalaz:** ručno pokretanje nije primalo parametre — svaka provjera (npr. samo guardrail) koštala je
  **puni run od 6 poslova (~12 min)**; nije bilo ni detaljnih logova na zahtjev, ni oznake artefakata
  po ticketu.
- **Riješeno:** `suite` (`all/audit/backend/frontend/e2e/docker`) sa `if:` na svih šest poslova,
  `verbose` (korak „Dijagnostika“: Node/npm/vitest/tsc, platforma), `tag` (sufiks u imenima
  `frontend-coverage-*` / `playwright-report-*`), `run-name` koji u listi runova pokazuje šta je
  pokrenuto. `push` run se ponaša **identično kao prije** (`!inputs.suite` → svi poslovi).
- **Dokaz (push put):** run **41807005307** je zelen **6/6**, a ime runa je „CI · all“ — `run-name` i
  `if:` se parsiraju i za `push` daju `true` (ponašanje kao prije). **Ciljani run (`suite=audit`) nije
  pokrenut iz ovog okruženja** — GitHub integracija odbija dispatch (`HTTP 403`); ostaje jednokratna radnja za
  vlasnika (vidi „Otvoreno za vlasnika“).
- **Dokumentacija:** `docs/CI.md` — tabela inputa, mapa `suite` → poslovi, tri primjera
  `gh workflow run`, napomena da `concurrency` otkazuje tekući run iste grane; dug **C2 zatvoren**.

### 2026-11-04 — CI-05 (audit gate) → `in-progress`
- Postojeći `check-coverage.mjs` provjerava postojanje i drift matrice, ali **ne provjerava** da su svi fajlovi u `done` segmentu pregledani. Time planirani gate može propustiti dug.
- Informativni snimak `AUDIT/audit-gate-baseline.json` navodi 38 zatečenih `nepregledano` redova u `done` segmentima (26 BE/FE sloj, ostali STD/CI/TEST). Nije izuzetak od pravila niti potvrda da su fajlovi pregledani.
- Prototip `scripts/audit/check-audit-gate.mjs` prijavljuje ove redove; još nije regresijski testiran ni uključen u CI. Potrebno pregledati dug i doraditi provjere prije zatvaranja CI-05. `done` statusi ranijih segmenata nisu dokaz da su naknadno inventarisani fajlovi pregledani.
- CI-02 vraćen na `in-progress`: push run 6/6 nije dokaz za selektivni `workflow_dispatch`. Dokumentacija o E2E verbose i izboru e2e je ispravljena.

### 2026-11-04 — CI-05: prvi pregled zaostalog backend duga
- Ponovni `gh workflow run` i dalje vraća HTTP 403; CI-02 ostaje `in-progress`.
- Pregledano sedam redova (date-input i test, AppError, PrismaModule, ops-dates, timer-settings, payroll test). Prijavljen i popravljen kalendarski overflow u timestampu tendera/dokumenta: `2026-02-31T10:30:00Z` više se ne pretvara u mart nego vraća 400; regresijski test uključuje offset i prestupnu godinu.
- F-CI-05-03: `parseOptionalDate` projekata/zadataka/faza je također normalizovao nepostojeći datum; ISO datumi i timestampi sada provjeravaju kalendarski dio prije parsiranja. Drugi prihvaćeni formati ostaju nepromijenjeni. Prototip strogog gatea i dalje nije uključen u CI.
- Lokalno 5 Jest suite / 27 testova prošlo, ESLint četiri izmijenjena fajla prošao. Lokalni `prisma generate` blokiran mrežnim pristupom `binaries.prisma.sh`; potpuni backend build provjerava se u GitHub CI.

### 2026-11-04 — CI-05: pregled tenant i auth granica
- Commit `6b80b0f` je pushovan; CI **41811142444 = 6/6**. Pokušaj `workflow_dispatch` i dalje daje HTTP 403; CI-02 ostaje `in-progress`.
- Pregledani tenant i permissions guardovi, auth E2E, dvije migracije, controller i DTO lokacija. Dodato 10 unit testova za tenant odabir, platform header, nedostajuću firmu i permissions AND; auth E2E sada dodatno provjerava da je rotirani refresh token opozvan nakon reuse (test u CI).
- Strogi gate je i dalje prototip; preostali nepregledani redovi u zatvorenim segmentima moraju se pregledati prije njegovog uključivanja. Mobile ostaje na čekanju.

### 2026-11-04 — CI-05: obavijesti i auth komponente
- Commit `b98001c` → CI **41812237273 = 6/6**. Preostaje 21 nepregledan ili `u-toku` red u `done` segmentima; strogi gate još nije u CI.
- Pregledani `AuthCard`, `PasswordInput` i auth testovi. Bell je prikazivao prazno stanje i kad se lista učitava ili API vrati grešku; dodani status, pristupačna greška i retry, uz dva komponentna testa.
- Frontend 44 suite / 336 testova, linije 92,57 %; TypeScript i oxlint prolaze. Strogi gate i dalje je u pripremi.

### 2026-11-04 — CI-05: pregled Gantt prikaza
- Dokumentacijski commit `9b01a9e` pushovan, CI **41813089935 = 6/6**. Pregledan Gantt: ranije datum nije bio tekstualno čitljiv, a neispravni ili obrnuti rasponi mogli su pokvariti skalu. Sada su datumi vidljivi u tekstu, neispravni rasponi se izostavljaju, a traka ne izlazi iz grafika. Dva regresijska testa.
- Frontend 45 suite / 338 testova, linije 92,57 %; TypeScript i oxlint prolaze. CI-05 ostaje u toku.

## Šta je sljedeći korak

1. **CI-05**: pregledati dug u matrici, dovršiti i testirati strogi audit gate bez izuzetaka. Potom CI-06, TEST-01 i TEST-02. Mobile ostaje na čekanju dok BE/FE nisu potpuno pregledani.
2. Svaki sljedeći segment dodaje svoje module u `coverage.include` (ratchet, D-044) i, gdje ima
   smisla, E2E tok (D-044/FE-06 obrazac: jedna sesija po fajlu).
3. **F-FE-06-01** (radnik + `hse.read`) čeka odluku u FE-10 / BE segmentu; **F-FE-06-06** (rotacija
   refresh tokena gasi sve sesije) čeka BE-02 dopunu.
3. Nakon svakog segmenta: kratak izvještaj u chatu; bez PR-ova.

## Otvorena pitanja / blokatori

**CI-05 je u toku:** strogi gate zasad pada na ranije neprimijećen dug u matrici; pregled fajlova i testiranje su potrebni prije uključivanja u CI. CI-02 čeka provjeru ciljanog dispatcha. P1–P10 i Q1–Q5 su odgovoreni (vidi `docs/DECISIONS.md`
i `AUDIT/02_MASTER_AUDIT_PLAN.md` §8); D-041 (dva domena) je obavezan uslov za produkciju.

**Otvoreno za vlasnika (ne blokira kod):**
- **CI-02 — jedan ručni run radi provjere izbora posla:** `gh workflow run ci.yml --ref arena/0bc0e56e-gradix -f suite=audit`
  → u runu treba da se izvrši **samo `audit`**, a `backend`, `backend-e2e`, `frontend`, `web-e2e` i
  `docker` da budu „skipped“. (Sandbox GitHub integracija odbija dispatch, pa to ne mogu sam.)
- ~~Coolify env + rebuild frontenda (D-041)~~ — **vlasnik potvrdio da je urađeno i testirano** (2026-11-03).
- ~~Redis implementacija~~ — vlasnik potvrdio da je urađena (2026-11-04).
- `GET /api/files` traži `Authorization`, pa `<img src>` ne može učitati logo — kandidat za budući
  backend segment (potpisani URL-ovi ili javni logo).
