# AUDIT/STATE.md — živi dnevnik

> Ažurira se u svakom commitu; ranija evidencija je sačuvana u [historiji](history/STATE-2026-11-05.md).

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Bez PR-ova; mobile na čekanju do daljnjeg.

## Stanje segmenata

Trenutno: **48/61 segmenata `done`**. CI-05 je `done`; BE-19 i FE-17 su `in-progress` (planiranje).

## Zadnji commit i CI

- `d8d3512`: CI `42170687717` 6/6; B1 projects API.
- `f7e379b`: dokumentovano CI-05 zatvaranje na bazi zelenog CI-ja.
- `c842581`: CI `42169764781` 6/6; F-CI-05-73 riješen stvarnim Prisma Decimalom.

- Zadnji potvrđeni puni CI za prethodni kod evidentiran je u zaglavljima gotovih izvještaja; ne predstavlja dokaz za tekući commit.

## CI-05 — procesno zatvoren

- A0: 59 segmenata, 47 `done`, 640 redova; `nepregledano`: MOB-01 23, MOB-02 7, MOB-04 5, MOB-06 13, TEST-01 4.
- Dva `u-toku` reda u done segmentima pregledana: gate STD-01 i projektne kartice FE-08; ciljani FE testovi 37/37.
- Strogi gate i njegov online verifier potvrđeni su punim push CI-jem 6/6 za `6d1e925`.
- Rerun palih poslova: GitHub `run ... cannot be rerun; its workflow file may be broken`; nije izvršen.
- [Ledger](CI-05-LEDGER.md): 72 nalaza; [backlog](BACKLOG.md): 11 grupa i S-red, s indeksom historijskih ograničenja.
- `npm ci`, Node 22 i CI env: ista unit komanda 43/331 za 2026-11-05 i 2026-11-06 u UTC i Sarajevo; coverage iznad baseline-a.
- F-CI-05-73: izolovani geo test 4/9 pao → stvarni Prisma Decimal 10/10; backend 43/332; puni CI 6/6. Raniji padovi bez loga nisu dokazano isti uzrok.

## BE-19 / FE-17 — dashboard v2

- B0: plan i D-057 dopunjuju D-043; B1 djelimično: novi ograničeni projects API, bez promjene postojećeg ugovora.
- B1 test-first: unit 3/3, PG E2E 8/8 (12 SQL migracija ručno + demo seed), backend 44/335; CI 6/6. Admin UI još nije počeo.
- S-01 auth, S-02 novac i S-03 tenant moraju biti provjereni za nove putanje; drugi High ne blokiraju automatski.
- BL-001: mobile trip šalje slobodan `quantity` string; novo odbijanje više od 3 decimale je K1, inventura još traje.
- Bez novih zavisnosti bez K3 i bez mobile promjena; K2 vlasnika čeka admin screenshotove.

## Sljedeći korak

Započeti B1 dashboard v2 i raditi S-red paralelno; dashboard blokiraju samo Critical ili nalazi
koji zaista utiču na njegove podatke/tenant/prisutnost/auth. Prije UI realizacije razjasniti
S-01/S-02/S-03 za korištene putanje. Nakon admin screenshot checkpointa obavezna je K2 odluka.
