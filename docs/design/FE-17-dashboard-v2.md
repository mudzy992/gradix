# FE-17 — Dashboard v2, radni dizajn

**Status:** B0 + dio B1 (ograničeni projects API i klijentski neutralan izvor dnevnog broja kreiranih zadataka); nadograđuje D-043 prema D-057. K2 dolazi tek nakon admin
izvedbe i snimaka; ostale role nisu odobrene tom kontrolnom tačkom. Paleta D-040,
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

BE-19 dodatni izvor: `GET /api/analytics/tasks/created` daje dva jednaka perioda kreiranja zadataka i dnevne UTC granice, sa cursor/limit i rolom/tenant scopeom; to nije trend radnih sati ni završavanja zadataka. Usporedba koristi završene lokalne dane i ne izračunava procenat iz nule. UI još ne koristi taj izvor.

Projects API je proširen opcionalnim `cursor`/`limit` (1–10): originalni `data` niz ostaje, `meta.nextCursor` omogućava nastavak. Scope cursor-a provjerava se prije čitanja stranice.
