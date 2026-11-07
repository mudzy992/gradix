# Dizajn odluka — R1a (vlasnik, 2026-11-08)

Ulaz: smjer **A** za web panel (gusta tabela), sa prelivanjem u kartice na uskom ekranu
(raspored iz smjera **B**). Mobilni: principi **B** — krupne mete, jedna primarna akcija.

## Tri pravila koja iz toga slijede

1. **Jedna kontekstualna akcija po redu.** U tabeli korisnika ostaje tačno jedna akcija koja
   odgovara stanju osobe:
   - čeka prvu prijavu → **Pošalji pozivnicu ponovo**
   - aktivan → **Pošalji reset lozinke**
   - deaktiviran → **Aktiviraj**

   Sve ostalo ide u meni **„⋯“** (detalji, istorija, deaktivacija, kopiranje emaila).
   Time red ima jedan jasan poziv i nijedan dugme-šum.

2. **Primarno dugme je pune širine samo ispod 640 px.** Na širem ekranu ima svoju prirodnu
   širinu i stoji uz sadržaj, ne preko cijelog reda.

3. **Dvije gustine nad istom paletom i tipografijom** (`data-density`):

   | | gusto (ured) | udobno (teren) |
   |---|---|---|
   | visina reda tabele | 40 px | 56 px |
   | vertikalni padding ćelije | 8 px | 16 px |
   | dodirna površina | 32 px | 48 px |
   | tijelo teksta | 15 px | 17 px |
   | razmak sekcija | 16 px | 24 px |

   Gustina je atribut na `<html>` (`gusto` podrazumijevano za web, `udobno` za mobilni), pa se
   mijenja bez izmjene komponenti. Paleta i tipografija su iste u oba slučaja — gustina mijenja
   samo ritam, ne izgled.

## Šta to znači za ekrane R1a

- Lista korisnika: gusta tabela ≥ 640 px, kartice < 640 px (isti HTML, CSS mijenja raspored).
- Pozivnica i reset: jedna primarna akcija (puna širina samo na uskom ekranu), link za kopiranje
  u polju koje se čita, ne u dijalogu koji nestaje.
- Mobilni: jedan ekran, jedna primarna akcija po stanju, meta 48 px.
