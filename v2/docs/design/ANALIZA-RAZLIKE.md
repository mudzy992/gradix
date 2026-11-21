# Referenca (CSS) vs nativni prikaz (React Native) — gdje se razilaze i zašto

Referenca je `reference.html` (CSS u pregledniku), aplikacija je React Native.
Ovo je popis kategorija u kojima se prikaz **smije** razlikovati, šta je dokazano
testom, a šta se dokazuje tek snimkom s uređaja (Dio 1c posao).

| Kategorija | Referenca | Nativno | Status |
|---|---|---|---|
| Fontovi i težine | Manrope 500–800 + IBM Plex Mono preko `next/font` | Isti .ttf fajlovi (500/600/700/800, mono 500) u `assets/fonts`, `_layout` ne renderuje dok `useFonts` ne završi | Dokazano u kodu/testu (`theme/fonts.test.ts`); render na uređaju — tek snimak |
| Razmak slova (letter-spacing) | CSS `letter-spacing: -.02em` na naslovima | RN podržava `letterSpacing` u dp, ne u em; tokeni ga ne nose — naslovi su bez negativnog razmaka | Namjerno odstupanje, istog vizuelnog reda na 360 px |
| Ivice i sjene | CSS `box-shadow`, `border-radius` iz tokena | RN `elevation`/shadow props se razlikuju po platformi; katalog koristi ivice (`borderColor: line`) umjesto sjena | Ista hijerarhija, slabija sjena na Androidu — prihvatljivo, nije nova boja |
| Izvedene boje (color-mix) | Preglednik računa `color-mix(in srgb, …)` | RN nema color-mix — tokeni su unaprijed izračunate hex vrijednosti | **Dokazano testom:** `theme/tokens.test.ts` parsira web CSS, računa color-mix istim pravilom i poredi svaki token (12 testova) |
| Sigurne zone | CSS padding | RN: status bar / notch — ekrani idu kroz `Screen`/`ScrollView` s istim paddingom tokena; sistemske zone gura OS | Provjeriti na snimku (360 px) |
| Skala teksta sistema | Preglednik: px fiksno | RN poštuje sistemsku skalu fonta (accessibility) — tekst smije biti veći od reference | Namjerno: dostupnost ima prednost nad piksel-podudarnošću |

Kad vlasnik pošalje snimak iz emulatora: poredi se po gornjim kategorijama,
ispravke idu kroz tokene (`apps/mobile/src/theme/tokens.ts` + `src/ui`), nikad
kroz nove funkcije niti boje van palete.
