# Paleta — odluka vlasnika, 2026-11-08

**Ulaz od vlasnika:** `#FFC82F` `#140A9A` `#1B232A` `#FFFFFF` `#59656F` `#7B858D`
**Formati:** `CSS` zmijica za web (`@theme`), `TS` za mobilni (`src/theme/tokens.ts`). Jedan izvor istine.

## Mapiranje ulaza

| Ulaz | Uloga | Napomena |
|---|---|---|
| `#140A9A` | **brend / primarna akcija** | 13,64:1 na bijelom — najjači element, koristi se štedljivo |
| `#FFC82F` | **akcent** | nikad kao tekst na svijetlom (1,55:1) |
| `#1B232A` | tekst + tamna podloga | 15,90:1 na bijelom |
| `#FFFFFF` | površina | |
| `#59656F` | sekundarni tekst | 5,97:1 — prolazi za svaki tekst |
| `#7B858D` | **samo ivice i veliki tekst** | 3,76:1 — **ne** za sitan tekst (vidi niže) |

## Izvedeni tokeni

Paleta nema crvenu, zelenu ni nijanse za stanja — dodate su mjerene, jer greška/uspjeh moraju postojati.

| Token | Vrijednost | Namjena |
|---|---|---|
| `brand` | `#140A9A` | link, primarno dugme, aktivna stavka |
| `brand-hover` | `#0D0770` | hover/active (16,39:1 sa bijelim tekstom) |
| `brand-soft` | `#E8E9FB` | red tabele na hover, izabrana stavka |
| `accent` | `#FFC82F` | bedž, fokus prsten na tamnom, CTA akcenat |
| `accent-soft` | `#FDF3D6` | upozorenje u pozadini |
| `surface` / `surface-muted` | `#FFFFFF` / `#F5F6F7` | kartica / stranica |
| `surface-inverse` | `#1B232A` | tamna podloga (header, dark mode osnova) |
| `text` / `text-muted` | `#1B232A` / `#59656F` | tijelo / sekundarno |
| `border` / `border-strong` | `#D7DBDF` / `#7B858D` | razdjelnik / ivica polja za unos (3,76 ≥ 3:1 = WCAG 1.4.11) |
| `danger` | `#C1121F` | greška (6,22:1) |
| `success` | `#186B3E` | uspjeh (6,54:1) |
| `warning-text` | `#8A5E06` | tekst upozorenja (5,70:1; sam akcent nije čitljiv) |
| `focus` | `#140A9A` na svijetlom, `#FFC82F` na tamnom | 13,64:1 / 10,27:1 |

## Izmjereni kontrasti (WCAG 2.2)

| Par | Ratio | Ocjena |
|---|---|---|
| `text` / `surface` | 15,90 | AAA |
| `text` / `surface-muted` | 14,70 | AAA |
| `text-muted` / `surface` | 5,97 | AA |
| `text-muted` / `surface-muted` | 5,52 | AA |
| `text-muted` / `brand-soft` | 4,97 | AA |
| `white` / `brand` | 13,64 | AAA |
| `brand` / `surface` | 13,64 | AAA |
| `white` / `danger` | 6,22 | AA |
| `white` / `success` | 6,54 | AA |
| `accent` / `surface-inverse` | 10,27 | AAA |
| `text` / `accent` | 10,27 | AAA |
| `warning-text` / `surface` | 5,70 | AA |
| `brand` / `accent` | 8,80 | AAA |
| `border-strong` / `surface` | 3,76 | AA za ivice (1.4.11) |
| **`accent` / `surface`** | **1,55** | **zabranjeno kao tekst** |
| **`#7B858D` / `surface`** | **3,76** | **zabranjeno za sitan tekst** |

## Pravila koja se ne krše

1. `accent` je **podloga i ivica**, nikad tekst na bijelom. Na akcentu tekst je `text` (#1B232A).
2. `#7B858D` je `border-strong` i veliki tekst; sitan tekst ide `text-muted` (#59656F).
3. Primarno dugme = `brand` podloga + bijeli tekst. Nikad `accent` podloga sa bijelim tekstom (1,55:1).
4. Nijedna komponenta ne hardkodira boju — samo tokeni. Mobilni dobija isti fajl vrijednosti.

## Šta ovo mijenja odmah

| Mjesto | Sada | Poslije |
|---|---|---|
| `apps/web/src/app/globals.css` | 10 oklch tokena | gornja tabela |
| `apps/web/src/app/login/page.tsx` | `bg-red-50` (Tailwind default) | `bg-[var(--color-danger-soft)]` |
| `apps/mobile/src/app/index.tsx` | 11 hardkodiranih hex | `src/theme/tokens.ts` |

Mobilni trenutno odstupa od weba (`#1f6f4a` vs `#23643F`, `#f7faf8` vs `#F1F7F3`) — poslije ovoga su identični. Dizajn smjerovi (dva predloga sa ekranima) ostaju Faza 2; ovo su samo vrijednosti.
