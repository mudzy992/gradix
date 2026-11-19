# STATUS — Gradix v2

**Datum:** 2026-11-19 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Pilot: spremnost

Pilot = vlasnik testira **sve role** na Expo Go/emulatoru → `https://gradix.ba101.top` (**DA**).
Telefon i rotacija tajni **nisu** uslov pilota (rotacija → COOLIFY §13).

| Uslov | Stanje (unos vlasnika) | Oznaka |
|---|---|---|
| Pilot: sve role (Expo Go / emulator) | **DA** | spremno |
| Sintetički seed `@demo.test` | seed + prijava **PROŠLO** | spremno |
| Emulator 2c i A1 | **PRIHVAĆEN** | spremno |
| Kontrolna lista prvog dana (PILOT.md tabela) | na snazi | spremno |
| R4b API / migracije | **isporučeno** (`5ffa667`+) | spremno |
| R4b UI potvrda / sedmica / zaključaj | **PRIHVAĆEN** | spremno |
| R4b UI ispravka (revise) | **PRIHVAĆEN** | spremno |
| R5.1 Sati mašine | **isporučeno** (`046404e`, CI) | spremno |
| R5.2 Gorivo | **isporučeno** (`563c403`, CI 44573517449) | spremno |
| R5.3 Ture | **isporučeno** (`35fba11`) | rad |

**Provjera web kontejnera** (COOLIFY §12.1):

```sh
env | grep -E '^(DATABASE_ADMIN_URL|DATABASE_BACKUP_URL|RESTORE_ADMIN_URL|BACKUP_|MINIO_ROOT_)' \
  && echo 'FAIL: admin/backup varijable još na webu' \
  || echo 'PASS: nema DATABASE_ADMIN_URL ni backup/root MinIO varijabli'
```

## Odluke / ops (vlasnik)

| Stavka | Ishod |
|---|---|
| 2a; ADR 0014; 2c; emulator 2c+A1 | **PRIHVAĆEN** |
| `@demo.test`; staging seed/prijava | **ODOBRENO** / **PROŠLO** |
| Rotacija tajni | **URAĐENO** (vlasnik); COOLIFY §13 za produkciju |
| R4b dizajn · prolaz UI · s3 Put/Get | **ODOBREN** / **PRIHVAĆEN** / **ODOBRENO** |
| R4b revise UI | **DA** → **PRIHVAĆEN** (prolaz) |
| R5 plan | `PLAN-R5.md` — **ODOBREN**; R5.1–R5.3 kod |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2, 2c, seed `@demo.test`.
- R4b: API + UI potvrda/sedmica/zaključaj/ispravka na `/ured/radni-dani`.
- Prilozi rokova; s3 dijagnostika Put/Get.
- R5.1: `machine_work_logs` + očitanja + revizije; `/ured/sati-masine`; sync `machine_work_log`; mobil `/sati-masine`.
- R5.2: `fuel_entries` (Money) + revizije; `/ured/gorivo`; sync `fuel_entry`; mobil `/gorivo`; cijena sakrivena za DRIVER.
- R5.3: `hauls` + `route_segments` + revizije; `/ured/ture`; sync `haul`; mobil `/ture`; seed `vozac@demo.test`.

## Ne radi / namjerno još nema

- R5.4+ (dnevni pregled, kvarovi); partneri; Android store/dev build.

## Dugovi / otvoreno

- `PLATFORM_ADMIN_EMAILS` ako treba katalog; MinIO konzola / retencija / B11 / email / ADR 0014 (COOLIFY §13).
