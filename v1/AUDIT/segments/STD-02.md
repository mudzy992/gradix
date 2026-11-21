# STD-02 — Docs guard (linkovi, baneri, ažurnost)

| | |
|---|---|
| Sloj | `STD` |
| Obim | `process` |
| Status | `done` |
| Potvrđeni puni CI | [42104618087](https://github.com/mudzy992/gradix/actions/runs/42104618087) — success |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

> **Procesni segment** — dokumentacija nije izvorni kod i ima vlastiti guard (`check-docs`), pa se
> ne vodi red po fajl u matrici pokrivenosti.

## 1. Svrha i obim

Spriječiti da dokumentacija tiho laže: pokvaren link, penzionisan dokument bez banera, dokument
koji nije u indeksu, ili živ dokument koji linkuje u arhivu.

**Ne radi se ovdje:** „ažurnost“ u smislu `docs ↔ kod` sadržaja (to je posao svakog segmenta i
`AUDIT/STATE.md`), niti provjera da su svi `fajl:linija` dokazi tačni (to radi audit po segmentu).

## 2. Ulaz

**Zavisnosti:** STD-01 (`lib.mjs`, allowlist).

**Fajlovi:** `scripts/standards/check-docs.mjs`, `docs/**/*.md`, `AUDIT/**/*.md`,
`scripts/**/README.md`.

## 3. Kriteriji završetka (DoD)

- [x] `npm run check:docs` prolazi na trenutnom repou
- [x] Pokvaren link → exit 1 (negativan test izveden)
- [x] Penzionisan dokument bez banera → exit 1
- [x] Dokument van `docs/README.md` / `_retired/INDEX.md` → exit 1
- [x] Živ dokument ne smije linkovati u `_retired/` (dozvoljen samo `_retired/INDEX.md`)
- [x] Isti guard ide u CI (`check:all` u jobu `audit`)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja | Dokaz | Ocjena |
|---|---|---|---|
| 1 | 255 linkova/provjera prolazi | `check-docs` → „Provjereno: 255“ | ✅ |
| 2 | 85 penzionisanih dokumenata ima baner | `_retired/INDEX.md` + guard | ✅ |
| 3 | 1 pokvaren link u arhivi | `docs/_retired/ENV_LIST.md` → `./backend/Dockerfile` | ⚠️ (zamrznuto, ne diramo) |
| 4 | Živi dokumenti ulaze u arhivu samo kroz indeks | `docs/README.md`, `docs/INFRASTRUCTURE.md` | ✅ |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-STD-02-01 | Nije postojao nikakav guard za dokumentaciju; linkovi su se kvarili tiho | visoko | nema alata | riješeno |
| F-STD-02-02 | Arhivirani `ENV_LIST.md` ima pokvaren relativni link | nisko | `docs/_retired/ENV_LIST.md` | **prihvaćeno**: arhiva je zamrznuta i guard je preskače; originalna putanja se ne „popravlja“ da bi se sačuvao dokaz |
| F-STD-02-03 | Baner `PENZIONISANO` nije bio provjerljiv | srednje | 85 fajlova u arhivi | riješeno: guard traži baner u prvih 15 linija |

## 6. Popravke

- `check-docs.mjs` preskače `docs/_retired/` kao **izvor** (ne provjerava linkove unutar arhive),
  ali provjerava da arhiva ima banere i da je svaki fajl u `_retired/INDEX.md`.
- Živ dokument smije linkovati samo `_retired/INDEX.md` — arhiva ima jedan ulaz.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Pozitivno | `npm run check:docs` | PASS (255 provjera) |
| Negativno | dodat pokvaren link u `docs/CONVENTIONS.md` | exit 1 ✅ |
| CI | job `audit` | vidi `AUDIT/STATE.md` |

## 8. Rizici i rollback

- **Rizik:** guard postane bučan pri refaktorisanju dokumenata. Ublaženo: jedan indeks
  (`docs/README.md`) i jedna arhiva sa indeksom — nema „negdje između“.
- **Rollback:** ukloniti korak `docs` iz `check-all` i `ci.yml`.

## 9. Dokumentacija

- [x] `docs/CONVENTIONS.md` §7, `docs/CI.md` (guard tabela)
- [x] `scripts/audit/README.md` (obim inventara ne uključuje `.md`)

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-02 |
| Commit(ovi) | isti commit kao STD-01 |
| CI run | vidi `AUDIT/STATE.md` |
| Status | `done` |
