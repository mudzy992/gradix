# Izvještaj — Faza 9: Dnevnik građenja i zaštita na radu (Modul 10)

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Tag:** `phase-9` (`b144273`) ·
**CI:** `45694333436`, `verify` uspješan · **Spec:** `10-dnevnik-hse.md`

F9 isporučuje bazu, domenska pravila, API i web za dnevnik i HSE, te infrastrukturu za offline
red i sinkronizaciju. Poslije taga dodati su početni mobilni ekrani `/hse/prijava` i `/hse/toolbox`;
mobilni dnevnik i fotografije još nisu isporučeni. Red i server nisu isto što i mogućnost da
korisnik na telefonu unese podatke, pa se potpuna isporuka F9 prema planu ne može smatrati završenom.

## 1. Isporučeno

- **Baza:** migracija `20261126100000_f9_1_dnevnik_hse`; dnevnici, stavke, zastoji, revizije i
  šabloni; incidenti, dopune, istrage, mjere, inspekcije, obuke, prisustvo i prilozi. Jedinstven
  dnevnik po firmi, projektu i danu; trigeri štite potpisan sadržaj, činjenice incidenta i
  nepromjenjive zapise. Svježa baza ima 50 migracija, 119 tabela i 110 tenant tabela.
- **Domena i ugovor:** prelazi dnevnika, potpisi, zastoji, uslovi zatvaranja incidenta, LTIFR,
  `NEAR_MISS`, mjere i obuke; 30 ugovorenih ruta, OpenAPI 241 putanja, `SafeText` za ulaze.
- **Servisi i web:** `/ured/dnevnik` i detalj, `/ured/hse`, detalj incidenta, inspekcije i obuke;
  PDF dnevnika i HSE izvještaj; HSE kartica na Pregledu. PDF dnevnika označen je `DRAFT_FORMAT`
  dok obrazac nije potvrđen.
- **Offline infrastruktura:** SQLite verzija 3 prenosi postojeće redove i podržava pet tipova
  (`site_diary`, `site_diary_item`, `hse_incident`, `hse_action`, `hse_training`). Server
  obrađuje push i pull, provjerava verzije dnevnika i idempotenciju prijave incidenta.

## 2. Provjere

| Provjera | Rezultat |
|---|---|
| `REQUIRE_DB_TESTS=1 pnpm test` | 1 265 prošlo: web 712, domain 316, mobile 111 + 10, db 70, contracts 21, worker 25 |
| F9 integracija | `f9-diary-hse` 13/13 i `f9-sync` 8/8 protiv baze |
| Offline red | `r4-outbox` 7/7; mobilna migracija 6/6 |
| Statičke provjere | typecheck 6/6, lint čist, bez ciklusa; OpenAPI ažuran; tenant SQL 110/110; preflight 2/2 |
| CI za F9 | `45694333436`: `verify` success; `e2e-stabilnost` skipped |
| CI za Korak 0 | `45681549112`: success |

Lokalno nisu pokrenuti Playwright ni mobilni E2E; zeleni testovi offline reda ne dokazuju rad
nepostojećih mobilnih ekrana.

## 3. Važne odluke i ispravke

- Potpis i zaključavanje štite sadržaj; izmjena ide kroz reviziju sa razlogom i prethodnim
  sadržajem. Jedan projekt i dan imaju jedan dnevnik.
- Činjenice incidenta se ne prepisuju; dopuna je zaseban zapis. Prijava koja traži zakonsku
  obavezu i sama obaveza nastaju u istoj transakciji.
- Mjera mora imati odgovornu osobu i rok; `NEAR_MISS` se broji odvojeno; LTIFR bez radnih sati
  je `null`. Zabrana rada se podiže uz razlog; prisustvo na obuci ima ime i vrijeme potpisa.
- Telefon šalje namjeru; BOQ količina se knjiži na serveru. Starija verzija dnevnika je konflikt,
  a ponovljeni klijentski ID incidenta ne pravi drugi zapis.
- Integracioni testovi otkrili su nepostojeći `machine_work_logs.meter_start`, pogrešku 500 za
  zastoj duži od 24 sata i izmjenu potpisanog dnevnika; ispravljeni su upit, servisna validacija
  i zaštita potpisa. `SafeText` test otkrio je ulaze koji nisu odbijali NUL.

## 4. Preostalo prema planu F9

- Mobilni `/dnevnik`, njegova navigacija i povezivanje na offline red, uključujući automatske
  sekcije, zastoj, količine i siguran potpis vezan za snapshot koji je korisnik vidio. Trenutni
  sync odbija `signedName`, jer ga je ranije tiho ignorisao i nije provjeravao vidljivi snapshot.
  Sync količina sada nosi projekat i datum dnevnika, obrađuje ručne i BOQ stavke i odbija stare
  redove bez poslovnog ključa umjesto pogrešnog knjiženja na dan slanja.
- Početni ekran `/hse/prijava` čuva i šalje lokalni zapis, bira projekat iz lokalnog spiska i
  povrijeđenog iz keširanog šefovog rostera (ili ID-em kada roster nije dostupan). Status
  odbijenog zapisa je vidljiv. Fotografije i izbor ostalih uključenih radnika još nisu dovršeni.
- `/hse/toolbox` koristi lokalni roster sa pojedinačnim potpisima; treba dokazati puni tok na
  uređaju, kao i stanje korisnika koji nije prethodno preuzeo projekat i ekipu.
- Odgovarajući offline/E2E testovi na uređaju koji dokazuju unos, ponovno slanje i obradu.
  Ekranski test prijave koristi mockove; testovi reda i servera ga ne zamjenjuju.
- Poslije taga ispravljena je provjera dozvola za F9 sync i odbijanje izmjena potpisanog dnevnika;
  prošireni integracioni testovi pokrivaju obje granice.

Detaljni redovi isporuke i odluke su u `docs/STATUS.md`; puni zahtjevi su u zaključanoj
specifikaciji i `docs/IMPLEMENTATION_PLAN.md`.
