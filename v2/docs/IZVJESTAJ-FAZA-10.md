# Izvještaj — Faza 10

## Baza i domena

Faza obuhvata centralno i gradilišno skladište, kretnje i popis, nabavne zahtjeve, narudžbe, prijeme i fakture, izlaze materijala i rekalasifikaciju te ugovore, anekse i situacije podizvođača. Tenant/RLS/grants i append-only troškovi prate postojeći model. Situacija knjiži bruto, neto je bruto manje retention i warranty; prekoračenje ugovora upozorava, ali ne blokira. Pravo na podizvođača proizlazi i iz aktivne dodatne uloge, ne samo primarnog tipa partnera. Ručni trošak iznad praga čeka odobrenje.

## API, web i mobilni

OpenAPI ima 273 putanje, uključujući GET aneksa; stock katalog ugovor usklađen je sa stvarnim snake_case odgovorom servera. Web ima ekrane skladišta, nabavke i podizvođača, sa vrijednostima, odobravanjem i upozorenjima. Mobilni izlaz koristi SQLite v6, privatni katalog i account-partitioned outbox; ponovno slanje koristi isti UUID i postojeći idempotentni POST. Izlaz je na serveru tek nakon potvrde. Katalog zahtijeva prethodno osvježavanje na mreži; `mine=1` zahtijeva dodjelu projekta. Novi ekran koristi zajednički Button s minimalnom metom 56 dp; provjereno u screen testu.

## Provjere

Tražene pune komande pokrenute su jednom, prije završnih korekcija. Rezultati se **ne predstavljaju kao zeleni za finalni snapshot**:

| Provjera | Rezultat |
|---|---|
| `pnpm test` | FAIL: mobilni `r4-outbox` očekivao retry 0 kod promjene naloga; 126 mobilnih testova prošlo, 1 pao. Turbo je prekinuo prije završetka svih paketa. Greška je ispravljena i taj test ponovo ciljano prolazi. |
| `pnpm lint` | PASS prije završnih korekcija; naknadni ciljani lint promijenjenih fajlova PASS. |
| `pnpm typecheck` | PASS prije završnih korekcija; naknadni tsc contracts/web/mobile PASS. |
| `pnpm check-cycles` | PASS. |
| `pnpm db:types:check` | PASS (140 tabela). |
| `packages/db/preflight-checks/run.sh` | FAIL: `psql` nije instaliran. Dopunski: oba ista SQL fajla izvršena preko Node PostgreSQL klijenta kao aplikacijska rola, uz učitanu matricu: PASS. To nije prolaz originalne shell komande. |
| `pnpm check-tenant-sql` | PASS, 132 tenant tabele i 1269 query poziva. |
| `pnpm check-matrix-parity` | PASS uz postojeće upozorenje R1 `NOT_IMPLEMENTED`. |

Broj testova završenih u jedinom punom prolazu: worker 25/25, contracts 21/21, domain 331/331, mobile 126/127; web i db nisu kompletirani jer je Turbo prekinuo. Naknadno ciljani dokazi: mobilni outbox/R4 14 testova, mobilni ekran 2, migracije 6, mobilna navigacija 13; web podizvođači/navigacija 18 (uključuje axe), server/NUL 12; contracts `contract.test.ts` 19 nakon dopune stock DTO-a. Skupovi se djelimično preklapaju i ne smiju se zbrajati u ukupni broj. Raniji puni web/DB iz 10A-3: 747/747 i 79/79; nisu puni testovi završnog snimka. Jsdom je ispisao canvas upozorenje pri axe provjeri.

Prethodni CI za 10B-1: [45809926068](https://github.com/mudzy992/gradix/actions/runs/45809926068), verify success, e2e-stabilnost skipped. CI završnog commita i release tag nisu ovim dokumentom unaprijed potvrđeni.

## Ograničenja i prelaz u Fazu 11

Nabavne forme obrađuju po jednu stavku; web liste imaju limit 500, prikazano prekoračenje je orijentaciono, server je konačan. Accountant može vidjeti ID partnera ako mu nije dostupno upravljanje partnerima. Offline unos ne rezerviše zalihe; odbijanje na serveru treba ručno razriješiti. Katalog po projektu/korisniku može postati zastario i korisnik mora biti raspoređen na projekat. Produkcijska migracija i mobilni rad na stvarnom uređaju nisu verificirani. Do dokaza zelenog CI za završni commit i provjere deploymenta ne tvrditi da je Faza 11 produkcijski spremna.
