# ADR 0004 — Novac: cijeli broj centi u kodu, decimalni string na granicama

**Datum:** 2026-11-07 · **Status:** predloženo (potvrda na G2 uz model podataka)

## Kontekst

v1 je imao više parsera i skala za decimalne iznose (B6.18), uz `numeric(12,2)` kolone i `float`-ove u međukoracima. Za firmu koja obračunava sate i gorivo, greška za jedan cent u zbiru je pitanje povjerenja, a ne kozmetike. A3.3.2 traži jedan tip i jednu funkciju za sve iznose.

## Odluka

- U kodu: `Money = { cents: bigint, currency }` (`@gradix/domain`). Nikad `number` za novac.
- Na granicama: unos i izlaz su **decimalni stringovi** (`"1234.56"`), u bazi `numeric(12,2)`.
- Valuta je dio tipa; sabiranje dvije valute baca grešku i ne prolazi tipski.
- Jedno zaokruživanje: `roundToCents` (pola naviše, od nule) za iznose nastale iz razlomka.
- Parsiranje je strogo: odbija zarez kao decimalni znak, više od dvije decimale, razmake, eksponent i prekoračenje `numeric(12,2)` — tiho zaokruživanje korisničkog unosa je zabranjeno.

## Alternative

1. **`decimal.js`/`bignumber.js`** — radi, ali nova zavisnost za operacije koje BigInt pokriva; više mjesta gdje se može izabrati pogrešna skala. Odbačeno.
2. **`number` (float)** — nesigurno za novac. Odbačeno.
3. **Decimal u cijelom kodu (Prisma `Decimal`)** — vuče biblioteku u domenski sloj i testove, a domenski sloj mora biti čist TypeScript. Odbačeno.

## Posljedice

- Formatiranje za prikaz (`12.000,00`) je UI sloj, ne domen; nikad `toLocaleString` u domenu.
- Testovi pokrivaju parsiranje, miješane valute, zbir i zaokruživanje (7 testova, `money.test.ts`).
- Ako se pojavi potreba za valutama s 3 decimale (npr. neka strana valuta), tip se mijenja na `{ amount: bigint, scale: number, currency }` — odluka se tada revidira.
