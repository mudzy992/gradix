# TEST-01 — Coverage infrastruktura + pragovi

| | |
|---|---|
| Sloj | `TEST` |
| Obim | `fajlovi` |
| Status | `in-progress` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=TEST-01`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

_Šta ovaj segment provjerava i šta izričito **ne** provjerava (granica prema susjednim segmentima)._

## 2. Ulaz

**Zavisnosti (moraju biti gotove prije):** _(popuniti iz plana §6)_

**Fajlovi:**

4 fajlova (vidi `AUDIT/COVERAGE_MATRIX.csv`, filter `segment=TEST-01`):

- `backend/test/helpers/auth.ts`
- `backend/test/helpers/create-app.ts`
- `backend/test/helpers/minio-memory.ts`
- `backend/test/jest-e2e.json`

**Pretpostavke:** _(šta se uzima zdravo za gotovo i šta ako ne važi)_

## 3. Kriteriji završetka (DoD)

- [ ] Svi fajlovi segmenta pregledani; status u matrici ≥ `pregledano`
- [ ] Svaki nalaz ima težinu, dokaz (`fajl:linija`) i odluku
- [ ] Popravke imaju regression test (ili zapisano zašto test nije moguć)
- [ ] `node scripts/audit/check-coverage.mjs` → PASS
- [ ] Relevantni lokalni testovi zeleni
- [ ] `docs/` ažuriran ako se ponašanje/konfiguracija mijenja (isti commit)
- [ ] `AUDIT/STATE.md` ažuriran; commit + push + **zelen CI** (run ID zapisan)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (`fajl:linija`) | Ocjena |
|---|---|---|---|
| 1 | _(popuniti)_ | `...:1` | ✅ / ⚠️ / ❌ / ❓ |

## 5. Nalazi

Format: `F-TEST-01-NN` — opis, težina (blokada / visoko / srednje / nisko), dokaz, odluka.

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-TEST-01-01 | _(popuniti)_ | | | |

## 6. Popravke

_Za svaku popravku: šta se mijenja, zašto tako, koje su alternative odbačene i zašto._
_Novi alati/zavisnosti: obrazloženje ide i u `docs/DECISIONS.md` (D-006)._

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| _(popuniti)_ | `...` | |

## 8. Rizici i rollback

- **Rizik:** _(popuniti)_ → **Rollback:** _(kako se vraća stanje)_

## 9. Dokumentacija

- [ ] `docs/` dokument(i): _(popuniti)_
- [ ] `docs/DECISIONS.md` ako je odluka arhitektonska

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | _(prazno dok se ne počne)_ |
| Commit(ovi) | |
| CI run | |
| Status | `in-progress` |

## Ulaz iz D-058

Nakon K2 provjeriti preostalu decimalnu HTTP/PG karakterizaciju svih polja i granica, direktne vanjske Prisma upise, postojeće podatke, numeričke opsege i izvedene obračune; D-058 zatvara samo skalu inventurisanih API inputa. Automatska matrica role × tenant × ROUTE_INVENTORY ostaje prvi korak TEST-01.


## 11. Prva faza — automatska ruta × uloga × tenant

`AUDIT/ROUTE_INVENTORY.csv` generiše 171 aktivnu Nest controller rutu iz runtime metapodataka; test poredi metode/putanje i sa registrovanim Express rutama (Swagger docs i websocket nisu controller API). `AUDIT/ROUTE_MATRIX.csv` sadrži 7.524 kombinacije tih ruta, 10 Prisma uloga + anonymous i četiri konteksta headera. Sve ćelije su **unassessed**: to nije tvrdnja da nikakvi raniji E2E testovi ne postoje, nego da pojedinačni dokaz još nije povezan i pregledan. Public/tenant/permissions su deklarativni metapodaci, ne konačna odluka: dodatni guardovi, role checkovi u servisima, projekti, tijelo i prava korisnika mogu promijeniti ishod. Kombinacije koje nisu smislene tek treba označiti kao N/A uz obrazloženje.

Test u izolovanoj testnoj bazi šalje zahtjev bez prijave i headera (bez tijela, s nepostojećim vrijednostima parametara) na 160 non-public obrazaca; svi vraćaju 401. To dokazuje samo anonimnu granicu za te primjere; ne dokazuje ispravnost dozvoljenih rola ni tenant izolaciju u čitanju/upisu. Naredno: dokazani dozvoljeni i odbijeni role/tenant slučajevi i cross-tenant resursi, pa S-red po prioritetu, decimalne granice i kriteriji plana.

Deterministična regeneracija i detalji u `docs/TESTING.md`; ne prepisivati matrice ručno niti označavati neprocijenjene ćelije kao pokrivene.

Lokalna provjera prve faze: fresh PostgreSQL 16, 12 ručno primijenjenih migracija i test-only readiness, route E2E 5/5; backend unit 54/439, frontend 66/645, `check:all` 0 grešaka/2 preskočeno, backend lint/build prošli. CI potvrda slijedi push.

Druga faza: svih 9 firmnih rola × 160 non-public obrazaca s tuđim `X-Company-Id` vraća 400 `TENANT_HEADER_FORBIDDEN` (1.440 uzoraka); platform admin × 151 tenant obrazac bez zaglavlja vraća 403 `TENANT_HEADER_REQUIRED`, s nepoznatom firmom 404 `NOT_FOUND` (302 uzorka). Test koristi izolovane fixture naloge i čisti ih; još ne dokazuje izolaciju resursa unutar dozvoljenog konteksta, validan odabir firme, permission check ili javne/IoT rute.

### Stvarni projektni resursi (2026-11-06)

`project-isolation.e2e-spec.ts` koristi dvije odvojene firme, stvarne projektne ID-eve i svih 10 rola. Svih devet firmnih naloga ima fixture assignment na vlastiti projekat: GET vlastitog vraća 200, tuđeg 404; PATCH vlastitog dozvoljen je za četiri write role (uključujući platform admin), ostali dobiju 403; PATCH tuđeg vraća 404 za write role, 403 ostalima i provjerava se da strani zapis nije promijenjen. Platform admin sa odabranom drugom firmom može pročitati njen projekt, ali ne projekt prve. Test čisti fixture i audit. Ovo nije dokaz neassigned korisnika, drugih resursa/metoda, konkurentnosti ili svih ruta; generisane ćelije ostaju `unassessed`.

Provjera: fresh PostgreSQL 16, 12 ručno primijenjenih SQL migracija + test-only readiness i seed; oba E2E fajla 8/8, izlaz 0; backend unit 54/439, lint/build, frontend 66/650 i `check:all` 0 grešaka/2 skip. Prvi fresh kombinovani pokret pod paralelnim opterećenjem ispisao je 8/8, ali je proces vratio 1 bez dodatnog razloga; zasebni i ponovljeni kombinovani pokret su vratili 0, kao i ponavljanje na drugoj svježoj bazi. Uzrok prvog izlaza ostaje nepoznat.

### E2E izlaz 1 — ograničena dijagnoza (2026-11-06)

20/20 serijskih ponavljanja istih 8 testova vratilo je 0, `--detectOpenHandles` 8/8 exit 0 bez prijavljenih handleova i 0 PG konekcija poslije zatvaranja. Izvorni uzrok nije reproduciran; paralelno opterećenje nije ponovljeno. Rezultati, vremena i stderr: `AUDIT/evidence/e2e-exit-2026-11-06.txt`; detalji i sljedeći korak `docs/TESTING.md`. CI postojeći `--forceExit` može prikriti otvorene handleove i nije izmijenjen. Fail-closed reporter sada eksplicitno ispisuje numerički procesni status i testiran je s uspješnim JSON-om i statusom 1, te nedostajućim JSON-om i statusom 137. To je dijagnostičko poboljšanje, ne dokaz popravke uzroka.

### Generički permission-negative prolaz (2026-11-06)

Generator iz runtime inventara i postojećeg `resolvePermissions` šalje 593 zahtjeva bez potrebnih deklarisanih permisija: 9 firmnih rola × sve primjenjive non-public rute. Na 103/171 rute ispituje se bar jedan permission-negative slučaj; svi vraćaju 403 `FORBIDDEN` bez `data`. Preostalih 68: 11 javnih eksplicitnih izuzetaka, 54 non-public bez deklarisanih permisija i tri sa permisijom koju svih 9 firmnih rola ima. Platform admin nema permission-negative slučaj jer ima sve dozvole. Očekivanje koristi istu role-permission mapu kao aplikacija: dokazuje primjenu deklarisane mape, **ne** ispravnost poslovne politike. Parametri su nepostojeći, a tijela nisu stvarni payloadi. Public lista mora tačno odgovarati runtime metapodacima uz neprazan razlog; inventar mora odgovarati i Nest i Express rutama pa nova ruta bez ažuriranog unosa pada E2E gate.

Ovo nije kompletna matrica po korisnikovom kriteriju: **0/171** ruta ima generički dokaz svih dopuštenih, odbijenih i stvarnih cross-tenant scenarija sa necurenjem; **171/171** ostaje nedokazano u tom smislu. Samo 2/171 (GET/PATCH projekt) imaju zaseban test stvarnih ID-eva i svih 10 rola; svi redovi generičke matrice su i dalje `unassessed`. Potrebni su eksplicitni fixturei, validni payloadi, service-level pravila, sigurnost side-effecta, pripadnost projekta i asercije tajnih kanarinaca za svaku rutu. Status 400 za zabranjeni X-Company-Id kod firmnog korisnika je postojeće ponašanje header guarda, a ne dokaz 403/404 na stvarnom tuđem resursu. Novi nalazi po težini iz ovog ograničenog prolaza: nijedan; odsustvo nalaza nije dokaz da ranjivosti ne postoje.

Verifikacija generičkog prolaza: public-exception gate prvo crven (11 nedostajućih unosa), zatim zelen; fresh PostgreSQL (12 ručnih SQL migracija + test-only readiness i seed) 10/10, backend 54/439, frontend 66/650, backend lint/build, `check:all` 0 grešaka/2 skip.

### Stvarni registry resursa i kontrolisani HTTP slučajevi

`backend/test/helpers/tenant-fixtures.ts` u svakoj od dvije privremene firme kreira devet firmnih rola i zasebnog platform admina, assignment svih firmnih rola, te po jedan stvarni project, task, machine, material, depot, timer, trip, diary, incident, company document, service record, tender, partner, warehouse i cost entry. A/B imaju različite markere; platform admin bira firmu headerom. Fixture čisti kreirane redove; testovi koriste isključivo izolovanu testnu bazu. Ostale vrste i podresursi još nemaju factory.

`backend/test/tenant-resource-isolation.e2e-spec.ts` veže eksplicitne slučajeve na runtime inventar: **12/171** pokrivenih ruta u ovom ograničenom kriteriju (9 GET po ID-u + 3 DELETE), 2 djelimične liste, 146 pending i 11 javnih izuzetaka. Za svaku eksplicitno dozvoljenu rolu, u oba smjera, GET prvo dokazuje 200 i vlastiti ID a strani ID mora vratiti 403/404 bez stranog markera/ID-a i `data`. DELETE provjerava nepromijenjen strani red, zatim poseban vlastiti pozitivni kontrolni resurs i DB učinak; nema validacije tijela jer DELETE nema DTO. Role s deklarisanim permissionima testiraju se i protiv permission mape; kod servisnih guardova role su eksplicitne i moraju se ručno održavati. Ovo ne dokazuje neassigned scope, višestruke role, konkurentnost, sve moguće filtrirane liste ili ostale kombinacije. Listovi projects/tasks su **partial**: oba smjera, prva/druga stranica, asc/desc i odabrani filteri s pozitivnom kontrolom; ne tvrdi se potpunost svih filtera/search/sort varijanti. Nijedan novi Critical/High nalaz nije pronađen u ovom ograničenom skupu; nepokriveno nije dokaz sigurnosti.

`AUDIT/TEST-01-ROUTE-COVERAGE.csv` je eksplicitni ledger: pending ne znači izuzetak, niti je pokrivenost; public izuzeci imaju razloge. E2E gate upoređuje sve runtime rute s ledgerom i javne izuzetke s public metapodacima te veže `covered` i `partial` za implementirane testne slučajeve. Nova ruta bez ledger unosa pada; unos `pending` ne stvara lažni dokaz. Postojeća deterministička `ROUTE_MATRIX.csv` ostaje nepromijenjena i njene ćelije `unassessed`; ne poistovjećivati dvije metrike. Sljedeće: realni podresursi i DELETE, PATCH/POST s validnim DTO pozitivnim kontrolama, preostali list filteri/paginacija i kanarinci, te neassigned slučajevi. Cilj ≥95% nije ispunjen.

Lokalno prije pusha: fresh PG16 sa 12 ručno primijenjenih migracija, test-only readiness metapodacima i demo seedom; kombinovani inventory/project/new resource E2E 13/13 exit 0 (bez `--forceExit`); backend 55/446, lint i build 0; frontend Vitest 66/650 exit 0 (`--maxWorkers=2`); `check:all` 0 grešaka/3 skip (coverage ratchet i backend lint/types; lint je posebno prošao). Prvi frontend poziv je premašio timeout alata, kasniji log prikazuje 66/650 ali bez zabilježenog exit koda; poseban ograničeni Vitest proces završio exit 0. Gate je prvo pao zbog nedostajućeg ledgera i zatim zbog neusaglašenih novih ruta, nakon upisa statusa prošao. Nije otkriven novi Critical/High u ovom skupu.

### CI 42275204800 — dijagnostika (2026-11-06)

[CI](https://github.com/mudzy992/gradix/actions/runs/42275204800) ima 5/6 uspješnih poslova (uključujući Web E2E), backend E2E nije prošao; reporter navodi exit 1 i pali `test/erp.e2e-spec.ts` bez kategorije timeout/lock/TypeScript i bez identiteta assertiona. `gh run view --log` vraća EOF, E2E JSON nije uploadovan. Na svježoj PG16 bazi sa 13 ručno primijenjenih migracija i seed-om, puni postojeći E2E (21 suite/206 testova, bez `--forceExit`) prošao je exit 0; ne dokazuje CI uzrok ni popravku. Reporter je test-first proširen da emitira samo SHA-256 `fullName` za svaki pali assertion, bez ispisa imena ili proizvoljne greške; ako nema assertiona ni to nije dostupno. Sačuvati CI logove uz odobren pristup; ne tvrditi da je problem otklonjen, ne koristiti retry kao popravku.

Reporter regresija: prvo crvena za neispisan fingerprint, zatim 6/6 `node --test scripts/audit/report-e2e.test.mjs`; puni lokalni E2E 21/206, backend unit 55/446, frontend Vitest 66/650 i `check:all` 0/3 skip. Fingerprint je identifikacijska pomoć, nije dokaz uzroka ni popravka ERP pada.

### Automatsko otkrivanje iz inventara (2026-11-06)

`test/helpers/discover-route-resource.ts` hoda slijeva nadesno po `:param` segmentima i traži tačno odgovarajući `GET` list obrazac u runtime inventaru; uzima prvi zapis iz HTTP odgovora, enkodira ID i rekurzivno obrađuje ugniježđene liste. Nema ručne route→ID tabele. Test koristi postojeći demo seed kao firmu A i B naloge/resurse postojećeg test fixture registryja; za GET šalje A admin vlastitu kontrolu, zatim svaki B role s uspješnom vlastitom GET kontrolom napada A ID i očekuje 403/404 bez A ID-a i `data`. B role koje nemaju 200 kontrolu **nisu dokazane**; neki list odgovori nisu ID zapisi, pa se ne tvrdi puna coverage niti se automatski podiže ledger. Dynamic selector nije dokaz da su sve dozvoljene role obuhvaćene; A/B redoslijed listi, prazan seed i izbor prvog reda mogu uticati na uzorak. Ne šalje mutacije.

Na svježem demo seed-u alat pronalazi po jednu rutu/ID za 10/19 GET, 6/11 DELETE, 10/18 PATCH i 16/26 POST parametarskih tenant ruta; to je **42 plana, ne 42 izvršena napada**. GET uzorci: 10 ruta, 3–10 rola po ruti; ostalih 9 GET blokirano. 32 ukupno parametrizirane rute blokiraju prazne liste ili nema list rute. Konkretne putanje, razlozi i komanda: `AUDIT/evidence/tenant-discovery-2026-11-06.txt`; preostali ledger redovi sadrže BACKLOG ID-eve. Demo seed nema sve vrste resursa (npr. nema diary/fuel/incident/document/service/tender/ERP/trip); tvrdnja da ih već ima nije potvrđena i mjerena je suprotno. No-list primjeri su izvještajni slugovi i task assignees/attachments/dependencies. POST s ID-ovima u bodyju, DELETE/PATCH/POST i filtrirane liste nisu generički provedeni. **Formalna puna pokrivenost ostaje 12/171**, cilj ≥80% nije postignut; pokrivenost ≠ broj planova/uzoraka. Novi Critical/High exploit nije potvrđen; nepokrivenost je visok rizik dokazi nisu potpuni. Najmanji naredni korak: test-only generički seed nedostajućih tipova + generisani DELETE s vlastitim pozitivnim kontrolama; zatim validni DTO/OpenAPI payloadovi (BL-TEST-01-SEED/NOLIST/DISCOVERY/MUTATION/LIST/IDENTITY), ne nova ručna matrica ruta.

Provjera: prazan PG16 + 13 ručno primijenjenih SQL migracija i test-only readiness + demo seed, discovery 2/2 exit 0; zasebna svježa baza i cijeli E2E 22/208 exit 0 bez `--forceExit`, backend unit 55/446, lint, frontend Vitest 66/650, `check:all` 0/3 skip. Puni suite može prethodno upisati dodatne demo podatke: izmjereni plan se razlikuje, zato referentni nalaz koristi samo zasebni svježi seed.

OpenAPI pregled je **samo dijagnostika**: `AUDIT/evidence/openapi-contract-2026-11-06.txt` bilježi 171/171 sa barem jednim response, ali svi nedostaju barem jedan od 400/401/403/404, 33 `list*` GET nemaju eksplicitni cursor/limit, a 18 mutacija nema requestBody (među njima legitimno bodyless). Strogi DTO/error/pagination gate nije uveden; bezuslovno uključivanje bi sada srušilo CI, a promjena page-based API-ja zahtijeva kompatibilni plan. BL-OPENAPI-01.

OpenAPI djelimični CI gate: `openapi-snapshot.e2e-spec.ts` čita stvarni Nest `/api/docs-json`, provjerava inventarisane runtime metode i bar jedan response te poredi SHA-256 punog dokumenta sa `docs/openapi.json`. Missing snapshot i namjerno izmijenjen snapshot test-first padaju, generisani snapshot prolazi; CI ne smije pokrenuti režim regeneracije. To nije zahtijevani kompletni contract gate, ne validira DTO/schema, opis svih grešaka ni cursor/limit; izmjene snapshota zahtijevaju review.
Snapshot provjere: na svježoj PG16 bazi (13 ručnih migracija + demo seed) cijeli E2E 23/209 exit 0 bez `--forceExit`; sam snapshot test u CI režimu prolazi, namjerni drift i `CI=true OPENAPI_WRITE=1` padaju. Backend unit 55/446, backend lint (nakon formatiranja), frontend 66/650 i `check:all` 0/3 skip. Prvi lint je otkrio samo formatiranje novog testa i nakon ispravke prošao.

### Strogi tenant eksperiment i AST ratchet (2026-11-06)

Test-only `PrismaService.$extends` je uključen kroz E2E test app samo s `TENANT_STRICT=1`; čita 41 model s kolonom `companyId` iz šest Prisma schema fajlova, provjerava konkretan bezuslovni top-level/AND tenant filter ili create data (svaki createMany red; upsert gdje + create), baca grešku i bilježi model+operaciju bez argumenata. Eksplicitna allowlista model+operacija+razlog je trenutno **prazna**: širok izuzetak za `User.findUnique` bi pored opravdanog login lookup-a sakrio i druge pozive. Transakcija potvrđeno prolazi kroz ekstenziju. `OR`, null i undefined nisu prihvaćeni kao izolacija. Ne prati nested Prisma radnje, raw SQL ili druge klijente i ne dokazuje da ID firme pripada autentificiranom korisniku.

Na svježoj PG16 bazi cijeli strict E2E: exit 1, 21/24 suite, 197/214 testova palo; 64 uhvaćena upita (63 odbijena, 1 scoped; uključujući 3 namjerna selftest upita). Većina je blokirana pri loginu/fixture lookupu, pa ostatak nije izvršen; **nije dokaz curenja** i preostale težine su neocijenjene. Broj ruta ostaje 12/171. Konkretni agregati i ograničenja: `AUDIT/evidence/tenant-strict-2026-11-06.txt`. CI zasad pokreće samo fokusirani strict selftest, ne cijeli suite sa strict=1; potreban je callsite-precizan auth/fixture izuzetak bez globalnog zaobilaženja i pregled upita (BL-TEST-01-STRICT/RAW).

AST ratchet u `scripts/standards/check-tenant.mjs` koristi postojeći TypeScript parser i schema modele, provjerava direktne model.operacija pozive u `backend/src`, uključuje prepoznate importovane scope helper-e, konzervativno prijavljuje nepoznate gdje/dataputanje i poredi fingerprint+broj pojavljivanja. Početni snapshot sadrži 234 kandidata (232 fingerprinta), svi su **nepregledani**, ne dozvola da su sigurni (BL-TEST-01-STATIC). Novi ili umnoženi kandidat ruši backend CI; promjena formatiranja može zahtijevati review baselinea. Dinamički pristup/aliasi/nested/raw SQL i vrijednost tenant konteksta nisu dokazani. Synthetic novi upit red-first ruši gate. Cilj sigurnosne izolacije ostaje nedovršen.

Provjera izmjene: fokusirani strict selftest 4/4; sa strict isključenim, svježa PG16 baza + 14 SQL migracija i demo seed, puni E2E 24/215 exit 0 bez forceExit. Backend unit 55/448, backend lint, frontend Vitest 66/650, `check:all` 0 fail/3 skip; AST regresija 2/2 i sintetički novi kandidat exit 1. Puni strict pad ne smije se prešutjeti time što je redovni suite zelen.

CI `d734e89` run [42283897872](https://github.com/mudzy992/gradix/actions/runs/42283897872) pao je na Audit poslu; lokalno je reprodukovan strogi audit status (`tenant-query-baseline.json` inventarisan kao `nepregledano` u STD-01 koji je `done`). Backend E2E, backend, frontend i Docker poslovi bili su uspješni; Web E2E je u trenutku provjere još trajao. Pregledan je **format i namjena datoteke**, status matrice ispravljen, ali 234 sadržana kandidata ostaju neocijenjena. `check:all` sada lokalno poziva strogi audit status prije pusha (bez online `--verify-ci`), da ista klasa statusnih grešaka ne ostane neprimijećena; bez skrivanja pada ili retryja kao popravke.
Provjere ispravke: red-first lokalni strogi audit izlaz pokazao je isti otvoreni JSON red; poslije ispravke `check:all --only=audit-status` prolazi, kompletni `check:all` 0 fail/3 skip, audit-gate regresije 20/20, backend unit 55/448, frontend 66/650. Kod aplikacije nije mijenjan; prethodni normalni PG E2E 24/215 vrijedi za isti testni kod.
