# AUDIT/STATE.md — živi dnevnik

> Ažurira se u svakom commitu; ranija evidencija je sačuvana u [historiji](history/STATE-2026-11-05.md).

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; mobile na čekanju do daljnjeg.

## Stanje segmenata

Trenutno: **47/61 segmenata `done`**. CI-05 je `in-progress` (čeka puni CI); BE-19 i FE-17 su `in-progress` (planiranje).

## Zadnji commit i CI

- `e002b19` (gate, CI-05 trijaža, B0): CI `42111636754` 5/6, opet backend unit/coverage.
- `c7bf610` (docs): CI `42109948886` 5/6, isti posao; oba loga EOF, uzrok nepoznat (BL-011).
- Zadnji zeleni: `8cac43d` (BE-01), CI 6/6.
- Zadnji potvrđeni puni CI za prethodni kod evidentiran je u zaglavljima gotovih izvještaja; ne predstavlja dokaz za tekući commit.

## CI-05 — administrativno trijažiran, puni CI blokiran

- A0: 59 segmenata, 47 `done`, 640 redova; `nepregledano`: MOB-01 23, MOB-02 7, MOB-04 5, MOB-06 13, TEST-01 4.
- Dva `u-toku` reda u done segmentima pregledana: gate STD-01 i projektne kartice FE-08; ciljani FE testovi 37/37.
- Strogi gate i njegov online verifier potvrđeni su punim push CI-jem 6/6 za `6d1e925`.
- Selektivni `workflow_dispatch` na aktivnoj grani vraća HTTP 403; nije izvršen.
- [Ledger](CI-05-LEDGER.md): 72 nalaza; [backlog](BACKLOG.md): 11 grupa i S-red, s indeksom historijskih ograničenja.
- Lokalno: audit Node 44/44, online gate PASS, backend coverage 43/330 čak i s CI env, FE 59/599, check:all PASS (2 backend koraka preskočena).
- F-CI-05-64: test-first ispravka podlijevanja u BE-01; unit 43/330 i ponovljeni svježi PG E2E 16/146 PASS. Druge skale/polja i F-FE-06-06 ostaju otvoreni.

## BE-19 / FE-17 — dashboard v2

- B0: plan i D-057 dopunjuju D-043; implementacija admin checkpointa još nije počela.
- S-01 auth, S-02 novac i S-03 tenant moraju biti provjereni za nove putanje; drugi High ne blokiraju automatski.
- BL-001: mobile trip šalje slobodan `quantity` string; novo odbijanje više od 3 decimale je K1, inventura još traje.
- Bez novih zavisnosti bez K3 i bez mobile promjena; K2 vlasnika čeka admin screenshotove.

## Sljedeći korak

Pribaviti log palog backend posla CI-ja i dovesti puni CI do zelenog za CI-05; B1 dashboard v2 i S-red paralelno; dashboard blokiraju samo Critical ili nalazi
koji zaista utiču na njegove podatke/tenant/prisutnost/auth. Prije UI realizacije razjasniti
S-01/S-02/S-03 za korištene putanje. Nakon admin screenshot checkpointa obavezna je K2 odluka.
