# DESIGN.md — Gradix dizajn (zamjenjuje sve ranije smjerove)

Vizuelna referenca: `reference.html`. Pisana pravila ispod. Referenca ima prednost; odstupanje traži odobrenje vlasnika i izmjenu reference u istom commitu.

**Referenca pokriva i:** dijaloge, prazna stanja, učitavanje (skeleton), poruke u tri stanja, ekrane prijave i lozinke, matricu rola, drawer ispod 960 px i pretvaranje tabele u kartice ispod 640 px, te mobilni ekran (prijava i teren). Ta stanja su dopunjena 2026-11-08 vlasnikovim odobrenjem — vidi `docs/DEMO-DIZAJN.md`.

## Karakter
Moderno, smireno, “mekani industrijski”: velike zaobljene površine, mnogo prostora, jedna jasna akcija po ekranu. Kao alat na terenu, ne kao marketing. Jedini prepoznatljiv element je **ravnalo stacionaže** (km+m) kao prikaz napretka dionice; žuta oznaka pokazuje gdje smo.

## Paleta (jedina) i teme
Brend `#140A9A` · akcent `#FFC82F` · tekst `#1B232A` · površina `#FFFFFF` · sekundarni tekst `#59656F` · ivica polja `#7B858D`. Ostale nijanse nastaju isključivo miješanjem ovih boja (`color-mix`).
- **Svijetla:** pozadina 5% teksta preko bijele, ploča bijela, primarna akcija = brend, tekst na primarnom = bijela.
- **Tamna:** pozadina = tekst boja (`#1B232A`), ploče 5–9% bijele preko nje, primarna akcija = **akcent** s tekstom `#1B232A`, brend se osvjetljava (40% brenda + bijela) za linkove, ikone i ispunu.
- Akcent nikad kao tekst na bijeloj podlozi. Tema prati sistem i može se ručno promijeniti; tokeni su semantički (`--panel`, `--raise`, `--sunken`, `--line`, `--primary`, `--link`).
- **Stanja** su takođe tokeni, ne nove boje: `--danger`/`--danger-soft` (greška), `--success`/`--success-soft` (uspjeh), `--warn-soft` (upozorenje), `--scrim` (zatamnjenje ispod dijaloga/drawera, 45% teksta). Sve su `color-mix` nad istom paletom.

## Stanja i slojevi
- **Dijalog:** ploča 18 px, `--shadow-lift`, preko `--scrim` (45%); naslov 20/700, jedna rečenica pod naslovom, akcije desno (Otkaži + primarna). Isti dijalog na telefonu ide od ivice do ivice po širini, bez promjene radijusa.
- **Prazno stanje:** isprekidana `--line` ivica, naslov + jedna rečenica + najviše jedna akcija.
- **Učitavanje:** skeleton trake 44 px u `--raise`, puls 1,6 s; bez spinnera i bez teksta. `prefers-reduced-motion` ga isključuje.
- **Poruka:** obojena podloga s ikonom — `--tint` (informacija), `--danger-soft` (greška), `--success-soft` (uspjeh), `--warn-soft` (upozorenje); tekst uvijek u boji koja prolazi AA na toj podlozi.
- **Tabela ispod 640 px:** ista tabela postaje kartice; ime kolone nosi `data-label`, ne duplirani tekst u markupu.

## Oblik
Ploča 18 px, kartica 16 px, polje/tile 12–20 px, dugme i chip **pilula**. Sjene samo u svijetloj temi i vrlo blage; u tamnoj ih nema. 1 px linija kao odvajanje. Razmaci na mreži 4 px (8/12/16/20/24/28).

## Tipografija
Manrope (samohostovano preko `next/font`) za interfejs; IBM Plex Mono za brojeve, šifre i vrijeme (tabularne cifre). Naslov stranice 30/800, sekcije 16/700, tijelo 14/500–600. Sentence case, bez VELIKIH SLOVA.

## Okvir
Sidebar 232 px na pozadini (bez ivice); glavni sadržaj je jedna velika zaobljena ploča s trakom na vrhu (pretraga `Ctrl K`, tema, korisnik). Aktivna stavka: podignuta pilula s ikonom u brend/link boji. Ispod 960 px sidebar postaje drawer, ploča puna širina.

## Komponente
Dugme 40 px pilula (primarno / tihо); polje 42 px, oznaka iznad; segmentirani izbor; chip sa tačkom (radi = puna, zastoj = žuta, servis = prazna; stanje nikad samo bojom); poruka kao obojena podloga s ikonom; tabela s razmakom, bez zebre i s hover podlogom; rokovi kao lista sa pilulom broja dana (žuta kad je blizu).

## Mobilni (Expo)
Iste boje, tipografija i teme (isti tokeni kao web, test ih poredi). Mete ≥ 56 dp, jedna velika primarna akcija, pločica stanja sa mono brojem. Prekidač teme stoji u zaglavlju ekrana; fontovi su iste porodice kao na webu. Donja navigacija do 5 stavki dolazi s prvim modulom; danas je ekran jednokratan (prijava → zapis).

## Pristupačnost
Kontrast AA u obje teme, vidljiv fokus (`--link`, 2 px), cijela navigacija tastaturom, `prefers-reduced-motion`, bez ulaznih animacija; samo 120 ms prelazi na boji.
