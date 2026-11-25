# Izvještaj — Faza 7: Tenderi (Modul 8)

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Tag:** `phase-7` ·
**Spec:** `08-tenderi.md` (zaključano)

Faza 7 je isporučena kao **vertikala do kraja**: baza → domena → ugovor → API → servis → web →
worker → provjere. Tender nije „još jedan spisak ponuda“: on ima tok sa kapijama, kalkulaciju
koja se ne prepisuje, i konverziju koja od dobijenog tendera pravi projekat — atomski.

---

## 1. Šta je napravljeno

### 1.1 Baza (1 migracija)

`20261125120000_f7_1_tenderi`.

| Tabela | Zašto |
|---|---|
| `tenders` *(proširena)* | 9 statusa (`OPPORTUNITY → GO_NO_GO → PREPARATION → SUBMITTED → EVALUATION → WON/LOST/WITHDRAWN/CANCELLED`), `deadline_at`/`questions_deadline_at`/`site_visit_at`/`opened_at`, `source`/`portal_name`/`external_ref`, `estimated_value_cents`, `price_source`, `markup_pct`, `current_revision`, `converted_project_id` |
| `tender_boq_items` *(novo)* | Predmjer ponude: količina + jedinični trošak + jedinična cijena, u centima |
| `tender_resources` *(novo)* | Resursi (rad, mašina, materijal, podizvođač) sa količinom i troškom |
| `tender_calculation_items` *(novo)* | Raspis obračuna: šta je ušlo u koji iznos i po kojoj stopi |
| `tender_price_revisions` *(novo)* | Revizija je zapis: `direct_cost_cents`, `markup/risk/discount`, `offered_value_cents`, `approved_at`; triger `TENDER_PRICE_REVISION_IMMUTABLE` odbija svaku izmjenu |
| `tender_price_approvals` *(novo)* | Ko je odobrio koju reviziju i zašto je odobrenje traženo |
| `tender_checklist_templates`, `tender_checklist_items` *(novo)* | Kontrolna lista dokumenata po firmi i po tenderu; garancija je stavka liste sa `guarantee_type`, `bank`, `amount_cents`, `valid_until`, `returned_at` |
| `tender_phases`, `tender_team` *(novo)* | Faze posla i predloženi tim — ono što konverzija prenosi na projekat |
| `tender_outcomes` *(novo)* | Ishod: `result`, `lost_reason`, pobjednik, broj ponuda, naš rang |
| `obligations` | `+ tender_id` u `obligations_one_scope` (opseg je **tačno jedan**: radnik/machine/projekt/tender/firma), FK na tender; novi tipovi `TENDER_DEADLINE`, `TENDER_QUESTIONS` |

Sve nove tenant tabele: `FORCE RLS` + politika + `privilege-matrix.tsv` + grant u
`bootstrap/grants.sql` (**bez `DELETE`** nad tenderima) + `schema.generated.ts` (**98 tabela**).

### 1.2 Domena — `packages/domain/src/tender-calculation.ts`

- `direct = Σ predmjer + Σ resursi`
- `base = direct × (1 + marža + rezerva)`
- `offered = base × (1 − popust)` — popust je u **stotinkama procenta**, račun u `bigint`
- `margin_pct = (offered − direct) / offered` — marža je uvijek **u procentu ponuđenog**
- prag odobrenja: `|promjena| > 5 %` **ili** marža `< companies.min_markup_pct`; prva revizija
  nema prethodnu vrijednost, pa prag promjene nema od čega da se mjeri
- `blockingChecklistItems`: `required` stavka prolazi samo kao `ATTACHED` ili
  `NOT_APPLICABLE` **sa razlogom**

17 zlatnih testova (`tender-calculation.test.ts`), uključujući granicu 5 % i popust 100 %.

### 1.3 API — 24 nove rute

| Ruta | Šta radi |
|---|---|
| `GET/POST /api/tenders` | lista (brojevi, ne sirovi redovi) i unos (uz provjeru partnera, valute i jedinstvenog `external_ref`) |
| `GET/PATCH /api/tenders/:id` | detalj i izmjena; kapije su u `changeStatus`, ne u ruti |
| `POST .../decision` | odluka o učešću DA/NE + razlog ≥ 3 znaka; NE vodi odmah u `CANCELLED` |
| `POST .../copy` | kopiranje predmjera/resursa/kontrolne liste iz sličnog tendera |
| `POST .../convert` | atomska konverzija `WON` → projekat |
| `GET/POST .../boq`, `PATCH/DELETE .../boq/:itemId` | predmjer |
| `GET/POST .../resources`, `DELETE .../resources/:resourceId`, `GET .../resources/suggestion` | resursi i predlog cijene iz historije |
| `GET .../calculation` | obračun (ACCOUNTANT → `FORBIDDEN`) |
| `GET/POST .../price-revisions`, `POST .../price-revisions/:revision/approve` | revizije i odobrenje |
| `GET .../checklist`, `PATCH .../checklist/:itemId` | kontrolna lista |
| `POST .../guarantees`, `POST .../guarantees/:itemId/return` | garancije i povrat |
| `GET/PUT .../outcome` | ishod |
| `GET /api/tenders/performance` | uspješnost (win rate po broju i vrijednosti, marže, po naručiocu, „u toku“) |
| `GET/POST .../team`, `DELETE .../team/:workerId`, `POST .../phases` | predloženi tim i faze |
| `GET/POST /api/tender-checklist-templates` | šifarnik kontrolne liste |

3 nove dozvole: `tenders.price.manage` (OWNER/ADMIN/PM), `tenders.price.approve` (OWNER/ADMIN),
`tenders.outcome.manage` (OWNER/ADMIN/PM). 6 novih kodova grešaka + `ALREADY_CONVERTED`:
`TENDER_CHECKLIST_INCOMPLETE`, `TENDER_DEADLINE_REQUIRED`, `TENDER_DECISION_REQUIRED`,
`TENDER_OUTCOME_REASON_REQUIRED`, `TENDER_PRICE_APPROVAL_REQUIRED` (422);
`TENDER_REFERENCE_TAKEN`, `TENDER_INVALID_STATUS`, `ALREADY_CONVERTED` (409).

### 1.4 Servisi

| Fajl | Odgovornost |
|---|---|
| `tender-service.ts` | unos, izmjena, **kapije** u `changeStatus`, odluka o učešću, automatske tenderske obaveze |
| `tender-pricing.ts` | predmjer, resursi, obračun, revizije, odobrenje, `approvedRevisionValue` |
| `tender-checklist-service.ts` | šifarnik (`DEFAULT_CHECKLIST_TEMPLATES`), lenjo punjenje liste, stavke, garancije i povrat |
| `tender-outcome-service.ts` | ishod i `tenderPerformance` |
| `tender-copy.ts` | kopiranje iz sličnog tendera |
| `tender-convert.ts` | atomska konverzija: projekat, faze, obaveze izvođenja, predmjer 1:1, prilozi kao **nove veze** na isti `object_key`, tim kao predlog |
| `tender-team-service.ts` | predloženi tim i faze tendera |

### 1.5 Web

- `/ured/tenderi` — tabela + kanban, filter po statusu i hitnosti, dijalog novog tendera sa
  opcijom kopiranja predmjera, akcija „Pretvori u projekat“.
- `/ured/tenderi/[id]` — 7 tabova: Pregled (odluka, rokovi, status), Kalkulacija (predmjer,
  resursi, obračun, revizija, odobrenje), Dokumenti (kontrolna lista + garancije), Prilozi
  (prilozi + rokovi), Ishod, Tim, Konverzija. Tab koji rola ne smije vidjeti se **ne prikazuje**.
- `/ured/tenderi/uspjesnost` — win rate, marže, po naručiocu, vrijednost u toku.
- `/ured/tenderi/kalendar` — rokovi dostave, pitanja, obilazak, otvaranje i istek garancija.

### 1.6 Worker

`reminders.scan` sada poznaje tenderske obaveze: `entityLabel` daje „Tender — naslov“, a `href`
vodi na `/ured/tenderi/{id}` (ne na F2 ekran `/rokovi/:id`, koji tender ne poznaje).

---

## 2. Provjere

| Provjera | Rezultat |
|---|---|
| `apps/web` vitest (sa `REQUIRE_DB_TESTS=1`) | **111 fajlova / 670 testova ✓** |
| `packages/domain` vitest | 18 fajlova / 268 testova ✓ |
| `apps/worker` vitest | 22 prošlo, 3 preskočeno ✓ |
| `pnpm typecheck` | 6/6 paketa ✓ |
| `pnpm lint` | čist ✓ |
| `pnpm check-tenant-sql` | 915 upita, svi nose `company_id` ✓ |
| matrix parity (`node quality/check-matrix-parity.mjs`) | **0 grešaka**, 1 poznato upozorenje (`R1.tenant.tables-through-r2`) |
| OpenAPI | 199 putanja, „ažuran“ ✓ |
| NUL-sweep | pokriva svih 20 novih ruta + postojeće |
| `nav.test.ts` / `server-boundary.test.ts` | dvije nove stranice imaju razlog u listi izuzetaka; klijentski wrapperi za tabele ✓ |

### 2.1 Novi integracioni testovi (protiv prave baze)

- `tender-lifecycle.integration.test.ts` — 8 testova: `OPPORTUNITY` umjesto `DRAFT`, `submitted_at`
  samo na predaji, nedozvoljen prelaz, kapija odluke, novac, partner, dozvole, izolacija firme B.
- `tender-convert.integration.test.ts` — 8 testova: jedna konverzija, `ALREADY_CONVERTED`,
  `TENDER_INVALID_STATUS`, prava, prilog bez skladišta, prilozi kao nove veze, `obligations_one_scope`,
  deaktiviran partner.
- `tender-convert-race.integration.test.ts` — 3 testa: dvije istovremene konverzije ostavljaju
  **jedan** projekat; izgubljen claim poništava projekat; neuspjeh ne blokira kasniji uspjeh.
- `tender-pricing.integration.test.ts` — 8 testova: direktni trošak, `FORBIDDEN` za ACCOUNTANT,
  prag odobrenja, imutabilnost revizije, pravo odobrenja, blokada predaje kontrolnom listom,
  idempotentan seed, uspješnost bez marže za role bez prava.
- `tender-status.test.ts` — 6 testova, uključujući **parity** svih 76 prelaza iz matrice.

---

## 3. Odluke koje se ne smiju izgubiti

1. **Devet statusa, nikad `DRAFT`.** `DRAFT` je ukinut u matrici, registru, servisu i UI-u.
   Matrica je jedan izvor; parity test pada ako se kod i matrica raziđu.
2. **Kapije su uslov prelaza.** Bez odluke nema pripreme; bez roka i kompletne liste nema predaje;
   bez ishoda koji se poklapa sa statusom nema zatvaranja.
3. **Revizija je append-only.** Triger u bazi, ne samo konvencija u servisu. Odobrenje je zasebno
   pravo (`tenders.price.approve`), pa „onaj koji je unio cijenu“ nije nužno „onaj koji je odobrio“.
4. **ACCOUNTANT ne dobija kalkulaciju.** `markupPct = null`, `GET …/calculation` → `FORBIDDEN`,
   tab skriven. Skrivanje u UI-u bez skrivanja u odgovoru nije skrivanje.
5. **Konverzija ide tačno jednom.** Claim je `UPDATE … WHERE converted_project_id IS NULL`;
   dva istovremena zahtjeva ostavljaju jedan projekat, drugi dobija `ALREADY_CONVERTED`.
6. **Prilozi se ne premještaju na projekat.** Nastaju nove veze na isti `object_key`; brisanje na
   projektu ne briše tender, a bajtovi se ne dupliraju.
7. **Kontrolna lista se puni lenjo, ne u migraciji.** Šifarnik zavisi od `created_by`, pa bi seed
   u migraciji pao na FK-u; `ensureChecklistTemplates` je idempotentan.
8. **Popust je u stotinkama procenta.** `"10"` = 10 %; sve u `bigint` centima, bez `float`.
9. **Tenderski rok vodi na tender.** Worker podsjetnik nosi `href = /ured/tenderi/{id}` i labelu
   „Tender — naslov“; `/rokovi/:id` je F2 ekran i ne poznaje tender.
