# Faza 11 — radni izvještaj (nije zaključena)

Ovo je radni presjek, ne potvrda da je Faza 11 završena. Završni commit, tag i CI za završni presjek još ne postoje.

## Baza i worker

- Migracije dodaju trigram indekse za pretragu, projektne rollup ključeve i metapodatke poslova izvještaja. RLS ostaje uključen. Worker enumerira samo ID-jeve aktivnih firmi kroz usku `SECURITY DEFINER` funkciju te poslovne podatke obrađuje u tenant transakcijama. Budući da web i worker dijele aplikacijsku rolu, i web može pozvati tu funkciju i vidjeti aktivne ID-jeve firmi.
- Noćni rollup je idempotentan. Mjesečni izvještaj i dashboard koriste zajedničku definiciju knjiženog troška i potvrđenih sati. `reports.scheduled` je zakazan; isporuka preko SMTP-a nije atomska s bazom, nepoznat/neuspješan ishod traži ručnu provjeru, a propušteni mjeseci se ne nadoknađuju automatski. Stvarni SMTP provider nije provjeren.
- Asinhroni report job čuva trajni outbox, šalje ID-jeve u pg-boss, ponovo provjerava prava i opseg, generiše fajl u attachment lifecycleu i obavještava korisnika. Preuzimanje opet provjerava prava; potpisani URL vrijedi do 60 sekundi. Isporuka je at-least-once, ne exactly-once; odvojena boss baza ne učestvuje u istoj transakciji, a operativni oporavak i race kod greške ostaju rizik.
- Sedam izvora (`PROJECT_COSTS`, `WORK_HOURS`, `HSE`, `DEADLINES`, `FUEL`, `TENDERS`, `MACHINE_UTILIZATION`) provjereno je u PDF i XLSX. Limiti su do 1000 entiteta za neke složene izvore, 10000 redova/segmenata i 100 MB, uz odbijanje prevelikog izvoza. Nepodržani timski filteri se odbijaju; mašinski trošak označava zbir svih timova. PDF koristi ASCII/Helvetica i ne čuva dijakritiku.

## API i web

- Dashboard po rolama, data-health, globalna pretraga, ekran izvještaja i brzi izvoz sati su dostupni. Pretraga je konzervativna za ograničene opsege i neki rezultati vode na opću listu. Obavještenje o report jobu vodi na `/pregled`, ne direktno na posao.
- Pet health lista ima paginiranje, iste SQL predikate kao brojači te OWNER/ADMIN kontrolu. Nepotvrđeni dani filtriraju se na serveru i prema projektnom opsegu prije limita. **Ostale akcione kartice većinom još vode na nefiltrirane liste**, a neke zahtijevaju specifičan ekran i usklađenje s predikatom brojača. To je otvoreni kriterij korisnika, ne završeno ponašanje.
- Pripremljeni su CSV izvozi šest glavnih lista s aktivnim filterima, auditom i zaštitom spreadsheet formula. Projekti koriste projektni opseg sesije; gorivo, tenderi, HSE, mašine i rokovi zahtijevaju COMPANY. UI skriva link kad nema potrebnog izvoznog prava ili scopea. Granice postojećih prikaza goriva i tendera su 500, HSE 200; snapshot zato ne predstavlja sve podatke iza granice. Projekti, mašine i rokovi se odbijaju iznad 1000 filtriranih redova. Ovi CSV-ovi nemaju asinhroni tok za velike skupove i još nisu commitovani.
- Postojeći `/api/obligations/export` za CSV/PDF sačuvan je odvojeno od novog `/api/obligations/list-export`; na starom su dodate provjere prava i zaštita formula. OpenAPI ima 286 putanja.
- Važan nalaz za nastavak: postojeći `listTasks`/`GET /api/tasks` prima uloge i company, ali ne primjenjuje session project scope, a brojači dashboarda za PM/šefa gradilišta koriste dodijeljene projekte. Prije filtriranog linka za zadatke treba osigurati opseg na serveru i testirati COMPANY/PROJECTS/SELF i tenant izolaciju; sam query parametar ne smije glumiti zaštitu. Nije potvrđeno da se sve ostale akcione liste podudaraju sa scopeom i SQL predikatima brojača.

## Provjere ovog presjeka

| Provjera | Nalaz |
|---|---|
| Web ciljani F11, UI/axe, NUL, href, izvozi, PostgreSQL i report flow | 208/208 PASS u 33 fajla; jsdom emituje neblokirajuća canvas upozorenja |
| Worker ciljani dispatcher i zakazani izvještaji | 4/4 PASS |
| DB tenant transakcija | 2/2 PASS |
| Contracts i OpenAPI | 22/22 PASS; OpenAPI check PASS |
| typecheck serijski, lint, check-cycles, db:types:check, check-tenant-sql | PASS; tenant katalog 132/132 |
| check-matrix-parity | PASS uz jedno postojeće NOT_IMPLEMENTED upozorenje |
| `git diff --check` | PASS u trenutku provjere |
| Shell DB preflight | Nije izvršen: nedostaje `psql`; SQL provjere su ranije pojedinačno izvođene Node PG klijentom |
| Puni `pnpm test` | Nije ponavljan prema korisnikovoj uputi |
| Playwright CI na `fa74ccf` | [45875281079](https://github.com/mudzy992/gradix/actions/runs/45875281079) FAILED: dvosmislen naslov izvještaja. Locator je lokalno preciziran, ali ispravka još nema CI dokaz. |
| Stvarni MinIO CI | [45875281377](https://github.com/mudzy992/gradix/actions/runs/45875281377) SUCCESS na `fa74ccf`; nije dokaz za kasnije necommitovane izmjene. |

MinIO CI koristi sintetičku bazu/bucket i mockiran auth guard, uz stvarni RLS, pg-boss i worker. Lokalni potpuni report flow koristi simulirani S3 server. Produkcijski deploy/migracija, lokalni Docker build, fizički mobilni uređaj i stvarni SMTP provider nisu potvrđeni.

## Preostalo prije zatvaranja

Dovršiti i testirati sve akcione linkove i njihove server-side scope/filtre; ocijeniti ograničenja CSV snapshotova i po potrebi riješiti velike izvoze; ponoviti ciljane testove i statičke provjere nakon izmjena. Tek tada ažurirati ovaj izvještaj i status, napraviti korisnikov završni commit i tag, pushati ih i potvrditi oba GitHub CI runa. Dok to nije urađeno, spremnost za Passkeys + Pilot reset nije potvrđena.
