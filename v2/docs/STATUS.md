# STATUS — Gradix v2

**Datum:** 2026-11-17 · **Grana:** `v2-bootstrap` · Pregled (b0c419d) odobren.

## Odluke / ops (2026-11-17)

| Stavka | Ishod |
|---|---|
| Cleanup poslije MinIO drill-a (§12.1) | **DA** (urađeno) |
| Noćni backup raspored (§12.2) | **DA** (urađeno) |
| 2a (backup/MinIO drill) | **PRIHVAĆEN** |
| ADR 0014 (praćenje grešaka) | **PRIHVAĆEN** |
| Plan 2c (`PILOT.md`) | **ODOBREN** (bez izmjena plana) |
| Anonimizirani Exceli za 2c | **DA** (kod vlasnika; ne u repou) |

**2c / 2d:** implementacija 2c čeka novi prompt; **2d nije počeo**.

### B15 \[Rano u model\] × šema (2c / R4b / R5)

| Stavka (B15) | Bez izmjene šeme? | Razlog | Gdje u planu |
|---|---|---|---|
| Stacionaže / dionice (1) | **NE** | Nema tabele/kolona km+m; `projects` nema dionicu (`r3_projekti`). | `PILOT.md` 2c (ne uvoziti trase); `PLAN-R3` → lokacije R5 |
| Partner | **NE** | Nema `partners` (samo komentar u `schema.prisma`); 2c uvoz partnera traži novu tabelu. | `PILOT.md` 2c (proširenje vrsta); prije uvoza partnera — migracija |
| Tok odobravanja (14) | **NE** | Nema workflow/pragova; R4b sedmično odobrenje još nije u šemi (`PLAN-R4` §11). | `PILOT.md` 2c van workflowa; R4b plan |
| Valuta uz iznos | **DA\*** | `companies.currency` postoji (default BAM). \*Po-iznosni par Decimal+valuta još nema kolona — dodati tek kad dođu iznosi (ne u 2c). | `schema.prisma` komentar Money; `PILOT.md` 2c |
| Tenant / SaaS (22) | **DA** | `Company` + `Membership` (user≠firma) + RLS/`withCompany`; `PlatformUser` odvojen — multi-tenant bez promjene za osnovni SaaS sloj. | `PILOT.md` 2c; ADR/Membership |

Šta bi trebalo (samo opis, **nije** urađeno): stacionaža → tabela dionica/FK na projekat; partner → `partners` + FK; workflow → entiteti odobrenja (R4b+); po-iznos → amount+currency zajedno.

## Radi (CI)

- **R1–R4a-2, Pregled, UI, C.2 backup:** kako ranije; MinIO drill na stagingu **prošao**; cleanup + raspored **urađeni**.
- Seed: `SEED_PASSWORD` + `pnpm seed`.

## Role — ko šta vidi

| Rola | Web (meni) | Mobilni | Ne vidi |
|---|---|---|---|
| OWNER | sve | Moj dan / Grupa po vezi | tuđe firme (RLS) |
| ADMIN | kao vlasnik (− upravljanje vlasnikom) | isto | vlasnika |
| PROJECT_MANAGER | Projekti, Rokovi, Mašine, Radnici, Radni dani (opseg) | po vezi | Korisnici, Uvoz |
| SITE_SUPERVISOR | Radnici, Mašine, Projekti, Rokovi, Radni dani (opseg) | Grupa / Moj dan | Korisnici, Uvoz |
| WORKER | Pregled, Projekti, Rokovi, Mašine (SELF) | Moj dan | Radnici, Korisnici |
| DRIVER | Pregled, Projekti, Rokovi, Mašine (SELF) | Moj dan ako povezan | uredsko van opsega |
| MACHINE_OPERATOR | Pregled, Mašine, Projekti, Rokovi | Moj dan | Radnici, Korisnici |
| MECHANIC | Pregled, Mašine, Projekti, Rokovi | Moj dan ako povezan | Radnici, Korisnici |
| ACCOUNTANT | Pregled… + Radni dani (čitanje) | Moji rokovi/projekti | Korisnici, Uvoz |

## Ne radi / namjerno još nema

- **R4b**, **2c kod**, **2d** — nisu započeti.
- **Mobilni E2E u CI** zatvoren; **A1** mobilna prijava poslije odjave — vlasnik.
- **Redis** samo dijagnostika; katalog nije javan.

## Dugovi

- **PLATFORM_ADMIN_EMAILS:** privremeno.
- Produkcija: ugasiti javnu MinIO konzolu.
