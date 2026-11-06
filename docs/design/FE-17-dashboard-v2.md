# FE-17 — Dashboard v2, radni dizajn

**Status:** admin v2, paleta i K2 snimci su isporučeni; BE-19 i FE-17 ostaju u toku do pregleda vlasnika. Nadograđuje D-043 prema D-057; ostale role nisu odobrene tom kontrolnom tačkom. Paleta D-040,
postojeći tokeni i WCAG 2.2 AA, bez promjene drugih ekrana osim zajedničkih primitiva.

## Svrha i redoslijed

Korisnik prvo vidi **hitno**, zatim **danas**, zatim **stanje**. Na admin ekranu:

1. Zaglavlje: lokalizovan datum, ime, izbor konteksta; tenant mora biti spreman.
2. KPI kartice sa vrijednošću, statusom, trendom i promjenom samo ako postoje pouzdani
   podaci za uporediv prethodni period. SVG iskra ima tekstualni ekvivalent; nula,
   nedostupno i nedovoljan uzorak su različiti. Bez izmišljenih brojki i procenta iz nule.
3. Centar hitnosti: preostali rokovi, zadaci i događaji sortirani po stepenu/roku, sa
   jasnim nazivom, datumom i akcijom samo kada korisnik ima pravo na cilj. Nema same boje
   kao signala. Izvori, period i maksimalan broj su vidljivi/dokumentovani.
4. Projekti: budžet i stvarna potrošnja uz eksplicitan `nema budžeta` i bez procenta kada
   je budžet nula. Računati novac decimalno, bez privremenog binary-float za novčane zbirove.
5. Prisustvo i mala Leaflet mapa projekata: lijeno učitavanje, visina rezervisana unaprijed;
   tekstualna lista radi bez mape. Prikaz koordinata samo uz dopušteni scope; ne prikazivati
   sirove lokacije ljudi ako postojeći ugovor ne dopušta. Prazan geopodatak nije greška.
6. Aktivnost iz audita, najmanji potrebni podaci bez tajni, s ograničenjem i kontrolom prava.
7. Brze akcije i Ctrl/Cmd+K koriste istu provjeru dostupnosti kao navigacija; tastatura,
   fokus, zatvaranje i prazna pretraga su pristupačni. Prazna firma ima korake za početak
   samo za radnje koje korisnik smije izvršiti.

## Arhitektura i ugovor

- Postojeći `GET /api/dashboard` i postojeći korisnici zadržavaju ugovor. BE-19 dodaje
  čitljive sekcije bez bočnih efekata, sa zasebnim bounded upitima, stabilnim redoslijedom,
  Swagger dokumentacijom, tenant uslovom **u svakom upitu** i najmanjim pravima.
- Podaci se ne smiju širiti zbog prisutnosti više rola; za projektne role se ponovo koristi
  projektni scope. Prazni/tuđi tenant, uskraćena prava i ograničenje rezultata imaju DB test.
- Svaka sekcija ima nezavisan query/cache ključ koji sadrži sigurni kontekst, stalni prostor
  za sadržaj, loading/empty/error/retry, bez lažnog praznog stanja tokom greške ili zamjene
  firme. Prekid jedne ne skriva ostale.
- Vremenski raspon i zone se definiraju prema firmi, ne implicitno browser UTC; izvori
  istorijskih podataka moraju postojati prije obećanja trendova. Bez podataka: „nema trenda“.
- Budžet ≤ približno 30 KB gzip dodatnog početnog JS-a mjeri se prije/poslije; mapa je
  zaseban lazy chunk. Nema novih biblioteka bez K3; SVG i postojeći Leaflet se ponovo koriste.
- Nema migracije osim aditivnog indeksa sa stvarnim `EXPLAIN` dokazom potrebe; nema
  destruktivne migracije ni izmjene API ugovora. Dopunjavati isključivo demo seed.

## Pristupačnost i stanja

BS/EN parity, semantičke sekcije, imenovane kontrole i stanja (`aria-busy`, alert i retry),
vidljiv fokus, reflow 320 px, `prefers-reduced-motion`, kontrast i tekst uz boju. Prije K2:
unit formule i grafova, komponente sa loading/error/empty, Playwright navigacija i tastatura,
axe bez critical/serious, vizuelni light/dark desktop/tablet/mobile admin. Pravi dark režim
provjeriti u postojećem sistemu prije tvrdnje da je pokriven; snimci su dokaz, ne mock.

## Redoslijed i checkpoint

B0 dokument i registracija → B1 ograničena API analitika + testovi → B2 admin prikaz i demo
→ B3/B4 testovi i screenshotovi light/dark × desktop/mobile, uporediti prije/poslije →
**stati za K2**. Tek nakon vlasnikove potvrde ostale role i finalno zatvaranje BE-19/FE-17.
S-01/S-02/S-03 provjeriti za korištene auth, tenant i novčane putanje, a nepovezane stavke
S-reda ne zaustavljaju B0. Nijedna uloga ni screenshot nisu sada prikazani kao implementirani.

BE-19 dodatni izvor: `GET /api/analytics/tasks/created` daje dva jednaka perioda kreiranja zadataka i dnevne UTC granice, sa cursor/limit i rolom/tenant scopeom; to nije trend radnih sati ni završavanja zadataka. Usporedba koristi završene lokalne dane i ne izračunava procenat iz nule.

Projects API je proširen opcionalnim `cursor`/`limit` (1–10): originalni `data` niz ostaje, `meta.nextCursor` omogućava nastavak. Scope cursor-a provjerava se prije čitanja stranice.

Klijentski neutralan `/activity/events` donosi do 20 audit događaja po stranici za tenant administratore, s UTC vremenom i bez payloada; best-effort audit nije potpuna historija.

`/analytics/timers/closed` daje dnevne odobrene minute po danu zatvaranja i broj različitih radnika sa zatvorenom sesijom; to nije lokacijski potvrđeno prisustvo.

`/alerts/documents` nudi ograničen severity/keyset pregled isteka dokumenata za tenant admina, bez putanja i bilješki. Nisu obuhvaćene druge vrste upozorenja;

Demo seed daje sintetički promjenjiv 30-dnevni niz zadataka i odobrenih timera samo uz `SEED_DEMO=true`; produkcija bez te zastavice nema demo podatke.

`/presence/people` je zasebna tenant-admin cursor/limit lista korisnika na aktivnim geofencima na osnovu posljednjeg svježeg GPS pinga, bez sirovih koordinata; ne predstavlja historiju ni potvrđenu evidenciju prisustva.

`/analytics/summary` je zaseban tenant-admin scalarni izvor aktuelnih agregata, uključujući broj projekata s budžetom i tačan zbir poznatih budžeta. To nije transakcijski snapshot ni paginirana lista.

`/alerts/tasks` daje severity i paginaciju za nezavršene zadatke u aktivnim projektima s prošlim ili bliskim UTC rokom.

Projects API vraća projektne `lat`/`lng` kao decimalne stringove ili null i radijus u metrima za lazy mapu; ne izlaže lokacije ljudi.

Primitivi `chart-primitives.tsx`: prazna/nedostajuća mjerenja se ne pretvaraju u nulu; sparkline ne spaja praznine; grafici imaju otkrivenu tabelu podataka, donut vidljivu legendu i najviše četiri segmenta. Neispravan/nepotpun ili nulti zbir donuta nema proporcionalni crtež; oznaku praznog stanja daje pozivalac. Progress prikazuje tekst i pragove 80/100% bez zaokruživanja ispod praga na viši status, bez dijeljenja nulom, a animirani brojač i shimmer poštuju smanjeno kretanje. Primitivi nisu decimalna biblioteka: za novac pozivalac mora prvo tačno izračunati omjer.

Mjerenje prije povezivanja admin v2 (lokalni `vite build`, Node 22): glavni `index-DX_kZ0LL.js` 734.28 kB minificiran / 210.19 kB gzip. Primitivi tada nisu bili uvezeni u dashboard; uporediti isti build nakon integracije, uz izdvojeni lazy map chunk.

Web klijent ima tipizirane odvojene pozive (`api-dashboard.ts`); generički envelope može nositi cursor meta bez promjene postojećeg page meta tipa. Svi pozivi koriste postojeći session/tenant context guard. Admin


Admin v2 koristi odvojene upite s ključem korisnik/firma/platform revision i vlastita stanja; bez platform firme nema zahtjeva. Dozvole određuju upite i prečice, a ostale role zadržavaju stari dashboard. Prikaz novca i budžetskog omjera koristi decimalne stringove/BigInt i omjer se prikazuje skraćen na dvije decimale kako ne bi prešao prag zbog zaokruživanja; nepostojeći budžet, nulti nazivnik i nesiguran graf nisu nula. Upiti prikazuju prvih 10 aktivnih projekata te do 20 prisutnih i audit događaja; datum isteka dokumenta je UTC datum, a rok zadatka instant u zoni firme. Lista je tekstualna alternativa projektnoj mapi; Leaflet se učitava samo kad ima koordinata, a greška pločica se jasno prikazuje. Prisustvo je GPS procjena, ne evidencija radnog vremena. Dark klasa se primjenjuje na shell samo dok je admin dashboard montiran, preferencija ostaje lokalna.

Lokalna provjera stvarnog demo backenda: Playwright dashboard/prečica/reflow 3/3, kompletni admin tok 16/16; axe-core 4.11.1, WCAG 2/2.1 A/AA light i dark, bez serious/critical nalaza; na 320 px nema horizontalnog prelijevanja. Lokalni preview fixture ima koordinate i budžet dodane u privremenu bazu, ne u seed; mreža ovdje blokira OSM pločice i prikazuje se fallback. Pri prvom punom pokretanju korišteni su preniski lokalni auth limiti (429), zatim je uz CI vrijednosti otkriven i ispravljen reflow test koji nije vraćao širinu prozora. To nije potpuna WCAG provjera; završni screenshotovi i metrika su ispod; K2 slijedi.

Nakon integracije (isti lokalni Vite build): glavni JS 756.68 kB / 216.07 kB gzip, +22.40 kB / +5.88 kB gzip u odnosu na zabilježenu osnovu. `project-map` je odvojen 1.25 kB / 0.71 kB gzip, zajednički Leaflet 152.73 kB / 44.77 kB gzip; učitava se tek za kartu s koordinatama. Brojke su build veličine, ne stvarni prijenos ili LCP/CLS.

Ctrl/Cmd+K paleta koristi iste navigacijske definicije, prava i tenant spremnost kao sidebar: bez izabrane platform firme ne nudi tenant stranice. Pretraga ignoriše dijakritike; strelice/Enter biraju, Escape zatvara i vraća fokus, ne otvara se preko drugog dijaloga. Nema dodatnih zavisnosti. Lokalni axe WCAG A/AA provjerio je otvorenu paletu, uključujući praznu pretragu u light/dark modu, bez serious/critical nalaza.

Poslije palete: glavni JS 762.28 kB / 217.35 kB gzip (u odnosu na početno +28.00 kB / +7.16 kB gzip); puni admin Playwright tok 17/17.


### K2 — snimci i ponavljanje

- [Prije (desktop)](FE-17-screenshots/before-admin-desktop.png) koristi frontend iz `0d3980a` protiv istog aktuelnog test backenda; nije historijski snimak produkcije.
- [Light desktop](FE-17-screenshots/admin-light-desktop.png), [dark desktop](FE-17-screenshots/admin-dark-desktop.png), [light mobile](FE-17-screenshots/admin-light-mobile.png), [dark mobile](FE-17-screenshots/admin-dark-mobile.png), [paleta](FE-17-screenshots/admin-command-desktop.png).
- [Prazna firma desktop](FE-17-screenshots/admin-empty-desktop.png) i [mobile](FE-17-screenshots/admin-empty-mobile.png): **browser-only simulirani odgovori** osam dashboard ruta, ne nova firma u bazi; sedam završenih dana su stvarne nule, poređenja iz nule su null.
- Popunjeni snimci koriste odvojenu privremenu demo bazu sa sintetičkim koordinatama, iznosima, prisustvom, rokom, dokumentom i audit događajem; to nisu produkcijski podaci niti dodatak demo seedu. OSM pločice su blokirane u sandboxu pa je prikazan eksplicitni fallback i lista.
- [Mjerenja](FE-17-screenshots/measurements.json) su po jedan lokalni, razvojni Chromium prolaz bez mrežnog throttlinga: prije desktop LCP 528 ms/CLS 0.0075; poslije light desktop 552 ms/0.0217, light mobile 480 ms/0.0095. To nisu reprezentativni field podaci niti stroga usporedba performansi. Skeleton kartice sada rezervišu visinu umjesto ranije zabilježenog mobilnog CLS oko 0.29–0.41.
- Axe-core 4.11.1 uz WCAG 2/2.1 A/AA tagove: 0 serious/critical za sedam provjerenih prikaza; 0 px horizontalnog prelijevanja u mjerenim viewportima. Ovo nije potpuni WCAG audit.

Za ponavljanje koristiti **isključivo izolovanu, sintetičku demo bazu**, lokalno pokrenut backend i frontend te instaliran postojeći Playwright Chromium. Postaviti `E2E_LOGIN_EMAIL` i `E2E_LOGIN_PASSWORD` u okruženju, pa pokrenuti `npm run dashboard:shots`; ne upisivati kredencijale u repo. `DASHBOARD_SHOTS_URL` po potrebi mijenja frontend origin, a `DASHBOARD_BASELINE_API_TARGET` backend target privremenog starog frontenda. Skripta nikad ne mijenja podatke firme; koristi sintetičke browser odgovore samo za praznu firmu. `AXE_CORE_PATH` pokazuje na lokalno dostupan `axe.min.js`; bez njega se axe izričito preskače. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` je opcionalan put do postojećeg browsera. Skripta zahtijeva dostupnu git reviziju `0d3980a`, git/tar i frontend zavisnosti; snimci zavise od demo podataka i vremena.

- Posljednji lokalni production build: glavni JS 762,87 kB (217,50 kB gzip); baseline `0d3980a` 734,28 kB (210,19 kB gzip), zasebni lazy Leaflet 152,73 kB (44,77 kB gzip). Vite upozorava na chunk >500 kB; bez novih zavisnosti.

### v2.1 — u toku

Demo seed je proširen isključivo iza `SEED_DEMO=true`, bez promjene ostalih rola. Vrijednosti i GPS su sintetički (dokumenti nemaju fajlove); stariji demo zapisi ne brišu se pri ponovnom seedu. Ovo nije v2.1 vizuelna implementacija niti dokaz spremnosti za K2. Gore navedeni snimci i mjerenja odnose se na prethodni v2 i ne dokazuju v2.1 kriterije. Hero/upozorenja, stvarni KPI trendovi, tipografija, fallback, checklist, pretraga entiteta i novi screenshotovi i mjerenja ostaju otvoreni.

Za korake v2.1 može se koristiti `DASHBOARD_SHOTS_MODE=viewport` i opcionalno `DASHBOARD_SHOTS_FILE=<ime.png>`: samo trenutni admin light viewport 1440×900, bez izmjene prethodnih snimaka i bez mjerenja. Puni režim ostaje podrazumijevan.

Korak 1: [v2 sa bogatim seedom](FE-17-screenshots/v2-with-rich-seed.png) je admin light viewport 1440×900 iz izolovane PostgreSQL demo baze. Vizuelno su popunjeni grafikoni novih zadataka i odobrenog vremena; dodatna izmjena seeda nije bila potrebna. Podaci su sintetički, a v2.1 UI i mjerenja tek slijede.

Korak 2: Danas (GPS procjena, otvoreni timeri, broj dostupnih upozorenja) i upozorenja su prvi red; najhitnija tri imaju oznaku težine i akcijske linkove, a veze vode do preostalih zadataka/dokumenata. Broj je ograničen na do 20 rezultata po izvoru i prikazuje + na limitu; nedostupni ili djelimični izvori nisu nula. Kartice u istom redu imaju jednaku visinu. [Desktop viewport](FE-17-screenshots/step-2-admin-light.png); ostali kriteriji v2.1 nisu još izmjereni.
