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
