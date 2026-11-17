# STATUS — Gradix v2

**Datum:** 2026-11-17 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Odluke / ops (vlasnik)

| Stavka | Ishod |
|---|---|
| Cleanup + raspored | **prošlo** |
| 2a (backup/MinIO) | **PRIHVAĆEN** |
| ADR 0014 | **PRIHVAĆEN** |
| Plan 2c / ručni uvoz projekata | **PRIHVAĆEN** (riječ vlasnika) |
| Anonimizirani Exceli | **DA** (kod vlasnika) |
| Rotacija tajni | **NE** |
| MinIO konzola / odredište do produkcije | **ostaje** (odluka) |
| B15 NE → R5 | stacionaža, partner, workflow |
| 2d | checklist u `COOLIFY.md` §13 — **nema koda** |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2 backup, 2c uvoz projekata (`/ured/uvoz`).

## Role (sažetak)

OWNER/ADMIN: sve evidencije + Uvoz. PM/šef: bez Korisnici/Uvoz. WORKER…: po matrici.

## Ne radi / namjerno još nema

- **R4b**, **pilot**, **partneri**, produkcijski start po §13 — nisu započeti.
- Mobilni E2E u CI zatvoren; A1 mobilna prijava poslije odjave — vlasnik.

## Dugovi / otvoreno (§13)

- `PLATFORM_ADMIN_EMAILS`; ugasiti javnu MinIO konzolu u produkciji; retencija (pravnik);
  domene B11 \[OTVORENO\]; email provajder; uključenje ADR 0014 u produkciji.
