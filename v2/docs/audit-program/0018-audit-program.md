# ADR 0018 — Izričito naručeni program audita

**Datum:** 2026-11-27 · **Status:** prihvaćen kao nalog za Faze 0–1; poslovne odluke i G0/G1 još čekaju vlasnika.

## Kontekst

Pravilo 7 u `v2/AGENTS.md` zabranjuje samoinicijativne audite i postavlja limit od 30 stranica za `docs/`. Vlasnik je izričito naručio program audita i planiranja svih 12 modula. Program ima veći set artefakata od redovne projektne dokumentacije i mora preživjeti nastavak između sesija. Nalog ne daje odobrenje za poslovni kod, module ili mobilni UI.

## Odluka

Program je odobren kao zaseban vlasnikov zadatak. Njegovi artefakti žive **isključivo** u `v2/docs/audit-program/` i izuzeti su iz limita od 30 stranica. Pravilo 7 ostaje na snazi za sve ostale dokumente: `STATUS.md` ≤100 linija, ADR ≤1 stranica. Faza 0 završava na G0; Faza 1 završava tek nakon 12 modula i `00-UKRSTENO.md` na G1. Nema auditiranja modula prije G0 niti koda prije vlasnikove fraze `KREĆEMO U KODIRANJE: <modul>`.

## Razmotrene alternative

1. Ne raditi audit — odbijeno jer je zadatak izričito naručen.
2. Smjestiti audit u redovni `docs/` — odbijeno zbog limita i rizika da se arhiva pomiješa sa živim statusom.
3. Početi audit ili kod odmah — odbijeno zbog G0/G1 kapija i odvojenog odobrenja kodiranja.

## Posljedice

`STATE.md` je obavezni nastavak stanja i čita se na početku svake sesije. Artefakti u ovom folderu su jedini izuzetak od pravila 7; to ne otvara izuzetak za dnevnike ili audite izvan programa. Ovaj ADR odobrava proces, ne zaključke audita ni produkcijsku spremnost.
