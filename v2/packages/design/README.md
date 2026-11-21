# @gradix/design

Testna pomoć za dizajn tokene — nije runtime paket i ne ulazi u bundle.

`css-tokens.ts` razrješava `globals.css` u konkretne boje: prati `var(--x)` rekurzivno i računa
`color-mix(in srgb, A p%, B)` po kanalima, isto kao preglednik.

Zašto postoji: web koristi `color-mix` (jedan izvor nijansi nad šest boja palete), a React Native
`color-mix` ne poznaje. Da mobilni ne bi dobio „svoje“ boje, test razriješi CSS i poredi sa
`apps/mobile/src/theme/tokens.ts` — u obje teme.
