# STATUS — Gradix v2

**Datum:** 2026-11-17 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Odluke / ops (vlasnik)

| Stavka | Ishod |
|---|---|
| 2a; ADR 0014; 2c; emulator 2c+A1 | **PRIHVAĆEN** / DA |
| Rotacija tajni | **DA** (odluka); stvarni podaci tek poslije izvršene rotacije |
| Telefon za šefa | **nema** |
| Oblik pilota A, 5 dana | **DA** |
| MinIO konzola do produkcije | **ostaje** |
| R4b / R5 / partneri | **ne počinju** |
| Seed email domen | `@demo.test` (+ `vlasnik@druga.test`) |
| `--reset-pilot` | `seed.ts --reset-pilot` + test |
| Expo Go SDK 58 | **radi** (`MOBILE-EXPO-GO.md`) |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2, 2c uvoz; seed; `--reset-pilot`.

## Role (sažetak)

OWNER/ADMIN: evidencije + Uvoz + Korisnici. PM/šef: bez Korisnici/Uvoz.
Mobilni: Moj dan (workerId); Grupa (SITE_SUPERVISOR + foremanScope).

## Ne radi / namjerno još nema

- R4b, R5, partneri; fizički telefon šefa; izvršenje pilota na uređaju.
- Mobilni E2E u CI se ne traži.

## Dugovi / otvoreno

- Izvršiti rotaciju tajni; `PLATFORM_ADMIN_EMAILS`; MinIO konzola u produkciji;
  retencija; B11; email provajder; ADR 0014 u produkciji.
