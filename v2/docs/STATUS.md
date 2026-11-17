# STATUS — Gradix v2

**Datum:** 2026-11-17 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Odluke / ops (2026-11-17)

| Stavka | Ishod |
|---|---|
| Cleanup + raspored (po koracima) | **prošlo** |
| 2a (backup/MinIO) | **PRIHVAĆEN** |
| ADR 0014 | **PRIHVAĆEN** |
| Plan 2c | **ODOBREN** — samo projekti; partneri van obima |
| Anonimizirani Exceli | **DA** (kod vlasnika; ne u repou) |
| B15 NE (stacionaža, partner, workflow) | u planu **R5** |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2 backup (MinIO drill + cleanup + raspored).
- **2c uvoz projekata:** `/ured/uvoz` → Projekti; preview/apply; integracija + E2E.

## Role — ko šta vidi

| Rola | Web | Mobilni | Ne vidi |
|---|---|---|---|
| OWNER | sve | Moj dan / Grupa | tuđe firme |
| ADMIN | − upravljanje vlasnikom | isto | vlasnika |
| PROJECT_MANAGER | Projekti… Radni dani | po vezi | Korisnici, Uvoz |
| SITE_SUPERVISOR | Radnici… Radni dani | Grupa / Moj dan | Korisnici, Uvoz |
| WORKER / DRIVER / … | po matrici | Moj dan | uredsko van opsega |
| ACCOUNTANT | Pregled + Radni dani (čitanje) | Moji rokovi | Korisnici, Uvoz |

## Ne radi / namjerno još nema

- **R4b**, **2d**, **partneri** (nema tabele) — nisu započeti.
- Mobilni E2E u CI zatvoren; A1 mobilna prijava poslije odjave — vlasnik.
- Redis samo dijagnostika; katalog nije javan.

## Dugovi

- `PLATFORM_ADMIN_EMAILS` privremeno; produkcija: ugasiti javnu MinIO konzolu.
