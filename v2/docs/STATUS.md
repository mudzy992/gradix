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
| R5.3 Ture | **isporučeno** (`9b6193e`, CI 44580192908) | spremno |
| R5.4 Dnevni pregled | **isporučeno** (`ab0b81c`, CI 44592292030) | spremno |
| R5.5 Kvarovi | **isporučeno** (`1b11b6e`, CI 44601944551) | spremno |
| R6.0 Sidebar regroup | **isporučeno** (`06658f5`) | spremno |
| R6.1 Trošak mašine / knjiženje | **isporučeno** (`4236619`, CI 44629910111) | spremno |
| R6.2 Obračun sati CSV + dashboard | **isporučeno** (`9096017`, CI 44709218406) | spremno |
| L0–L2 Shell layout + catalog-first | **isporučeno** (`ca306a3`, CI 44721018930) | spremno |

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
| R5 plan | `PLAN-R5.md` — **ODOBREN**; R5.1–R5.5 kod |
| R6 plan | `PLAN-R6.md` — **ODOBREN**; R6.0–R6.2 kod |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2, 2c, seed `@demo.test`.
- R4b: API + UI potvrda/sedmica/zaključaj/ispravka na `/ured/radni-dani`.
- R5.1–R5.4: sati, gorivo, ture, dnevni pregled + sync + mobilni.
- R5.5: `partners` + `machine_faults` + `approval_requests`; Money; prag → WAITING_APPROVAL;
  `/ured/kvarovi`; sync `machine_fault`; mobil `/kvarovi`.
- R6.0: sidebar Pregled / Evidencija / Mehanizacija / Rad·obračun / Administracija.
- R6.1: `machine_cost_rates` + `project_cost_entries`; `/ured/trosak-masina`, `/ured/troskovi-projekta`.
- R6.2: `GET /api/workdays/hours-export` CSV; `/ured/obracun-sati`; dashboard agregati na `/pregled`.
- L0–L2 (prije R7): fiksni shell `100dvh`, interni skrol bez scrollbar-a (`.gx-page` / `.gx-nav`),
  collapsible nav grupe (`sessionStorage` `gx.nav.groups`), catalog-first u DESIGN.md + AGENTS.md.
- Shell×liste audit: `gx-table-scroll`, floating portal meni (RowActions/user), actionbar sticky u page;
  Expo shell bez izmjene (Stack `headerShown: false` — namjerno, nije web parity).

## Ne radi / namjerno još nema

- Partneri UI; R7+ (namjerno STOP nakon L0–L2); Android store/dev build; puna plata.

## Dugovi / otvoreno

- `PLATFORM_ADMIN_EMAILS` ako treba katalog; MinIO konzola / retencija / B11 / email / ADR 0014 (COOLIFY §13).
