# AUDIT/STATE.md — živi dnevnik

> Ažurira se u svakom commitu; ranija evidencija je sačuvana u [historiji](history/STATE-2026-11-05.md).

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; mobile na čekanju do daljnjeg.

## Stanje segmenata

Trenutno: **47/61 segmenata `done`**. CI-05 je `in-progress` (čeka puni CI); BE-19 i FE-17 su `in-progress` (planiranje).

## Zadnji commit i CI

- `3375497`: ponovo pada backend unit/coverage; ostali poslovi još završavaju (run `42167920165`).
- `e002b19` i `c7bf610`: isti backend korak pao, logovi EOF, uzrok nepoznat (BL-011).
- Zadnji zeleni: `8cac43d` (BE-01), CI 6/6. `8cac43d..c7bf610` mijenja samo tri AUDIT dokumenta, ne backend kod/testove.
- Zadnji potvrđeni puni CI za prethodni kod evidentiran je u zaglavljima gotovih izvještaja; ne predstavlja dokaz za tekući commit.

## CI-05 — administrativno trijažiran, puni CI blokiran

- A0: 59 segmenata, 47 `done`, 640 redova; `nepregledano`: MOB-01 23, MOB-02 7, MOB-04 5, MOB-06 13, TEST-01 4.
- Dva `u-toku` reda u done segmentima pregledana: gate STD-01 i projektne kartice FE-08; ciljani FE testovi 37/37.
- Strogi gate i njegov online verifier potvrđeni su punim push CI-jem 6/6 za `6d1e925`.
- Rerun palih poslova: GitHub `run ... cannot be rerun; its workflow file may be broken`; nije izvršen.
- [Ledger](CI-05-LEDGER.md): 72 nalaza; [backlog](BACKLOG.md): 11 grupa i S-red, s indeksom historijskih ograničenja.
- `npm ci`, Node 22 i CI env: ista unit komanda 43/330 u UTC i Sarajevo sa vremenom 2026-11-06; coverage iznad baseline-a.
- BL-011: unit reporter daje redigovan summary/anotacije i artefakt; specifični uzrok CI pada još nije dokazan. F-CI-05-64 ostaje djelimičan.

## BE-19 / FE-17 — dashboard v2

- B0: plan i D-057 dopunjuju D-043; implementacija admin checkpointa još nije počela.
- S-01 auth, S-02 novac i S-03 tenant moraju biti provjereni za nove putanje; drugi High ne blokiraju automatski.
- BL-001: mobile trip šalje slobodan `quantity` string; novo odbijanje više od 3 decimale je K1, inventura još traje.
- Bez novih zavisnosti bez K3 i bez mobile promjena; K2 vlasnika čeka admin screenshotove.

## Sljedeći korak

Pribaviti log palog backend posla CI-ja i dovesti puni CI do zelenog za CI-05; B1 dashboard v2 i S-red paralelno; dashboard blokiraju samo Critical ili nalazi
koji zaista utiču na njegove podatke/tenant/prisutnost/auth. Prije UI realizacije razjasniti
S-01/S-02/S-03 za korištene putanje. Nakon admin screenshot checkpointa obavezna je K2 odluka.
