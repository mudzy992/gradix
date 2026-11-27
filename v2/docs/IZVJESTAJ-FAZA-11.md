# Izvještaj — Faza 11

Faza 11 obuhvata dashboard po rolama, kvalitet podataka, globalnu pretragu, izvještaje i brze izvoze, te završni projektni scope zadataka i akcione filtere. Ovaj izvještaj opisuje završni sadržaj; rezultat CI-ja za završni commit treba provjeriti na GitHub Actions nakon pusha, ne nasljeđivati od starijeg commita.

## Baza i worker

- Migracije uvode trigram indekse za pretragu, projektne rollup ključeve i metapodatke poslova izvještaja. RLS ostaje uključen. Worker enumerira samo ID-jeve aktivnih firmi kroz usku `SECURITY DEFINER` funkciju, a poslovne podatke obrađuje u tenant transakcijama. Pošto web i worker dijele aplikacijsku rolu, i web može pozvati funkciju i vidjeti aktivne ID-jeve firmi.
- Noćni rollup je idempotentan. Mjesečni izvještaj i dashboard koriste zajedničku definiciju knjiženog troška i potvrđenih sati. `reports.scheduled` je zakazan; SMTP nije atomski s bazom, nepoznat/neuspješan ishod traži ručnu provjeru, a propušteni mjeseci se ne nadoknađuju automatski. Stvarni SMTP provider nije provjeren.
- Asinhroni report job koristi trajni outbox i pg-boss, ponovo provjerava prava i opseg, generiše fajl kroz attachment lifecycle i obavještava korisnika. Preuzimanje ponovo provjerava prava; već potpisani URL vrijedi do 60 sekundi. Isporuka je at-least-once, ne exactly-once; odvojena boss baza ne učestvuje u istoj transakciji, a operativni oporavak i race kod greške ostaju rizik.
- Sedam izvora (`PROJECT_COSTS`, `WORK_HOURS`, `HSE`, `DEADLINES`, `FUEL`, `TENDERS`, `MACHINE_UTILIZATION`) provjereno je u PDF i XLSX. Limiti su do 1000 entiteta za neke složene izvore, 10000 redova/segmenata i 100 MB, uz odbijanje prevelikog izvoza. Nepodržani timski filteri se odbijaju; mašinski trošak označava zbir svih timova.

## API i web

- Dashboard po rolama, data-health, globalna pretraga, ekran izvještaja i brzi izvoz sati su dostupni. Pretraga je konzervativna za ograničene opsege i neki rezultati vode na opću listu. Obavještenje o report jobu vodi na `/pregled`, ne direktno na posao.
- Pet health lista ima paginiranje, iste SQL predikate kao brojači te OWNER/ADMIN kontrolu. Akcione kartice za zadatke, kvarove, servisne naloge, tenderske rokove i nepotvrđene dane vode na server-side filtrirane postojeće liste. Za ostale akcije postoji paginirana akciona lista koja dijeli SQL predikat, rolu i opseg s brojačem; preventivni planovi dijele funkciju obračuna i opsega. Dio redova vodi direktno na detalj, a dio na odgovarajući modul gdje korisnik traži zapis po prikazanom ID-u. Filteri se primjenjuju prije limita; zadaci, kvarovi i tenderi prikazuju najviše 500 redova, nepotvrđeni dani 200, a akcione liste 100 po stranici.
- Task servis zahtijeva scope iz autentikovane sesije za listu, brojače, kreiranje, izmjenu i komentare. `PROJECTS` dozvoljava samo projekte iz sesije, uključujući i cilj pri premještanju; `SELF` vidi dodijeljene zadatke i ne može kreirati niti prebacivati u proizvoljan projekat. Faza mora pripadati projektu. Test prolazi kroz stvarnu JWT sesiju, assignment lookup, API rute, PostgreSQL/RLS, drugu firmu i zabranjene ID-jeve; dodatno se čuvaju postojeća RBAC pravila.
- Brzi CSV izvozi šest lista prenose aktivne filtere, pišu audit i štite od spreadsheet formula. Projekti koriste projektni opseg sesije; gorivo, tenderi, HSE, mašine i rokovi zahtijevaju COMPANY. UI skriva link kad nema potrebnog prava ili scopea. Gorivo i tenderi izvoze snapshot do 500 redova, HSE do 200; to nije komplet iza granice. Projekti, mašine i rokovi odbijaju više od 1000 filtriranih redova. Zasebni asinhroni CSV izvoz velikih lista nije isporučen: po odluci korisnika ostaje za Fazu 12/kasnije.
- Stari `/api/obligations/export` za CSV/PDF sačuvan je odvojeno od `/api/obligations/list-export`; na starom su dodane provjere prava i zaštita formula. OpenAPI ima 286 putanja. PDF renderer koristi ASCII/Helvetica i ne čuva dijakritiku: poznata stavka za Fazu 12/kasnije.

## Provjere

| Provjera | Nalaz |
|---|---|
| Ciljani web F11, dashboard, UI/axe, NUL, href, izvozi, PostgreSQL i report flow | 211/211 PASS u 38 fajlova; nakon dodatne provjere vezane faze task integration 6/6 PASS |
| Worker dispatcher i zakazani izvještaji | 4/4 PASS |
| DB tenant transakcija | 2/2 PASS |
| Contracts i OpenAPI | 22/22 PASS; OpenAPI check PASS |
| typecheck serijski, lint, check-cycles, db:types:check, check-tenant-sql | PASS; tenant katalog 132/132. Nakon zadnje SQL izmjene ponovo PASS ciljani web typecheck, lint, task testovi i tenant SQL |
| check-matrix-parity | PASS uz jedno postojeće NOT_IMPLEMENTED upozorenje |
| `git diff --check` | PASS u trenutku provjere |
| Shell DB preflight | Lokalno nije izvršen: nedostaje `psql`; SQL provjere su ranije pojedinačno izvođene Node PG klijentom. CI na `abc4b11` uključio je runtime preflight. |
| Puni lokalni `pnpm test` | Nije ponavljan prema korisnikovoj uputi |
| Playwright CI `fa74ccf` | [45875281079](https://github.com/mudzy992/gradix/actions/runs/45875281079) FAILED zbog dvosmislenog naslova. Locator je ispravljen u `abc4b11`. |
| Prvi završni CI `1065f91` | [45884101906](https://github.com/mudzy992/gradix/actions/runs/45884101906) FAILED jer nova akciona stranica nije bila evidentirana u testu dosegljivosti navigacije; izuzetak je dodan i test ciljano ponovljen. |
| CI checkpointa `abc4b11` | [45878624687](https://github.com/mudzy992/gradix/actions/runs/45878624687) SUCCESS, uključujući Playwright i Docker image; `e2e-stabilnost` preskočen. |
| Stvarni MinIO CI checkpointa `abc4b11` | [45878624630](https://github.com/mudzy992/gradix/actions/runs/45878624630) SUCCESS. |

Jsdom je pri axe testovima emitovao neblokirajuća canvas upozorenja. MinIO CI koristi sintetičku bazu/bucket i mockiran auth guard, uz stvarni RLS, pg-boss i worker; lokalni potpuni report flow koristi simulirani S3 server. Produkcijski deploy/migracija, fizički mobilni uređaj i stvarni SMTP provider nisu potvrđeni.

## Otvoreni rizici i spremnost za nastavak

- Pregled koda izvan task servisa pokazuje da postojeći `GET /api/service-orders` i `GET /api/machine-faults` prosljeđuju samo firmu, korisnika i uloge, bez session project scopea; `listServiceOrders` i opća lista kvarova zato nisu općenito ograničeni na PROJECTS. `listDiaries` također filtrira firmu i eventualni projektni parametar, ali ne primjenjuje session project scope. Ovdje su filtrirani dashboard prikazi uski, ali to **nije popravka tih općih API-ja i detalja**. Ovo je sigurnosni rizik za korisnike s ograničenim opsegom, koji zahtijeva zaseban pregled i integracijske testove prije pilota; nije dokazano da su ovo jedina pogođena mjesta.
- Passkeys implementacija može se planirati na ovoj osnovi, uz potvrdu CI-ja završnog commita. Pilot reset nije isto što i sigurnosna ili deploy verifikacija: prije stvarnog pilota provjeriti i popraviti scope nalaze, migraciju, pristup, backup/reset plan, pohranu i SMTP. Ne tvrditi produkcijsku/pilot spremnost samo na osnovu ovog taga.
