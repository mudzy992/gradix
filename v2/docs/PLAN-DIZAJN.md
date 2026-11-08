# PLAN — dizajn v2 po `DESIGN.md` (zamjena odbačenih smjerova A/B i R1c okvira)

**Datum:** 2026-11-07 · **Status:** ✅ završeno 2026-11-08 (vlasnik odobrio; odstupanja dopunjena u referenci) · **Izvor istine:** `docs/design/DESIGN.md` + `docs/design/reference.html`
**Obim:** samo vizuelno. Nijedna funkcionalnost se ne mijenja, nijedan API, nijedna dozvola.
**Kapija:** vlasnik pregleda snimke u **obje teme**, 1440 i 360, sva stanja ekrana.

## Šta se briše

Odbačeno je sve prije ovog dokumenta: smjerovi A/B, „industrijski oštar“ R1c okvir (2 px radijus,
bez sjenki, 36 px red), `demo-r1a/`, `demo-r1b/`, `r1c-predlog/`, `PALETA.md`, `ODLUKA-R1A.md`,
`PLAN-R1c.md`, `DEMO-G1b.md`, `DEMO-G1c.md`. Ostaje `DESIGN.md` i `reference.html` — jedini izvor.

## Redoslijed (vertikalni rezovi, svaki provjeren prije sljedećeg)

1. **Tokeni** (`globals.css`, `apps/mobile/src/theme/tokens.ts`): semantički tokeni, svijetla i
   tamna tema, sve nijanse iz `color-mix` nad šest boja palete. Test: web/mobilni se ne raziđu
   (poređenje **razriješenih** vrijednosti), i **AA kontrast u obje teme** za tekst, tihi tekst,
   fokus i tekst na primarnoj akciji.
2. **Fontovi** preko `next/font`: Manrope (interfejs) + IBM Plex Mono (brojevi, šifre, vrijeme),
   samohostovano (`next/font/local`, `woff2` u repou) — sandbox ne dohvata Google Fonts.
3. **Okvir**: sidebar 232 px na pozadini (bez ivice), velika zaobljena ploča sa gornjom trakom
   (pretraga `Ctrl K`, tema, korisnik), aktivna stavka kao podignuta pilula. Drawer < 960 px.
4. **Primitivi** (`ui.tsx`): dugme 40 px pilula, polje 42 px sa oznakom iznad, segmentirani izbor,
   chip sa tačkom, poruka kao obojena podloga s ikonom, tabela bez zebre sa hover podlogom.
5. **Ekrani**: prijava, promjena/postavljanje lozinke, pregled, korisnici, pristup i role, audit —
   ista logika, novo ruho.
6. **Tema**: prati sistem (`prefers-color-scheme`) + ručni prekidač (pamti se u `localStorage`,
   primjenjuje prije prvog iscrtavanja da nema treperenja). Isti tokeni na mobilnom.
7. **Snimci**: svaki ekran × {1440, 360} × {svijetla, tamna} × sva stanja (prazno, greška,
   učitavanje, dijalog, `Ctrl+K`, drawer). Skripta u `apps/web/scripts/`.
8. **Dokumentacija**: `docs/DEMO-DIZAJN.md`, `STATUS.md`, `AGENTS.md`.

## Pravila koja test čuva (umjesto review-a)

- Nijedna komponenta ne sadrži hex; sve ide kroz semantičke tokene.
- Nijedna nijansa nije nova: u `globals.css` smiju postojati samo šest boja palete kao heks, sve
  ostalo je `color-mix`.
- AA kontrast u **obje** teme: tekst 4,5:1, tihi tekst 4,5:1, fokus i ivice polja 3:1, tekst na
  primarnoj akciji 4,5:1.
- Oblik iz reference: ploča 18 px, kartica 16 px, polje 12 px, dugme/chip pilula.
- Tema: `data-theme` na `<html>`, obje vrijednosti moraju postojati.

## Odstupanje od reference — riješeno

Vlasnik je 2026-11-08 prihvatio osam elemenata kao „isto, bez novog jezika“, pa su dopunjeni u
`reference.html` (tokeni stanja, sekcija „Dijalozi, stanja i prijava“, drawer, `table.cards`,
mobilni) i u `DESIGN.md` (§ Stanja i slojevi). Popis sa snimkama: `docs/DEMO-DIZAJN.md` §4.

<details><summary>Prvobitni tekst (prije odobrenja)</summary>

Referenca pokriva: okvir, gornju traku, dugmad, polja, segment, chip, tabelu, rokove, poruku,
mobilni ekran. **Ne pokriva**: dijaloge (pozivnica, role i opseg, detalj audita), prazna stanja,
učitavanje, ekran prijave i promjene lozinke, tabelu matrice rola.

Za te dijelove ne izmišljam nov vizuelni jezik: koristim iste tokene i iste primitive (ploča,
pilula, polje, chip, poruka). **To je odstupanje i traži tvoju riječ** — prije nego dopunim
`reference.html`, ne mijenjam ga sam. Sve takve tačke su popisane u izvještaju.
</details>

## Ne ulazi

Nove stranice, nove akcije, izmjena API-ja, izmjena dozvola, tamna tema za PDF/print, animacije
osim 120 ms prelaza na boji (`prefers-reduced-motion` isključuje).
