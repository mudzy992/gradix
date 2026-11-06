# TESTING.md — Gradix

> **Izvor istine za testiranje.** Odluke **D-005** (piramida) i **D-004** (Maestro) su
> odobrene. Ovaj dokument opisuje ciljno stanje i trenutni jaz.

---

## 1. Historijski snimak (commit `e531ca2`)

> Ova tabela je historijska, ne opis trenutne pokrivenosti. Za aktuelne rezultate vidjeti `AUDIT/STATE.md` i TEST-01.

| Sloj | Alat | Broj | Šta pokriva | Prag |
|---|---|---|---|---|
| Backend unit | Jest (`rootDir: src`) | **1** | `timer-math.spec.ts` (matematika timera) | — |
| Backend e2e | Jest + supertest + realni Postgres | **16** spec fajlova | auth, tenant, users, users-rbac, projects, ops-core, ops-web, fleet, payroll, erp, iot, sync, public, polish, files, health | — |
| Frontend unit | ❌ nema | 0 | — | — |
| Frontend E2E | Playwright | **1** | login tok | — |
| Mobile | ❌ nema | 0 | — | — |
| Coverage | ❌ nema mjerenja | — | — | — |

CI pokreće: backend lint/test/build, backend e2e (Postgres servis + migracije + seed), frontend
lint/typecheck/build, web E2E (živi backend + `vite preview`), docker gate.

---

## 2. Ciljna piramida (D-005)

```
        ┌──────────────────────────────┐
        │ E2E (malo, sporo, skupo)     │  Playwright (web) · Maestro (mobile)
        ├──────────────────────────────┤
        │ Integracija / API ugovor     │  Jest + supertest + Postgres (postojeći e2e)
        ├──────────────────────────────┤
        │ Unit (mnogo, brzo, jeftino)  │  Jest (backend), Vitest/Jest (frontend), Jest (mobile)
        └──────────────────────────────┘
```

**Pravila:**
1. **Svaki popravljeni bug dobija regression test** (unit ako je logika, e2e ako je tok).
2. Testovi ne koriste `sleep`; čekaju stanje (element, odgovor, event).
3. Selektori: `data-testid` (web) i `testID`/accessibility label (mobile) — nikad CSS klase.
4. Testovi su deterministički: fiksni seed podaci, fiksno vrijeme gdje je bitno (`fake timers`).
5. Retry samo za infrastrukturu (emulator, mreža), nikad za logiku.

---

## 3. Coverage pragovi (fazno uvođenje)

| Faza | Backend | Frontend | Mobile |
|---|---|---|---|
| Sada (CI-04) | **ratchet** na izmjerenom stanju (`backend/coverage-baseline.json`: linije 0,18 %), ne može pasti | — | — |
| Nakon TEST-01 | **40 %** linija (globalno) + 70 % za `common/` i modul koji se dira | — | — |
| Nakon FE-05 | 50 % | 30 % (komponente + helperi) | — |
| Nakon MOB-03 | 60 % | 40 % | 40 % (logika: sync, timer, permissions) |
| Cilj | 70 % | 60 % | 60 % |

**Mehanizam (već na snazi):** `scripts/standards/check-coverage-ratchet.mjs` poredi
`backend/coverage/coverage-summary.json` sa `backend/coverage-baseline.json`. Pad ispod baseline-a
= crven CI. Kad pokrivenost poraste ≥ 5 pp, baseline se podiže **ručno** (`--write`) u istom
commitu koji je dodao testove — prag tako nikad ne stagnira, a nikad se i ne spušta.

Pragovi su **eksplicitni** u konfiguraciji po paketu i rastu u istom commitu kad segment
zatvori pokrivenost. Izuzeci (npr. `generated/`, `dist/`, migracije) su navedeni u konfiguraciji
sa obrazloženjem.

---

## 4. Gdje testovi žive

| Sloj | Putanja | Imenovanje |
|---|---|---|
| Backend unit | `backend/src/**/*.spec.ts` | `<subject>.spec.ts` |
| Backend e2e | `backend/test/*.e2e-spec.ts` (+ `helpers/`) | `<modul>.e2e-spec.ts` |
| Frontend unit | `frontend/src/**/*.test.ts(x)` | `<subject>.test.ts` |
| Frontend E2E | `frontend/e2e/*.spec.ts` (+ `page-objects/`, `fixtures/`) | `<tok>.spec.ts` |
| Mobile unit | `mobile/**/__tests__/*.test.ts(x)` | `<subject>.test.ts` |
| Mobile E2E | `mobile/e2e/*.yaml` (Maestro) | `<tok>.yaml` |

---

## 5. Obavezni test paketi po sloju (cilj)

### Backend
- **Unit:** timer matematika, permisije (unija rola), paginacija, scope helperi, `storage-path`,
  `decimal-input`, `iot-key`, `geofence/haversine`.
- **API ugovor:** envelope i error kodovi za svaki modul; 401/403/404 scenariji; tenant header
  pravila; `mustChangePassword` gate; rate limit (na nivou guarda, ne e2e).
- **Integracija:** migracije na praznoj bazi (`migrate deploy` + seed) — već pokriveno u CI-ju.

### Frontend
- **Unit:** helperi za formatiranje datuma/novca (TZ!), zod šeme, `use-tenant-ready`.
- **Component:** forme (validacija, disabled stanja), tabele (sortiranje/filter/paginacija).
- **E2E:** login → dashboard; kreiranje projekta; dispečing zadatka; timer start/pauza/stop;
  dnevnik; payroll odobravanje; settings; javni sajt `/p/:slug`.

### Mobile
- **Unit:** `sync/queue`, `sync/engine` (mapiranje), `timer-actions`, `permissions`, `errors`.
- **Maestro E2E:** login → change-password → timer start/stop → tura (offline) → sync → logout.

---

## 6. Izvještaji i artefakti

- Backend: JUnit XML + coverage (`lcov`), upload u CI kao artefakt.
- Playwright: HTML report + trace/screenshot/video **na failure**.
- Maestro: screenshot/video po toku na failure + JUnit izlaz.
- Sažetak u `GITHUB_STEP_SUMMARY` (broj testova, trajanje, top 5 najsporijih).

---

## 7. Kako pokrenuti lokalno

```bash
# backend
cd backend && npm test                      # unit
npm run test:e2e                            # e2e (traži DATABASE_URL + migracije + seed)

# frontend
cd frontend && npx playwright test          # E2E (traži backend na 3000 ili preview)
npx playwright test --ui

# mobile (kad se uvede)
cd mobile && npm test
maestro test e2e/login.yaml                 # traži pokrenut emulator
```

---

## 7a. Pokrivenost audita (nije isto što i coverage testova)

`AUDIT/COVERAGE_MATRIX.csv` prati **svaki izvorni fajl** (ko ga je pregledao, koji segment, koji
nalaz). Gate je CI job `audit` (`scripts/audit/check-coverage.mjs`), detalji u
`scripts/audit/README.md`. Coverage testova (Jest pragovi) je odvojen mehanizam — vidi §3.

## 8. Dugovi (mapiraju se na segmente)

| # | Dug | Segment |
|---|---|---|
| T1 | Nema coverage mjerenja ni praga | TEST-01 |
| T2 | Backend: 1 unit test na ~16k LOC | TEST-02 |
| T3 | Frontend: nema unit/component testova | FE-05 |
| T4 | Playwright: 1 spec, bez page objects i fixtures | FE-06 |
| T5 | Mobile: nema testova ni E2E | MOB-03 / MOB-05 |
| T6 | Nema a11y testova (`axe`) | FE-03 |


## TEST-01: generisani inventar ruta i matrica

`AUDIT/ROUTE_INVENTORY.csv` je pregled stvarnih Nest controller metoda/putanja i njihovih efektivnih `@Public`, `@TenantRoute` i `@RequirePermissions` metapodataka. E2E test provjerava njihovu jednakost Express registraciji (isključeni Swagger docs i websocket). `AUDIT/ROUTE_MATRIX.csv` je deterministični kartezijanski proizvod: ruta × anonymous/10 rola iz aplikacije × četiri zaglavlja: bez zaglavlja, ID vlastite firme, ID druge firme, nepoznati ID. Za platform admina „vlastita firma“ može biti neprimjenjivo; anonimni header nije izbor tenanta. Matriks je lista za ocjenu, **ne** tvrdnja da svi slučajevi postoje ili su testirani: `unassessed` označava da još nema pregledanog pojedinačnog dokaza; evidenciju povezivati odvojeno da regeneracija ne uništi ručni audit. Deklarativne permisije same ne dokazuju service-level pravila ili stvarnu tenant izolaciju.

Pokrenuti samo s izolovanom testnom PostgreSQL bazom i CI testnim env/seed postavkama:

```sh
cd backend
ROUTE_INVENTORY_WRITE=1 npm run test:e2e -- --runInBand --runTestsByPath test/helpers/route-inventory.e2e-spec.ts
npm run test:e2e -- --runInBand --runTestsByPath test/helpers/route-inventory.e2e-spec.ts
```

Prva komanda namjerno regeneriše oba CSV-a; druga samo provjerava drift. Testovi dodatno šalju anonimne zahtjeve bez tijela na sve non-public obrasce sa zamjenskim nepostojećim ID-jevima i očekuju 401, bez tvrdnje da su dokazane dozvoljene uloge ili tuđi resursi. Parametrizirane putanje su uzorak, ne dokaz svih vrijednosti parametra; regeneracija zahtijeva pregled diff-a.

Dodatni generisani negativni uzorci: svih devet firmnih rola s tuđim tenant headerom na svakoj non-public ruti dobijaju `TENANT_HEADER_FORBIDDEN`; platform admin na tenant rutama bez izbora dobija `TENANT_HEADER_REQUIRED`, a za nepoznat ID `NOT_FOUND`. To nije dokaz da odabrani tenant ne može čitati tuđe resurse; pojedinačne ćelije matrice i dalje zahtijevaju pregled i kontekstualne fixture slučajeve.

S-01 auth E2E modelira dvije nezavisne prijave i konkurentnu rotaciju, a izgubljeni odgovor modelira odbacivanjem uspješnog HTTP odgovora (ne simulira stvarni mrežni prekid/browser). D-059 ponavljanje unutar prozora vraća isti par bez opoziva druge prijave; izvan prozora opoziva pogođenu porodicu. Već izdati access JWT ostaje važeći; krađa u prozoru i rollout rizici su u `AUDIT/segments/BE-02.md`.

S-01 web regresije: simuliran `fetch` gubitak nakon stvarnog serverskog commita, dvije nezavisne browser sesije i dva koordinisana taba; prva sesija traži novu prijavu bez retryja, druga se može osvježiti. Testovi ne dokazuju crash prije obrade greške, blokirani storage, stare klijente ili prekid stvarne mreže.

TEST-01: `backend/test/project-isolation.e2e-spec.ts` je ograničen PG/HTTP dokaz GET/PATCH izolacije stvarnih projekata za svih deset rola, sa fixture assignmentom za firmne korisnike i odabirom oba tenanta za platform admina. Ne dokazuje sve resurse, kombinacije ili konkurentnost; detalji su u `AUDIT/segments/TEST-01.md`.

### Dijagnoza E2E izlaznog statusa (2026-11-06)

Dva TEST-01 E2E fajla su pokrenuta 20 puta serijski na izolovanom PostgreSQL-u bez `--forceExit`: svaki put 8/8 i izlaz 0; svi izlazi, vremena i stderr sačuvani su u `AUDIT/evidence/e2e-exit-2026-11-06.txt`. Jedan dodatni `--detectOpenHandles` prolaz izašao je 0 bez prijavljenih handleova, uz 0 preostalih konekcija na testnu bazu. Raniji izlaz 1 nakon izvještaja 8/8 nije reproduciran; paralelno opterećenje nije ponovljeno pa uzrok ostaje nepoznat. Oba testa zatvaraju Nest app u `afterAll`, Prisma lifecycle zove `$disconnect`, pg adapter zatvara vlastiti pool, cronovi su u Jestu isključeni; ovo ne dokazuje odsustvo curenja u drugim testovima. Socket.IO je dio app lifecyclea i u tom mjerenju nema prijavljenog handlea. Testni `NODE_ENV` preskače throttle pa njegov fallback timer ovdje nije ispitan.

CI već koristi `--forceExit`, koji može sakriti otvorene handleove; dijagnoza ga nije koristila niti je mijenjala CI. Raniji lokalni poziv nije koristio `report-e2e.mjs`, pa reporter ne može biti uzrok tog izlaza. Reporter fail-closed odbija nenulti procesni status nezavisno od zelenog JSON-a, kao i nedostajući/neispravan ili neuspješan izvještaj; sada ispisuje numerički status i kad JSON nedostaje, bez ispisivanja proizvoljnog sadržaja. Ako se anomalija ponovi, sačuvati zasebno stdout/stderr i status samog Jest procesa i omotača te podatke o paralelnom opterećenju, zatim ponoviti bez `--forceExit` uz `--detectOpenHandles`; bez osnova ne tvrditi da je uzrok otklonjen.

TEST-01 generički permission-negative prolaz koristi metapodatke inventara i postojeću mapu role-permisija: 593 uzorka za 103 od 171 rute (9 firmnih rola); javne rute imaju eksplicitne razloge, a nepoznata public ruta ili drift Nest/Express inventara pada E2E. To provjerava provedbu deklarisane mape, ne njenu poslovnu ispravnost; uzorci sa nepostojećim ID-evima ne dokazuju izolaciju stvarnih podataka. Za potpuni generator potrebni su eksplicitni sigurni fixturei i validni payloadi; 0/171 ruta je generički potpuno dokazana kroz sve role i kontekste, a dva projektna endpointa imaju poseban dokaz stvarnih ID-eva. Detalji u `AUDIT/segments/TEST-01.md`.

D-059 regresije: `auth-refresh-replay.e2e-spec.ts` pokriva jednak par za ponavljanje/paralelne zahtjeve, izolaciju druge prijave poslije reuse, istek roditelja/djeteta, odjavu, deaktivaciju, drugačiji ključ i legacy globalni fallback, te OpenAPI. PG SQL-vremena se u testovima namjerno pomjeraju radi prozora; to ne simulira više servera različitih verzija. `auth-refresh-replay.spec.ts` provjerava granice i determinističnost.

### TEST-01: stvarni tenant resursi

Na izolovanoj migriranoj i demo-seedovanoj PostgreSQL testnoj bazi pokrenuti `cd backend && npm run test:e2e -- --runInBand --runTestsByPath test/tenant-resource-isolation.e2e-spec.ts`. Registry u `test/helpers/tenant-fixtures.ts` kreira A/B firme, 10 rola po firmi (platform nalozi su globalni s odabranim tenantom) i stvarne identifikatore; fixture se čisti. Test koristi eksplicitne route→resource→role slučajeve iz inventara i pozitivni vlastiti ID; DELETE dodatno provjerava DB učinke i nepromijenjen tuđi red. `AUDIT/TEST-01-ROUTE-COVERAGE.csv` prati `covered`, `partial`, `pending` i `exception`, uz razlog; gate pada ako ruta nedostaje ili je pokrivenost nevezana za slučaj. To ne zamjenjuje `ROUTE_MATRIX.csv` niti znači da je potpuna cross-tenant matrica gotova. Detaljni opseg i nepokriveno: `AUDIT/segments/TEST-01.md`.

Ako CI backend E2E padne na assertion, reporter sada dodatno ispisuje SHA-256 `fullName` (ne sadržaj poruke, token niti stack). Za identifikaciju na lokalnom **izolovanom** Jest JSON izvještaju iz istog commita, izračunati SHA-256 svake `testResults[].assertionResults[].fullName` i uporediti sa CI fingerprintom. Podaci iz Jest JSON-a mogu sadržavati osjetljive vrijednosti: ne objavljivati sirovi izvještaj ili stack. Ako suite padne prije testova ili mu nedostaje `fullName`, fingerprint ne postoji; potreban je kontrolisan pristup izvornom logu. Promjena reportera ne popravlja uzrok pada.
