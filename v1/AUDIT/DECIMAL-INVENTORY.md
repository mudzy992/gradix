# F-CI-05-64 — ulazni decimalni brojevi

Pregled 2026-11-06; primijenjena odluka D-058 (K1 A). Tabela je historijska mapa polja i ranijeg ponašanja, uz sljedeću važeću dopunu: **sva navedena ulazna polja sada provjeravaju navedenu skalu** (geofence query: 7); previše značajnih decimalnih mjesta se odbija, završne nule su dozvoljene. Direktni project/timer/user Prisma putevi sada pozivaju parser. 70 table-driven parser karakterizacija ne dokazuje sve HTTP/PG putanje; `decimal-scale.e2e-spec.ts` pokriva odabrane putanje. Ostatak karakterizacije, direktni vanjski pisci i opsezi idu u TEST-01. Sync batch s viškom skale i direktni zahtjevi vraćaju HTTP 400; batch se prije validacije ne obrađuje.

**Kolona „Trenutno ponašanje“ ispod bilježi stanje prije D-058** radi očuvanja dokaza; nije aktuelni ugovor za skalu.

Zajedničko: parser odbija nebrojeve, non-finite i nenulti underflow na nulu; završne nule su dozvoljene. `P` znači pozitivan, `N` nenegativan, `S` potpisan. `lenient` provjerava znak, ali ne DB skalu/opseg; `strict` provjerava stvarnu skalu i maksimalni apsolutni iznos (završne nule ne povećavaju skalu). PostgreSQL numeric upis može zaokružiti dodatnu skalu ili odbiti preljev; HTTP/DTO i ostale validacije mogu ranije odbiti zahtjev. Test parsera koji prihvati preljev nije dokaz da upis uspijeva.

| Endpoint / DTO polje | DB skala i granica | Trenutno ponašanje | Klijenti / testovi |
|---|---|---|---|
| POST/PATCH `/projects` `plannedBudget` | 12,2; 0..9999999999.99 | N lenient; PATCH prazno/null briše | web `project-sheet`; `projects.e2e`, `ops-web.e2e`, seed |
| POST/PATCH `/tenders` `submittedValue`; POST `/services/:id/complete` `totalCost` | 12,2; 0..9999999999.99 | N lenient | web `tenders-page` (kreiranje); `polish.e2e` |
| POST/PATCH `/projects/:id/quantities` `plannedQty` | 12,3; 0..999999999.999 | N lenient | `ops-core.e2e`, seed |
| isti endpoint `executedQty` | 12,3; ±999999999.999 | S lenient | `ops-core.e2e`, `erp.e2e`, seed |
| POST `/trips`, `/sync/push` TRIP, `/amendments` TRIP `quantity`, `weighQty` | 12,3; 0..999999999.999 | P lenient, **>3 decimale ostaju prihvaćene**; DB može zaokružiti | mobile `trip/new.tsx` online/offline quantity; sync prosljeđuje i weighQty; `fleet.e2e` |
| POST `/fuel`, `/sync/push` FUEL, `/amendments` FUEL `liters` | 12,3; 0..999999999.999 | P strict; izvedeni totalCost ima dodatni limit | mobile `fuel.tsx` online/offline; `fleet.e2e`, `erp.e2e` |
| isti endpointi `unitPrice`; POST `/cost-entries` `amount` | 12,2; 0..9999999999.99 | N strict; fuel product dodatno ograničen | mobile fuel online/offline; web `erp-costs-tab`; `erp.e2e` |
| POST `/stock-movements` `qty` | 12,3; ±999999999.999 | S nenula; novi upis servis odbija ako ima >3 decimale ili prelazi granicu; keyed replay starih podataka prije nove provjere | web `erp-stock-tab`, frontend ERP testovi uključuju `0.0005`; `erp.e2e` |
| POST/PATCH `/diary`, `/sync/push` DIARY, `/sync/resolve-conflict` incoming `tempMin`, `tempMax` | 4,1; ±100 aplikacijska granica | S, ograničeno ±100, ne provjerava skalu | mobile diary šalje tekst, sync podržava temperature; `ops-web.e2e` |
| POST `/locations/me` `accuracyM` | 8,2; ±999999.99 | S lenient, nema zabrane negativa | `fleet.e2e` testira lokacije; nije pronađen mobile GPS pošiljalac |
| POST `/trips` `originLat/Lng`, `destLat/Lng`; POST `/trips/:id/complete` `destLat/Lng`; sync TRIP ista polja | 10,7 | S, latitude ±90, longitude ±180; koordinate u paru, nema kontrole skale | sync prosljeđuje; trenutni mobile trip form ne šalje koordinate; `fleet.e2e` |
| POST `/locations/me`, `/machines/:id/location`, `/iot/gps`, `/incidents`, `/diary/:id/photos`, `/depots`; PATCH `/depots/:id`; sync PHOTO `lat`, `lng` | 10,7 | S, latitude ±90, longitude ±180; opcionalni par ili oba obavezna po DTO; bez kontrole skale | `fleet.e2e`, `iot.e2e`, `ops-web.e2e`, seed; sync PHOTO podržava polja |
| GET `/locations/geofence-check` query `lat`, `lng` | nije upis u decimal kolonu | S, latitude ±90 / longitude ±180; bez ograničenja skale | `fleet.e2e` |
| POST/PATCH `/projects` `lat`, `lng` | 10,7; DB opseg ±999.9999999 | DTO `IsString`, direktno u Prisma, bez shared parsera, bez kontrole para/geografskog opsega | `public.e2e` seed; web project sheet ne šalje ova polja |
| POST `/timer/start`, `/sync/push` TIMER `lat`, `lng` | 10,7; DB opseg ±999.9999999 | DTO string, direktno u Prisma, bez shared parsera i kontrole para/opsega | sync prosljeđuje; mobile timer provjeriti za konkretne GPS payload-e; `timer-create.ts` |
| POST/PATCH `/users` `hourlyRate` | 12,2; ±9999999999.99; snapshot je **10,2** | DTO string, direktno u Prisma, samo permission `payroll.write`; bez shared parsera/opsega/znaka; snapshot ima manji opseg | `users.service.ts`, `timer-force-close.service.ts`, payroll E2E; web user editor |

Dodatno: DB polja `currentSpend`, fuel `totalCost`, `currentWorkingHours`, `hourlyRateSnapshot` su izvedena iz obračuna, a ne direktna decimal DTO polja; pregledati njihove prelaze zasebno. Seed i E2E mogu direktno upisivati Prisma vrijednosti i ne potvrđuju sve kombinacije HTTP validacije. Geografska polja projekta/timera i satnica ranije su bila neposredni upisi; D-058 dodaje provjeru skale i parser karakterizaciju, ali ne tvrdi da su sve njihove DTO/servis/real-PG kombinacije testirane. Novi decimal input ne smije se prešutno klasificirati kao zaštićen samo zato što testira helper.

## K1: trip >3 decimalna mjesta (historijske opcije; usvojena A)

- **A:** strogo odbijanje sada i kasnije usklađivanje mobile/offline klijenta. To je breaking promjena za postojeće payload-e i queue.
- **B:** privremeno zaokruživanje uz logiranje i brojač dok mobile nije usklađen, zatim prelazak na strogo odbijanje. Zahtijeva odluku o politici i operativnom praćenju.

Vlasnik je odabrao A; od D-058 trip quantity/weighQty s više od 3 značajne decimale se odbijaju.
