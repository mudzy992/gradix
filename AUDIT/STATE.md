# AUDIT/STATE.md — živi dnevnik

> Ažurira se u svakom commitu; ranija evidencija je sačuvana u [historiji](history/STATE-2026-11-05.md).

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; mobile na čekanju do daljnjeg.

## Stanje segmenata

Trenutno: **48/61 segmenata `done`**. CI-05 je `done`; BE-19, FE-17 i TEST-01 su `in-progress` (dashboard K2 i inventar ruta).

## Zadnji commit i CI

- `2772a0e`: CI [42219098138](https://github.com/mudzy992/gradix/actions/runs/42219098138) 6/6; D-059 server replay.
- `77ca0f4`: CI [42267832249](https://github.com/mudzy992/gradix/actions/runs/42267832249) 6/6; prijedlog rola bez UI izmjena.
- Tekući commit: stvarni tenant fixturei i početni TEST-01 resource gate; CI čeka push.

- Zadnji potvrđeni puni CI za prethodni kod evidentiran je u zaglavljima gotovih izvještaja; ne predstavlja dokaz za tekući commit.

## CI-05 — procesno zatvoren

- A0: 59 segmenata, 47 `done`, 640 redova; `nepregledano`: MOB-01 23, MOB-02 7, MOB-04 5, MOB-06 13, TEST-01 4.
- Dva `u-toku` reda u done segmentima pregledana: gate STD-01 i projektne kartice FE-08; ciljani FE testovi 37/37.
- Strogi gate i njegov online verifier potvrđeni su punim push CI-jem 6/6 za `6d1e925`.
- Rerun palih poslova: GitHub `run ... cannot be rerun; its workflow file may be broken`; nije izvršen.
- [Ledger](CI-05-LEDGER.md): 72 nalaza; [backlog](BACKLOG.md): 11 grupa i S-red, s indeksom historijskih ograničenja.
- `npm ci`, Node 22 i CI env: ista unit komanda 43/331 za 2026-11-05 i 2026-11-06 u UTC i Sarajevo; coverage iznad baseline-a.
- F-CI-05-73: pravi Prisma Decimal i guard; random backend poslije promjena UTC 10/10 + Sarajevo 10/10 (45/395 po pokretanju). Raniji povremeni prolaz i padovi bez loga nisu dokazano objašnjeni.
- Rerun REST HTTP 403 `Resource not accessible by integration`; dispatch ranije 403, tijelo nije sačuvano. YAML parsiran, nije actionlint.

## BE-19 / FE-17 — dashboard v2

- B0: plan i D-057 dopunjuju D-043; B1 djelimično: scalarni KPI, projects API s koordinatama, analitika kreiranja zadataka, admin audit aktivnost, odobrene minute timera, GPS procjena prisustva i upozorenja isteka dokumenata i rokova zadataka (cursor/limit); demo 30-dnevni trendovi. Ostali endpointi nisu završeni.
- Admin v2: nezavisni tenant-keyed upiti, tačan decimalni prikaz, lazy mapa sa fallbackom, pristupačni SVG grafikoni, dark/light, BS/EN; ostale role ostaju na starom dashboardu.
- S-01 auth, S-02 novac i S-03 tenant moraju biti provjereni za nove putanje; drugi High ne blokiraju automatski.
- BL-001: [inventura](DECIMAL-INVENTORY.md), D-058 K1 A; 70 parser slučajeva, PG E2E 17/170. Preostali HTTP/PG i DB opsezi idu u TEST-01.
- Bez novih zavisnosti bez K3 i bez mobile promjena; Paleta Ctrl/Cmd+K po pravima integrisana; admin screenshotovi, axe i lokalna mjerenja pripremljeni za K2.

## Sljedeći korak

Prvo TEST-01 stvarni resursi i list filteri; zatim S-01 retry/lifetime, backend ugovori, pa TEST-02. K2 čeka vlasnika; drugi dashboardi i vizuelne promjene na čekanju. Prijedlog: `docs/design/FE-17-roles.md`. Detalji u [handoffu](HANDOFF.md).

- TEST-01: ograničeni PG/HTTP dokaz stvarnih projektnih GET/PATCH ID-eva u dvije firme za svih 10 rola; detalji i ograničenja u segmentu.

- E2E: 20 serijskih prolaza exit 0, detectOpenHandles bez prijavljenih handleova, test PG konekcije 0; izvorni exit 1 nije reproduciran. Dokazi i ograničenja: `evidence/e2e-exit-2026-11-06.txt`, TEST-01 i `docs/TESTING.md`.

- TEST-01: 12/171 stvarnih GET/DELETE slučajeva u oba smjera s pozitivnim kontrolama; 2 liste djelimično, 146 pending, 11 public izuzetaka. Cilj 95% nije dostignut; granice i ledger u TEST-01. Raniji permission-negative uzorci nisu dokaz izolacije.

- S-01: D-059 implementira serverski replay i family-scope reuse; grace kompromis i rollout rizici izričito zapisani. Web i dalje traži novu prijavu.
