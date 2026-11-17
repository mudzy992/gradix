# STATUS — Gradix v2

**Datum:** 2026-11-17 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Odluke / ops (vlasnik)

| Stavka | Ishod |
|---|---|
| Cleanup + raspored; 2a; ADR 0014; 2c uvoz | **PRIHVAĆEN** / prošlo |
| Emulator 2c + A1 | **PRIHVAĆEN** |
| Rotacija tajni | **DA** (odluka); stvarni podaci tek poslije uradjene rotacije |
| Telefon za šefa | **nema** |
| Oblik pilota A, 5 dana | **DA** (potvrđen) |
| MinIO konzola do produkcije | **ostaje** |
| B15 NE → R5; R4b; partneri | **ne počinju** |
| 2d checklist | `COOLIFY.md` §13 |
| Put šef / Expo Go + seed reset | `MOBILE-EXPO-GO.md` — **nema novog mehanizma** |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2 backup, 2c uvoz; seed idempotentan
  (`seed-demo.integration.test.ts`).

## Role (sažetak)

OWNER/ADMIN: evidencije + Uvoz + Korisnici. PM/šef: bez Korisnici/Uvoz.
Mobilni: Moj dan (workerId); Grupa (SITE_SUPERVISOR + foremanScope).

## Ne radi / namjerno još nema

- **R4b**, **R5**, **partneri**; izvršenje pilota na telefonu (**nema** uređaja).
- Mobilni E2E u CI se ne traži; fizički prolaz Expo Go → šef **nije** urađen ovdje.

## Dugovi / otvoreno

- Izvršiti rotaciju tajni prije stvarnih podataka; `PLATFORM_ADMIN_EMAILS`; MinIO konzola
  u produkciji; retencija; B11 domene; email provajder; ADR 0014 u produkciji.
