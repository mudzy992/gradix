# CONVENTIONS.md — Gradix

> **Izvor istine za standarde.** Pravila koja se **automatski provjeravaju** (skripte/CI) idu
> u `scripts/standards/` (segment STD-01). Do tada vrijede kao obaveza u review-u.

---

## 1. Jezik

| Šta | Pravilo |
|---|---|
| Kod (imena, komentari u kodu) | **engleski** |
| Poruke grešaka prema korisniku | kroz katalog `error.code` (klijent prevodi) |
| Interna dokumentacija (`docs/`, `AUDIT/`) | **bosanski** |
| Commit poruke | bosanski/engleski miješano nije dozvoljeno unutar jedne poruke — koristi engleski tip + bosanski opis (vidi §5) |
| i18n | `bs` (default) + `en`; nijedan tekst u JSX-u |

---

## 2. Imenovanje

| Element | Stil | Primjer |
|---|---|---|
| Fajlovi (TS) | `kebab-case` | `timer-cron.service.ts` |
| Klase / tipovi | `PascalCase` | `TimerCronService` |
| Funkcije / varijable | `camelCase` | `closeStale()` |
| Konstante | `SCREAMING_SNAKE_CASE` | `MAX_LIMIT` |
| DTO | `<Entitet><Akcija>Dto` | `CreateProjectDto` |
| e2e test | `<modul>.e2e-spec.ts` | `payroll.e2e-spec.ts` |
| React komponenta | `kebab-case.tsx` + `PascalCase` eksport | `planned-gantt.tsx` → `PlannedGantt` |
| Ruta | `kebab-case`, množina | `/api/projects`, `/fleet/map` |

---

## 3. Veličina i struktura

| Pravilo | Vrijednost |
|---|---|
| Ciljna dužina fajla | 100–150 linija |
| Tvrdi limit (izuzetak: šeme/konfiguracija) | 200 (400) |
| Dubina ugniježđenja | max 3 |
| Dužina funkcije | ~40 linija; ako je duže — izdvoji |
| Jedan fajl = jedna odgovornost | servis, kontroler, DTO, helper |

---

## 4. TypeScript i kod

1. `strict: true`; **bez `any`** (koristi `unknown` + validacija).
2. Import redoslijed: node → external → interni (`@/` za frontend, relativno u backendu).
3. Bez `console.log` u aplikativnom kodu (dozvoljeno samo u skriptama i CLI alatima).
4. Greške: `throw new AppError(ERROR_CODES.X, 'poruka', status)`; nikad goli `throw new Error`
   na granici API-ja.
5. Nema „magičnih“ brojeva — konstante u `common/constants.ts` (backend) ili tokenima (frontend).
6. Nema mrtvog koda; ako se nešto privremeno gasi — feature flag, ne zakomentarisano.
7. Datumi: UTC u skladištu, konverzija u TZ firme samo na prikazu/izvještaju.
8. Novac: `Decimal`, nikad `number` za iznose.

---

## 5. Git i commiti

**Format:** `type(scope): opis [SEGMENT-ID]`

| Tip | Značenje |
|---|---|
| `feat` | nova funkcionalnost (traži odobrenje ako mijenja vidljivo ponašanje) |
| `fix` | ispravka buga (uz regression test) |
| `refactor` | bez promjene ponašanja |
| `test` | samo testovi |
| `docs` | dokumentacija |
| `chore` | tooling, zavisnosti, konfiguracija |
| `perf` | performanse |

**Pravila:**
- Jedan commit = jedna logička cjelina; bez „WIP“ commitova na grani.
- **Nikad** `--force` bez odobrenja; **nikad** PR.
- Commit koji mijenja ponašanje **mora** ažurirati odgovarajući `docs/` fajl.
- Poslije pusha CI mora biti zelen (vidi `CI.md` §3).

---

## 6. Dokumentacija

| Pravilo | Detalj |
|---|---|
| Jedan izvor istine | `docs/` + `AUDIT/`; penzionisano je u `docs/_retired/` (nikad ne briši bez traga) |
| Ažurnost | dokument se mijenja u **istom** commitu kad se promijeni ponašanje/konfiguracija |
| Linkovi | relativni, provjeravaju se skriptom (STD-02) |
| Tvrdnje | svaka tvrdnja o ponašanju ima `fajl:linija` ili je označena `❓` |
| Odluke | svaka arhitekturalna odluka ide u `docs/DECISIONS.md` sa ID-em |

---

## 7. Guardrail skripte (STD-01 / STD-02)

Jedna komanda: **`npm run check:all`** (u korijenu repoa; korijen nema zavisnosti). Svaka provjera
ispisuje **pravilo → zašto → kako popraviti** i vraća non-zero. U CI-ju job `audit` pušta
`npm run check:all -- --only=coverage,segments,docs,secrets,logs,compose`.

| Skripta | Provjerava | Status |
|---|---|---|
| `check:all` | orkestrator (11 koraka, `--only=`, `--ci`, `--list`) | ✅ |
| `check:docs` | pokvareni relativni linkovi, baneri `PENZIONISANO`, potpunost `docs/README.md` i `_retired/INDEX.md`, zabrana linkovanja u `_retired/` (osim indeksa) | ✅ |
| `check:secrets` | AWS/GitHub/Slack/Stripe ključevi, privatni ključevi, URL baze sa lozinkom | ✅ |
| `check:logs` | nema `console.log`/`console.debug` u aplikativnom kodu (`error`/`warn` dozvoljeni) | ✅ |
| `check:schema` | Prisma šema: nema **novog** FK bez vodećeg indeksa (baseline `backend/prisma/index-baseline.json`) | ✅ |
| `check:image` | backend: `USER node`, `HEALTHCHECK` na `/api/health`, exec forma, `set -e` + `exec`, preflight prije migracija; frontend: `STOPSIGNAL`, `server_tokens off`, CSP, nasljeđivanje headera u nginx blokovima; korijenske kopije identične | ✅ |
| `check:env` | svaka env varijabla iz koda/compose-a dokumentovana, `.env.example` ↔ `.env.coolify` parity, nema referenci na penzionisane dokumente | ✅ |
| `check:compose` | nema `ports:` u produkcijskom compose-u, `db_net`/`redis_net` external, CA mountovi `read_only`, mrtve MinIO slike, healthcheck backend/frontend | ✅ |
| `check:coverage-matrix` | svaki fajl u matrici, legalni statusi, `loc` i klasifikacija bez drifta | ✅ |
| `audit:segments` | svih 59 segmenata ima `AUDIT/segments/<ID>.md` | ✅ |
| `check:format` | prettier (svi paketi) | ⏳ nije uveden (nema zavisnosti u korijenu) |
| `check:lint` / `check:types` | `check:all` delegira na `backend`/`frontend` (`lint:check`, `typecheck`), preskače ako nema `node_modules` | ✅ delegirano |
| `check:architecture`, `check:naming`, `check:tokens`, `check:complexity`, `check:endpoints` | vidi tabelu ispod | ⏳ planirano |

**Izuzeci:** samo u `scripts/standards/allowlist.json`, svaki sa fajlom, uzorkom i **razlogom**
(trenutno: 1 log izuzetak, 2 secret placeholdera). Kad se dug riješi, unos se briše.

**Hookovi:** `pre-commit` (format + lint + types) i `pre-push` (`check:all`) — lokalno; CI ih
ponavlja kao izvor istine.

---

## 8. Sigurnost

1. Tajne samo kroz env; nikad u kodu, testovima, logovima ni CI outputu.
2. Logovi ne sadrže lične podatke (email, telefon), tokene ni lozinke.
3. Novi endpoint: eksplicitno `@Public()` **samo** kad je javno; sve ostalo je iza guardova.
4. Upload: provjeri MIME i veličinu na serveru; putanja uvijek `{companyId}/...`.
5. Zavisnosti: nova biblioteka = obrazloženje u `DECISIONS.md` (odluka D-006).

## 9. Završeni audit segmenti

Prije oznake `done` pregledati sve fajlove segmenta, ažurirati matricu i izvještaj.
U zaglavlju izvještaja navesti `| Potvrđeni puni CI | [ID](https://github.com/mudzy992/gradix/actions/runs/ID) — success |`
sa stvarnim istim numeričkim ID-om u linku i naslovu, nakon provjere svih šest poslova.
Strogi gate je obavezan u CI; lokalni gate bez `--verify-ci` ne provjerava GitHub.
Planirani i aktivni segmenti mogu sadržati nepregledane redove, ali ne i neispravnu matricu.
Puni CI na kasnijoj reviziji mora se zasebno sačekati; ne upisivati budući run kao zelen.
