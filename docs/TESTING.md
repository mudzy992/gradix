# TESTING.md — Gradix

> **Izvor istine za testiranje.** Odluke **D-005** (piramida) i **D-004** (Maestro) su
> odobrene. Ovaj dokument opisuje ciljno stanje i trenutni jaz.

---

## 1. Trenutno stanje (commit `e531ca2`)

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
| Sada | 0 % (mjeri se, ne blokira) | — | — |
| Nakon TEST-01 | **40 %** linija (globalno) + 70 % za `common/` i modul koji se dira | — | — |
| Nakon FE-05 | 50 % | 30 % (komponente + helperi) | — |
| Nakon MOB-03 | 60 % | 40 % | 40 % (logika: sync, timer, permissions) |
| Cilj | 70 % | 60 % | 60 % |

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

## 8. Dugovi (mapiraju se na segmente)

| # | Dug | Segment |
|---|---|---|
| T1 | Nema coverage mjerenja ni praga | TEST-01 |
| T2 | Backend: 1 unit test na ~16k LOC | TEST-02 |
| T3 | Frontend: nema unit/component testova | FE-05 |
| T4 | Playwright: 1 spec, bez page objects i fixtures | FE-06 |
| T5 | Mobile: nema testova ni E2E | MOB-03 / MOB-05 |
| T6 | Nema a11y testova (`axe`) | FE-03 |
