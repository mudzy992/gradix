# Program audita Gradix Weba — pravila rada

**Faza 0 · Snimak 2026-11-27.** Obuhvat je `v2/apps/web` i zajednički `v2/packages/*` koje web koristi. Mobilnu aplikaciju ne dizajniramo, ne mijenjamo niti testiramo; samo pazimo da zajedničke izmjene ne slome njen `typecheck`/`test`. Dokumenti i UI su na bosanskom ijekavskom.

## 1. Šta je modul i inventar

Modul je vertikalni korisnički posao: UI i API, servis/domenska pravila, vlasništvo nad podacima, worker poslovi i postojeći testni dokazi. Zajednička osnova je označena kao takva, ne pripisuje se dvaput. Ovo je sažeta provjerena mapa; putanje, tabele, testni ankeri i neslaganja su u [`INVENTAR.md`](INVENTAR.md). Fajl koji postoji ne dokazuje da je funkcija potpuna, testirana, deployana ili odobrena uživo.

| # / modul · spec | Web / API | Server → domena | Tabele · poslovi · testni ankeri |
|---|---|---|---|
| 1 Firma/pristup · 01 | login/lozinka/platform; postavke/korisnici/role/audit/profil; auth/company/users | access/auth/session/RBAC → auth/sessions/TOTP | companies/users/sessions/audit; notify shared; access/RBAC/2FA/passkeys |
| 2 Obaveze · 02 | rokovi; obligations/types/requirements | obligation-* → obligations | obligations/versions/requirements; reminders + attachment purge; obligation tests |
| 3 Radno vrijeme/sync · 03 | radni dani/sedmica/sukobi; workdays/weeks/sync | workday-*/sync-* → workdays/r4-sync | workdays/entries/sync; sync purge; phase3/workday/sync |
| 4 Radnici · 04 | radnici/kartica; workers/PPE | worker-service → nema zasebne workers domene | workers/rates/PPE; bez posebnog posla; phase3/scope/UI |
| 5 Mehanizacija · 05 | mašine/sati/ture/gorivo/kvarovi/kalendar; equipment/machines/fuel/hauls | equipment/machine/fuel/haul-* → machine-cost/assignments | machines/fuel/hauls/checks; reminders održavanja u 09; equipment/fuel/haul/check |
| 6 Projekti/troškovi · 06 | projekti/zadaci/uvoz/kategorije; projects/tasks/costs/imports | project/cost/task/import-* → projects/money | projects/budget/cost_entries; budget thresholds; projects/cost/task/import |
| 7 Obračun sati · 07 | obračun/period/postavke/izvoz; pay-periods/payroll | payroll-period/export → payroll-hours | pay_periods/runs/sources; bez posebnog posla; payroll-period/hours |
| 8 Tenderi · 08 | tenderi/detalj/kalendar/uspješnost; tenders | tender-*/pricing/convert → tender-calculation | tenders/BOQ/revisions/outcomes; reminders čita obaveze; tender lifecycle/pricing |
| 9 Servis/održavanje · 09 | servis/planovi/dijelovi; service-orders/maintenance/stock | service-order/maintenance/stock-* → service-maintenance | service_orders/maintenance/stock; reminders scan; f8-service/isolation/domain |
| 10 Dnevnik/HSE · 10 | dnevnik/HSE/inspekcije/obuke; site-diaries/HSE | diary/HSE-* → site-diary-HSE | site_diaries/HSE; reminders iz specifikacije za provjeru; f9-diary-HSE/sync |
| 11 Skladište/nabavka/partneri/podizvođači · 11 | skladište/nabavka/partneri/podizvođači; stock/purchase/partners | warehouse/stock/purchase/partner/subcontract-* → warehouse-purchase | warehouses/purchase/subcontractors; bez posebnog posla; f10 integracije/UI |
| 12 Pregled/izvještaji/obavještenja · 12 | pregled/akcije/izvještaji/inbox; dashboard/reports/notifications/search | pregled/dashboard/data-health/report/notification → report-definitions | notifications/report_jobs/rollups; svi worker poslovi; pregled/data-health/report |

## 2. Redoslijed i invarijante

Predloženi redoslijed: **1 → 2 → 3/4 → 5 → 6 → 7 → 9 → 8 → 10 → 11 → 12**. Prvo se provjeravaju tenant/pristup i zajednički temelji, zatim izvorni zapisi rada, radnika i mašina. Projekti/ledger prethode obračunu, a servis prethodi tenderima zbog rizika troška i veza s kvarovima/zaliha; pregled i izvještaji dolaze zadnji jer čitaju skoro sve. Promjenu redoslijeda odobrava vlasnik na G1.

- Svaki poslovni DB tok koristi `withCompany`; provjeriti tenant/RLS/grant i IDOR, ne zaključivati iz skrivenog UI-ja.
- Novac samo kroz `Money` (BigInt centi + valuta); nepoznat iznos ostaje `NULL`; knjiženi trag se stornira novim zapisom, ne prepisuje. Historijske/revizijske tabele ostaju append-only gdje to nalaže specifikacija.
- Obavještenja samo kroz `notify()`; obavezni lokalni `href`, deduplikacija i pravila kanala.
- Cursor paginacija je zadana; offset samo za male administrativne liste. Ruta je tanka, pravila u domeni/servisu, a funkcije ostaju u klijentskom omotaču.
- UI je catalog-first i koristi postojeće komponente. Nova komponenta/vizuelni obrazac ide u `UI-ODOBRENJE` i čeka vlasnika.
- Svaki worker posao je tenant-scopovan po izvršenju, idempotentan i siguran za retry. Promjena zajedničkog paketa ne smije slomiti mobilni ugovor/sync; mobilni nije predmet audita.

## 3. Dokazi, težina i granice

Tvrdnja o kodu navodi putanju, po mogućnosti liniju/simbol. „Prolazi“ navodi stvarno izvršenu komandu, rezultat/broj i datum. Fajl/test koji postoji nije dokaz izvršavanja; migracija nije dokaz primjene; CI nije dokaz produkcije ni vlasnikovog pregleda. Statusi se razdvajaju: `POSTOJI`, `TESTIRANO`, `CI`, `DEPLOY`, `VLASNIK UŽIVO`.

- **S0:** tenant-data leak, zaobilaženje role ili gubitak/pokvarenost novca — odmah vlasniku i stani na zahvaćenom radu.
- **S1:** štetna greška korisnika ili nemoguć ključni tok — obavezno zatvoriti prije pregleda.
- **S2:** spor/zbunjujući tok ili nedosljednost — planirati popravku. **S3:** kozmetika/dug — `ODLOŽENO`.

Sve izvan zaključanog briefa/specifikacija ide u `ODLOŽENO`; bez usputnog refaktorisanja. Bez izmjene poslovnog koda prije vlasnikove fraze **`KREĆEMO U KODIRANJE: <modul>`**. Ne počinjati module prije potvrde G0.

## 4. Stanje, šabloni i kapije

Svaka sesija počinje čitanjem `STATE.md`; pri svakoj predaji ažurirati ga (≤40 linija: faza, modul, urađeno, sljedeće, pitanja, zadnji pregledani kodni commit). Faza 1 ide 3–4 modula po sesiji; po svakom modulu STATE i zaseban commit/push. Artefakti modula: `NN-ime/{01-AUDIT,02-DIZAJN,03-PLAN,04-MATRICA}.md` (svaki ≤6 stranica); nakon 12 modula slijedi `00-UKRSTENO.md` i G1. U Etapi B radi se jedan odobreni modul: `05-IZVJESTAJ.md` (≤3 stranice; ishodi, stvarni dokazi, neprovjereno/rizici, odluke vlasnika, koraci živog pregleda, sljedeći korak). Nikad ne piše „završen“ prije vlasnikovog pregleda — koristi „spreman za vlasnikov pregled“.

G0 predaje `PRAVILA.md`, provjereni inventar, ADR 0018 i STATE; potom stani. G1 tek nakon svih audita i ukrštenog pregleda. Kod počinje samo nakon zasebne vlasnikove fraze po modulu. Programski artefakti žive samo u `v2/docs/audit-program/` i izuzeti su iz limita `docs/` od 30 stranica; pravilo 7 važi za sve ostalo (`STATUS.md` ≤100 linija, ADR ≤1 stranica).
