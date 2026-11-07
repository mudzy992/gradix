# FE-17 — prijedlog dashboard zona po ulozi

**Status: samo priprema za pregled nakon K2.** Nijedan raspored u ovom dokumentu nije odobren niti implementiran; ne mijenja postojeći UI, prava ili mobile. Zadržati D-040 tokene, WCAG AA, tekstualne alternative, loading/empty/error/retry i lokalizaciju. Raspored ispod je redoslijed informacija, ne odobreni vizuelni dizajn. KPI-jeve prikazati samo kada izvor i scope stvarno postoje; `null` nije nula.

## Zajednički okvir

1. Kontekst: firma, uloga, datum u zoni firme i obavijesti; PLATFORM_ADMIN prvo bira firmu.
2. Hitno: rokovi/prekidi samo iz dopuštenog scopea, status i tekst, ne samo boja.
3. KPI i trendovi: izvor, period, poređenje i prazno stanje; bez procjene procenta iz nule.
4. Operativne liste: limit/cursor, dostupna tabela i link samo uz važeće pravo.
5. Brze akcije: ista pravila kao navigacija; bez akcija koje rola ne smije izvršiti.

Podaci API-ja ostaju klijentski neutralni: UTC ISO-8601 instant, decimalni string za novac/količinu, jedinstven envelope greške i cursor/limit za nove liste. Poslovni kalendarski dan i zona su eksplicitni. Svaki novi agregat mora imati tenant i projektni scope, OpenAPI, role/cross-tenant E2E i jasan izvor podataka. Ne širiti prava zbog samog prikaza.

## PROJECT_MANAGER (voditelj projekta)

- **Zone:** projekti pod odgovornošću → rokovi zadataka i blokade → plan/izvedeno → osoblje i rad → dozvoljene akcije.
- **KPI kandidati:** broj dodijeljenih aktivnih projekata; otvoreni/istekli zadaci u dodijeljenim projektima; trend kreiranih zadataka; budžet/potrošnja samo ako je ovlašteno i potpunost poznata.
- **Postojeći izvori:** `GET /api/dashboard/projects` i `GET /api/analytics/tasks/created` imaju projektni assignment scope; `GET /api/projects`, `GET /api/tasks`, `GET /api/projects/:id/quantities` i `GET /api/notifications` koriste vlastite guardove i ograničenja. Provjeriti semantiku i paginaciju prije ponovne upotrebe.
- **Nedostaje:** zaseban bounded scopeovani zbir rokova/blokada, pouzdano projektno prisustvo i vremenski trend; aktuelni `/api/alerts/tasks`, `/api/analytics/summary`, `/api/presence/people` i `/api/analytics/timers/closed` su tenant-admin, ne pretpostaviti pristup PM-u.

## SITE_SUPERVISOR (nadzornik)

- **Zone:** današnji zadaci i sigurnost → dnevnik i količine → ljudi na dodijeljenim projektima → incidenti → dozvoljene akcije.
- **KPI kandidati:** aktivni zadaci i zakašnjeli rokovi u dodijeljenim projektima; dnevnici koji traže obradu; prijavljeni incidenti; evidentirani rad, uz jasnu razliku od lokacijskog prisustva.
- **Postojeći izvori:** `GET /api/dashboard/projects`, `GET /api/analytics/tasks/created`, `GET /api/tasks`, `GET /api/diary`, `GET /api/incidents`, `GET /api/projects/:id/quantities` i `GET /api/notifications`; scope svakog servisa zasebno provjeriti.
- **Nedostaje:** agregati današnjih rokova, kvalitetan projektni prikaz prisustva i pregled HSE-a u assignment scopeu; admin-only alerti/presence/timer trend nisu zamjena.

## ACCOUNTANT (računovođa)

- **Zone:** otvoreni finansijski period → troškovi i obračun rada → dokumenti/rokovi → provjera odstupanja → izvoz uz pravo.
- **KPI kandidati:** tačan zbir troškova po periodu, obračunatih sati/iznosa i broj dokumentnih rokova, sa pokrivenošću i statusom obračuna; bez novčanih grafova na binary float.
- **Postojeći izvori:** `GET /api/cost-entries`, `GET /api/payroll/summary`, `GET /api/payroll/sessions`, `GET /api/documents/company`, `GET /api/documents/worker`, `GET /api/documents/machine`, `GET /api/stock` i `GET /api/notifications` imaju zasebna pravila; provjeriti njihove filtere, DTO i servisne guardove. `GET /api/dashboard/projects` je permission-guarded, ali njegov konkretni company/project scope mora biti provjeren.
- **Nedostaje:** ograničeni periodični finansijski agregati i dokumentni alert za računovođu. `/api/analytics/summary`, `/api/alerts/documents` i `/api/analytics/timers/closed` trenutno dodatno traže tenant-admin rolu; njihova permisija sama ne odobrava pristup. Ne koristiti trend zadataka bez `tasks.read`.

## MECHANIC (mehaničar)

- **Zone:** neispravna oprema i prioritet servisa → planirani/otvoreni nalozi → uređaji i dijelovi dostupni po pravima → dozvoljene akcije.
- **KPI kandidati:** otvoreni/nadolazeći servisi, broj mašina u kvaru i kašnjenja održavanja; izvor i termin plana moraju biti pouzdani.
- **Postojeći izvori:** `GET /api/services`, `GET /api/service-templates`, `GET /api/machines`, `GET /api/machines/:id` i `GET /api/notifications`; postojeći `/api/dashboard` već bira mechanic varijantu. Provjeriti service-level scope, filtere i paginaciju.
- **Nedostaje:** bounded agregat prioriteta i istorijski trend održavanja; `erp.read` i admin dashboard alerti nisu dati samo zbog ove uloge.

## PLATFORM_ADMIN

- **Zone:** eksplicitan izbor firme → stanje izabrane firme → hitni signali → projekti, trendovi i aktivnost → administrativne akcije.
- **KPI kandidati:** isti provjerljivi agregati kao admin v2, ali samo u **izabranoj** firmi; bez izmišljene zbirne cross-tenant vrijednosti. Bez firme prikazati izbor i ne slati tenant upite.
- **Postojeći izvori:** `GET /api/companies` bez tenant konteksta; uz izabrani `X-Company-Id`: `GET /api/analytics/summary`, `/api/dashboard/projects`, `/api/analytics/tasks/created`, `/api/analytics/timers/closed`, `/api/alerts/tasks`, `/api/alerts/documents`, `/api/presence/people`, `/api/activity/events`. Svaki upit mora ostati vezan za izabrani tenant i provjerena prava.
- **Nedostaje:** pouzdan cross-company pregled ako ga vlasnik ikada zatraži; nije obuhvaćen niti se smije izračunati skupljanjem podataka bez zasebne odluke.

## Prije implementacije

Vlasnik prvo potvrđuje K2 i smjer svake role. Potom verifikovati postojeća servisna prava i podatke, specificirati nedostajuće endpoint-e bez screen-specifičnog formatiranja, pokriti ih unit/PG E2E testovima i tek onda raditi UI i pregled. Miješane role ne smiju proširiti podatke preko propisanog assignment scopea; dijeljenje više rola i tenant switch zahtijevaju zasebne testove.
