# STATUS — Gradix v2

**Datum:** 2026-11-17 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Pilot: spremnost

Pilot **ne počinje** dok vlasnik ne kaže **POČNI PILOT**. Ispod samo potvrđeni unosi.

| Uslov (PILOT.md) | Stanje (odluka / unos vlasnika) | Oznaka |
|---|---|---|
| Oblik A | DA (potvrđen) | spremno |
| Trajanje 5 dana | DA (potvrđen) | spremno |
| Sintetički podaci (`.test` / seed) | Preimenovanje `@demo.test` **ODOBRENO**; staging seed **PROŠLO** | spremno |
| Rotacija tajni prije stvarnih podataka | Odluka **DA**; izvršenje rotacije **nije** potvrđeno ovdje | čeka vlasnika |
| Emulator 2c i A1 | **PRIHVAĆEN** | spremno |
| Telefon za šefa (oblik A) | **NEMA** | ne radi |
| Seed + prijava `sef@demo.test`, `ured@demo.test` | **PROŠLO** | spremno |

**Provjera web kontejnera** (poslije čišćenja backup/drill env — COOLIFY §12.1): u Coolify
terminalu **web** servisa:

```sh
env | grep -E '^(DATABASE_ADMIN_URL|DATABASE_BACKUP_URL|RESTORE_ADMIN_URL|BACKUP_|MINIO_ROOT_)' \
  && echo 'FAIL: admin/backup varijable još na webu' \
  || echo 'PASS: nema DATABASE_ADMIN_URL ni backup/root MinIO varijabli'
```

## Odluke / ops (vlasnik)

| Stavka | Ishod |
|---|---|
| 2a; ADR 0014; 2c; emulator 2c+A1 | **PRIHVAĆEN** |
| `@demo.test` nalozi | **ODOBRENO**; staging seed/prijava **PROŠLO** |
| Rotacija tajni | **DA** (odluka); izvršenje čeka potvrdu |
| Telefon za šefa | **NEMA** |
| Oblik A, 5 dana | **DA** |
| R4b / R5 / partneri | **ne počinju** |
| POČNI PILOT | **nije** rečeno |

## Radi (CI)

- R1–R4a-2, Pregled, UI, C.2, 2c, seed `@demo.test`, `--reset-pilot`.

## Ne radi / namjerno još nema

- R4b, R5, partneri; fizički telefon šefa; izvršenje pilota bez **POČNI PILOT**.

## Dugovi / otvoreno

- Izvršiti/potvrditi rotaciju tajni prije stvarnih podataka; telefon za oblik A;
  `PLATFORM_ADMIN_EMAILS` na stagingu ako katalog treba platform admina; MinIO konzola;
  retencija; B11; email; ADR 0014 u produkciji.
