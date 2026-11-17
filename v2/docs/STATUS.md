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
| Rotacija tajni prije stvarnih podataka | **DA** (odluka); **nije urađena** → pilot samo sintetički |
| MinIO konzola / odredište do produkcije | **ostaje** (odluka) |
| Oblik pilota | **A** — 1 Android za šefa; trajanje **5** dana |
| B15 NE → R5 | stacionaža, partner, workflow |
| 2d | checklist u `COOLIFY.md` §13 — **nema koda** |
| PILOT.md usklađen | oblik A + day-1 lista — **nema koda** |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2 backup, 2c uvoz projekata (`/ured/uvoz`).

## Role (sažetak)

OWNER/ADMIN: sve evidencije + Uvoz + Korisnici. PM/šef: bez Korisnici/Uvoz.
WORKER…: po matrici (`permissions.ts`). Mobilni: Moj dan (workerId); Grupa (SITE_SUPERVISOR
+ foremanScope).

## Ne radi / namjerno još nema

- **R4b**, **R5**, **partneri** — ne počinju.
- **Izvršenje pilota** — nije započeto (docs usklađeni; čeka rotaciju za stvarne podatke).
- Mobilni E2E u CI zatvoren; A1 mobilna prijava poslije odjave — vlasnik.

## Dugovi / otvoreno

- Rotacija tajni (blokira stvarne podatke u pilotu); `PLATFORM_ADMIN_EMAILS`; MinIO konzola
  u produkciji; retencija; domene B11 \[OTVORENO\]; email provajder; ADR 0014 u produkciji.
