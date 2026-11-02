# AUDIT/STATE.md — živi dnevnik

> Pravilo: ovaj fajl se ažurira u **svakom** commitu.

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; radi se direktno na grani.

## Trenutna faza / segment / korak

**FAZA 1.1 — „dokumentacija vs. stvarnost“ ✅ završena.** Sljedeće: FAZA 1.2 (penzionisanje starih dokumenata).

## Zadnji commit i CI

| | |
|---|---|
| Zadnji commit | `e531ca2` |
| CI | ✅ run 41498842533 (5/5) za `e531ca2`; novi run za ovaj commit u toku |
| Zadnji potvrđeno zelen run | [41498842533](https://github.com/mudzy992/gradix/actions/runs/41498842533) (`e531ca2`) ✅ |
| Sljedeća kapija | **KAPIJA 1** (nakon FAZE 1) |

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

## Šta je sljedeće (tačan sljedeći korak)

1. FAZA 1.2 — `docs/_retired/` + baneri + `INDEX.md` + pokazivači (`.cursorrules`, `.cursor/rules`).
2. FAZA 1.3 — nova dokumentacija (9 dokumenata).
3. Push + zelen CI → **KAPIJA 1**.

## Otvorena pitanja / blokatori

Nema blokatora: vlasnik odobrio P1–P10 (odgovori zapisani u `docs/DECISIONS.md` D-001…D-011).
