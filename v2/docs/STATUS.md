# STATUS — Gradix v2

**Datum:** 2026-11-18 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

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
| R4b UI ispravka (revise) | **isporučeno** | spremno |
| R5 / partneri | ne počinju | ne radi |

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
| R4b revise UI | **DA** (isporučeno) |
| R5 / partneri | **ne počinju** |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2, 2c, seed `@demo.test`.
- R4b: API + UI potvrda/sedmica/zaključaj/ispravka na `/ured/radni-dani`.
- Prilozi rokova; s3 dijagnostika Put/Get.

## Ne radi / namjerno još nema

- R5; partneri; Android store/dev build.

## Dugovi / otvoreno

- `PLATFORM_ADMIN_EMAILS` ako treba katalog; MinIO konzola / retencija / B11 / email / ADR 0014 (COOLIFY §13).
