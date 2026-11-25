# Izvještaj — Faza 6: Obračun sati i troška rada (Modul 7)

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Spec:** `07-obracun-sati-trosak-rada.md` (zaključano)

Faza 6 je isporučena kao **vertikala do kraja**: baza → domena → ugovor → API → servis → izvoz →
web → mobilni → podsjetnik → provjere. Nijedan sloj nije ostavljen kao „doći će poslije“.

---

## 1. Šta je napravljeno

### 1.1 Baza (1 migracija)

`20261125100000_f6_1_obracun`.

| Tabela | Zašto |
|---|---|
| `pay_periods` *(novo)* | Mjesec je jedinica obračuna: `OPEN → CALCULATED → APPROVED → LOCKED`, unique `(company_id, year, month)`; prelaze čuva `pay_period_transition_guard()` |
| `payroll_components` *(novo)* | Šifarnik po firmi (`EARNING/DEDUCTION`, `HOURS/DAYS/FIXED/PERCENT_OF_EARNINGS`, 10 kategorija) — dodavanje komponente ne traži izdanje klijenta |
| `payroll_parameters` *(novo)* | Vrijednost **sa datumom važenja**; preklapanje važenja se odbija (EXCLUDE + triger), pa iznos ne zavisi od reda u tabeli |
| `payroll_runs`, `payroll_run_lines`, `payroll_line_sources` *(novo)* | Revizija je zapis: `payroll_freeze_guard()` zamrzava izračunato. `payroll_line_sources` je **raspis** — koji su dani i parametri ušli u iznos |
| `worker_advances` *(novo)* | Akontacija (jednokratno) i pozajmica (rate); `remaining_cents` nosi ostatak u naredni mjesec |
| `pay_corrections` *(novo)* | Izmjena dana u `LOCKED` periodu otvara korekciju (`workdays_open_correction`) koja se primjenjuje u **narednom** periodu |
| `companies` | `+ overtime_basis ('DAILY'\|'WEEKLY')`, `+ overtime_weekly_threshold` |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + grant u
`bootstrap/grants.sql` (bez `DELETE`) + `schema.generated.ts` (**90 tabela**).

### 1.2 Domena — `packages/domain/src/payroll-hours.ts`

Klasifikacija sati je **jedan algoritam** sa 25 zlatnih testova:

- prioritet **jedne** kategorije po minuti: `PRAZNIK > NEDJELJA > NOĆNI > PREKOVREMENI > REDOVNI`
  — sat se nikad ne plaća dvaput, a zbir kategorija je uvijek jednak ukupnim satima;
- noćni prozor preko ponoći daje dva intervala, bez gubitka minute;
- **nema izmišljenog prozora**: firma bez `night_from`/`night_to` nema noćnih sati;
- dnevni **ili** sedmični osnov prekovremenog (nikad oba), prag nula nije tiho pravilo;
- izostanci su **dani**, ne sati.

### 1.3 API — 16 ruta (`packages/contracts/src/routes.ts`)

| Metoda | Ruta | Dozvola |
|---|---|---|
| GET/POST | `/api/pay-periods` | `payroll.view` / `payroll.manage` |
| POST | `/api/pay-periods/{id}/calculate` | `payroll.manage` |
| POST | `/api/pay-periods/{id}/approve`, `/lock` | `payroll.approve` |
| GET | `/api/pay-periods/{id}/lines`, `/api/payroll/lines/{id}/sources` | `payroll.view` |
| GET | `/api/pay-periods/{id}/export?format=xlsx\|csv&includeProvisional` | `payroll.hours.export` |
| GET/POST/PATCH | `/api/payroll/components`, `/api/payroll/parameters` | `payroll.view` / `payroll.manage` |
| GET/POST | `/api/workers/{id}/advances`, `/api/payroll/corrections` | `payroll.view` / `payroll.manage` |
| GET | `/api/me/payroll?year=&month=` | `payroll.own.view` |

4 nove dozvole (`payroll.view`, `payroll.manage`, `payroll.approve`, `payroll.own.view`),
8 novih kodova grešaka (`RATE_MISSING` 422, `PARAMETER_MISSING` 422, `PERIOD_NOT_READY` 409,
`SELF_APPROVAL_FORBIDDEN` 403, `PERIOD_LOCKED_CORRECTION` 409, `NEGATIVE_NET_FORBIDDEN` 422,
`PAYROLL_ALREADY_LOCKED` 409, `PAYMENT_FORMAT_UNSUPPORTED` 400). OpenAPI: **182 putanje**.

### 1.4 Servis obračuna — `payroll-period-service.ts`

- **Satnica na dan rada** iz `worker_rates` (historija), koeficijent primijenjen; `HOURLY/DAILY/
  MONTHLY/160 h/COEFFICIENT`; koeficijent bez osnovice → `RATE_MISSING`.
- **Bez tihe nule**: nedostajuća satnica ili parametar daje liniju **bez iznosa** sa statusom, a
  period se ne odobrava; djelimičan zbir se ne prikazuje (`null`).
- **Odbici do nule**: granica je zarada **tog radnika**, ostatak u `remaining_cents`.
- `SELF_APPROVAL_FORBIDDEN`, `CALCULATED → APPROVED → LOCKED`, korekcije u naredni period.
- **Trošak rada** u `cost_entries` kroz postojeći `bookWorkdayCost` — jedna knjiga po danu i
  projektu, ponovni izračun je preskače (`cost_entries_written` / `cost_entries_skipped`).
- `getMyPayroll` šalje linije radniku bez `payroll.view` (interna provjera + filter po radniku).

### 1.5 Izvoz — `payroll-export.ts`

XLSX sa dva lista (`OBRAČUN` — radnik × komponente; `RASPIS` — linija sa izvorima) i CSV istog
sadržaja; `export_format_version = OBRACUN-1` u zaglavlju; default **samo `LOCKED`**; provizorni
izvoz je eksplicitan i označen u fajlu.

### 1.6 UI

| Ekran | Sadržaj |
|---|---|
| `/ured/obracun-sati` | Lista perioda: mjesec × status × radnika × bruto + **Spremnost** (blokade imenovane prije klika) |
| `/ured/obracun-sati/[period]` | Radnik × komponente, crtica i razlog za linije bez iznosa, Izračunaj / Odobri / Zaključaj (dugmad prate stanje), XLSX/CSV, **raspis** kroz dijalog |
| `/ured/obracun-sati/postavke` | Komponente (gašenje, ne brisanje) + parametri sa datumom važenja i „ko je potvrdio“; nedostajući kodovi na vrhu |
| `/ured/obracun-sati/sati` | Dosadašnji izvoz sirovih sati — ostaje za PM/šefa (`payroll.hours.export`), bez iznosa |
| `/ured/radnici/[id]` | Tab „Obračun“: akontacije/pozajmice sa ostatkom, korekcije |
| mobilno `/moj-obracun` | Sati po danu za izabrani mjesec; iznosi tek kad je period odobren (uz razlog kad nije) |
| `/pregled` | Podsjetnik „period nije zaključan“ — **poslije 5.** u mjesecu, za one koji vide obračun |

### 1.7 Provjere

| Provjera | Rezultat |
|---|---|
| `payroll-hours.test.ts` (domena) | 25 prošlo |
| `payroll-period.integration.test.ts` (prava baza) | **17 prošlo** — svih 17 tačaka iz spec §5 |
| `payroll-ui.test.ts` | 11 prošlo (novac, zbir, spremnost) |
| `payroll-reminder.test.ts` | 2 prošlo |
| `nul-guard.integration.test.ts` | 9 prošlo (F6 rute uključene) |
| `apps/web` ukupno | **110 fajlova / 658 testova prošlo** |
| domena ukupno | 17 fajlova / 251 test prošlo |
| `pnpm typecheck` | 6/6 ✓ |
| `pnpm lint` | čist (0 grešaka, 0 upozorenja) |
| `check-tenant-sql` | 820 upita ✓ |
| OpenAPI | 182 putanje, „ažuran“ |
| `next build` | ✓ (4 nove rute obračuna) |

---

## 2. Odluke koje se ne smiju izgubiti

1. **Sat se ne plaća dvaput** — jedna kategorija po minuti, prioritet je fiksan i testiran.
2. **Nema izmišljenih stopa.** Nijedan zakonski procenat nije u kodu; `OVERTIME_MULTIPLIER = 1.0`
   je **neutralni** množilac koji dolazi s firmom, jer bi bez njega svaki prekovremeni sat bio
   `PARAMETER_MISSING` (odsustvo uvećanja, ne nedostatak podatka).
3. **Nedostatak podatka nije nula.** `RATE_MISSING`/`PARAMETER_MISSING` → linija bez iznosa,
   blokirano odobrenje, crtica i razlog na ekranu.
4. **Satnica se čita na dan rada**, pa promjena satnice ne prepisuje stari obračun.
5. **Zaključan period se ne preračunava** — ispravka je `pay_corrections` u narednom periodu.
6. **Odbici ne stvaraju negativan obračun**, a granica je zarada tog radnika.
7. **Šifarnik komponenti nastaje lenjo** (`ensureComponents`), ne u migraciji: `created_by` je
   NOT NULL na stvarnog korisnika, pa bi unaprijed popunjen set držao RESTRICT veze ka
   `users`/`companies` za firme koje obračun nikad nisu otvorile. (Otkriveno integracionim
   testovima: brisanje korisnika u drugim testovima je padalo na FK.)
8. **Tuđi ID vraća prazan skup**, ne `NOT_FOUND` — razlika bi odala postojanje perioda u drugoj firmi.

---

## 3. Van opsega (Faza 2, uz pisanu potvrdu računovođe)

Bruto→neto, doprinosi, porez, olakšice, platni listić PDF, uplatni nalozi, bankovni izvoz.
`payroll_run_lines.gross_cents`/`net_cents`/`contributions` ostaju prazni u MVP-u.
