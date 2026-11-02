# STD-01 — Guardrail skripte + check:all

| | |
|---|---|
| Sloj | `STD` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=STD-01`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Uvesti jednu ulaznu tačku (`npm run check:all`) i prve provjerljive guardraile koji ne traže nove
zavisnosti: tajne, `console.log`, compose invarijante, matrica pokrivenosti i delegiranje na
`lint`/`typecheck`/`test` postojećih paketa.

**Ne radi se ovdje:** Prettier i `check:format` (traži zavisnost u korijenu — odluka odgođena,
obrazloženje u §6), `check:tokens`, `check:complexity`, `check:endpoints`, `check:architecture`
(dolaze uz segmente koji ih imaju smisla provjeravati: FE-01/FE-16, BE-01, BE-18).

## 2. Ulaz

**Zavisnosti:** nema (prvi STD segment).

**Fajlovi (7 + 3 izmijenjena):**

- `package.json` (novi korijen, **bez zavisnosti**, samo `scripts`)
- `scripts/standards/{lib,check-all,check-docs,check-secrets,check-console,check-compose}.mjs`
- `scripts/standards/allowlist.json`
- `backend/package.json` (+`lint:check`, `typecheck`), `frontend/package.json` (+`lint:check`, `typecheck`)
- `.github/workflows/ci.yml` (job `audit` sada pušta `check:all`)

## 3. Kriteriji završetka (DoD)

- [x] `npm run check:all` postoji i radi bez `npm install`
- [x] Svaka provjera ispisuje pravilo → zašto → popravka i vraća exit 1
- [x] Negativni test: namjerno pokvaren link / uklonjen CA mount / dodat `console.log` → pad
- [x] CI job `audit` pušta iste provjere (nema „radi lokalno, ne u CI-ju“)
- [x] Preskakanje koraka koji traži `node_modules` je dozvoljeno lokalno, **zabranjeno** u CI-ju (`--ci`)
- [x] `docs/CONVENTIONS.md` §7 opisuje stvarno stanje

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja | Dokaz | Ocjena |
|---|---|---|---|
| 1 | Nije postojala nijedna ulazna tačka za provjere | nije bilo `package.json` u korijenu | ❌ |
| 2 | Nema skenera tajni | `git ls-files` — nijedan alat | ❌ |
| 3 | Compose invarijante su postojale samo kao inline `grep` u CI-ju | `.github/workflows/ci.yml` (job `docker`) | ⚠️ |
| 4 | `console.log/debug`: 1 hit | `frontend/src/hooks/use-socket.ts:35` (samo DEV) | ⚠️ |
| 5 | `lint` skripte rade `--fix` (mijenjaju kod) | `backend/package.json` `lint` | ⚠️ |
| 6 | Backend ima `node_modules`, frontend ne | `ls -d */node_modules` | ⚠️ |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-STD-01-01 | Nema zajedničke komande za provjere; svako pušta šta se sjeti | visoko | nema korijenskog `package.json` | riješeno: `check:all` |
| F-STD-01-02 | Nema skenera tajni — tajna bi ušla u git bez ijedne brane | visoko | nema alata | riješeno: `check-secrets` (6 pravila) |
| F-STD-01-03 | Compose invarijante (portovi, CA mount, MinIO slika) provjerava samo CI inline grep | srednje | `ci.yml` job `docker` | riješeno: `check-compose` (13 provjera) |
| F-STD-01-04 | `npm run lint` u backendu radi `--fix` → nije upotrebljiv kao gate | srednje | `backend/package.json:lint` | riješeno: `lint:check` bez fix-a |
| F-STD-01-05 | Nema Prettier-a → format se ne provjerava | nisko | nema zavisnosti | **odgođeno**: uvodi se kad se odluči jedan alat za sve pakete; do tada `check:format` ne postoji (ne lažemo da postoji) |

## 6. Popravke

- Korijen `package.json`: `private: true`, **nula zavisnosti**, `engines.node >= 22`. Alternativa
  (bash `check-all.sh`) odbačena: Node je već jedini alat u CI-ju, a `npm run` je konvencija iz
  `docs/CONVENTIONS.md`.
- `check-all.mjs` pušta korake kao **zasebne procese** (izolacija padova) i ima `--only`, `--ci`,
  `--list`. `needs` (node_modules / `generated`) se lokalno preskače sa uputstvom, u CI-ju pada.
- `allowlist.json` umjesto `// eslint-disable`-stila izuzetaka u kodu: izuzetak je vidljiv na jednom
  mjestu i ima obavezan razlog.
- `check-compose.mjs` ima mali indentation parser (nema YAML zavisnosti); provjerava tačno one
  invarijante koje su već jednom pale u produkciji.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Svi koraci lokalno | `npm run check:all` | 0 palo, 4 preskočeno (nema `node_modules`/`generated`) |
| Negativan test — docs | dodat link na nepostojeći fajl u `docs/CONVENTIONS.md` (pa vraćen) | exit 1 ✅ |
| Negativan test — compose | uklonjen `target: /etc/ssl/redis/redis-ca.crt` | exit 1 ✅ |
| CI | job `audit` | vidi `AUDIT/STATE.md` (run ID) |

## 8. Rizici i rollback

- **Rizik:** korijenski `package.json` bez `workspaces` može zbuniti alat koji očekuje monorepo
  konfiguraciju. Ublaženo: `private: true`, bez zavisnosti, bez `workspaces`, opisan u
  `docs/CONVENTIONS.md`.
- **Rizik:** lažni pozitiv u `check:secrets` blokira commit. Ublaženo: konzervativna pravila +
  allowlist sa razlogom.
- **Rollback:** obrisati `scripts/standards/`, korijenski `package.json` i korak u `ci.yml`.

## 9. Dokumentacija

- [x] `docs/CONVENTIONS.md` §7 (tabela stvarnog stanja + izuzeci)
- [x] `docs/CI.md` (job `audit` + guard tabela)
- [ ] `docs/DECISIONS.md` — nema arhitektonske odluke (korijen bez zavisnosti nije izbor tehnologije)

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-02 |
| Commit(ovi) | `feat(standards): check:all … [STD-01]` (vidi `git log`) |
| CI run | vidi `AUDIT/STATE.md` |
| Status | `done` |
