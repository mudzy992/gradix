# TEST-01 — Coverage infrastruktura + pragovi

| | |
|---|---|
| Sloj | `TEST` |
| Obim | `fajlovi` |
| Status | `planned` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=TEST-01`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

_Šta ovaj segment provjerava i šta izričito **ne** provjerava (granica prema susjednim segmentima)._

## 2. Ulaz

**Zavisnosti (moraju biti gotove prije):** _(popuniti iz plana §6)_

**Fajlovi:**

4 fajlova (vidi `AUDIT/COVERAGE_MATRIX.csv`, filter `segment=TEST-01`):

- `backend/test/helpers/auth.ts`
- `backend/test/helpers/create-app.ts`
- `backend/test/helpers/minio-memory.ts`
- `backend/test/jest-e2e.json`

**Pretpostavke:** _(šta se uzima zdravo za gotovo i šta ako ne važi)_

## 3. Kriteriji završetka (DoD)

- [ ] Svi fajlovi segmenta pregledani; status u matrici ≥ `pregledano`
- [ ] Svaki nalaz ima težinu, dokaz (`fajl:linija`) i odluku
- [ ] Popravke imaju regression test (ili zapisano zašto test nije moguć)
- [ ] `node scripts/audit/check-coverage.mjs` → PASS
- [ ] Relevantni lokalni testovi zeleni
- [ ] `docs/` ažuriran ako se ponašanje/konfiguracija mijenja (isti commit)
- [ ] `AUDIT/STATE.md` ažuriran; commit + push + **zelen CI** (run ID zapisan)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (`fajl:linija`) | Ocjena |
|---|---|---|---|
| 1 | _(popuniti)_ | `...:1` | ✅ / ⚠️ / ❌ / ❓ |

## 5. Nalazi

Format: `F-TEST-01-NN` — opis, težina (blokada / visoko / srednje / nisko), dokaz, odluka.

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-TEST-01-01 | _(popuniti)_ | | | |

## 6. Popravke

_Za svaku popravku: šta se mijenja, zašto tako, koje su alternative odbačene i zašto._
_Novi alati/zavisnosti: obrazloženje ide i u `docs/DECISIONS.md` (D-006)._

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| _(popuniti)_ | `...` | |

## 8. Rizici i rollback

- **Rizik:** _(popuniti)_ → **Rollback:** _(kako se vraća stanje)_

## 9. Dokumentacija

- [ ] `docs/` dokument(i): _(popuniti)_
- [ ] `docs/DECISIONS.md` ako je odluka arhitektonska

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | _(prazno dok se ne počne)_ |
| Commit(ovi) | |
| CI run | |
| Status | `planned` |

## Ulaz iz D-058

Nakon K2 provjeriti preostalu decimalnu HTTP/PG karakterizaciju svih polja i granica, direktne vanjske Prisma upise, postojeće podatke, numeričke opsege i izvedene obračune; D-058 zatvara samo skalu inventurisanih API inputa. Automatska matrica role × tenant × ROUTE_INVENTORY ostaje prvi korak TEST-01.
