# Demo — UI Step 7 (telefon)

Ekrani: **Moj dan** (radnik), **Grupa** (šef, glavni tok), **Radni dani** (ured, samo čitanje).
Snimci odobrenog dizajna: `docs/demo-dizajn/{360,1440}-{light,dark}-r4b-grupa.png`
(generiše ih `apps/web/scripts/step7-shots.mjs` iz `docs/design/reference.html#r4b-foreman-reference`).

## Koraci na telefonu (šef, grupni unos)

1. Prijavi se kao šef (`sef@demo.ba`). Na početnom ekranu izaberi **Grupa — unos za ekipu**.
2. Provjeri zajedničke podatke: projekat **P-01/2026**, mašina **BAG-01 · Bager CAT 320**,
   početak **07:30**, kraj **15:30**. Ekipa iz opsega je unaprijed izabrana (5 radnika).
3. Kod jednog radnika upiši pojedinačno vrijeme (npr. `08:00-16:00`) u polje ispod njegovog imena.
4. Dodirni **Sačuvaj za 5 radnika**. Svaki radnik dobija vlastiti zapis i vlastiti red ishoda.

## Offline scenario (avionski režim)

5. Uključi **avionski režim**. Banner pokazuje „Bez veze · 5 čeka slanje. Sačuvano na ovom telefonu.“
6. Dodirni **Pošalji sada** — slanje ne prolazi, zapisi ostaju na telefonu (ništa se ne gubi).
7. Isključi avionski režim i ponovo dodirni **Pošalji sada**.
8. Ishod po radniku se mijenja u **Poslano**; zapis koji server nije primio u opseg šefa ostaje
   vidljiv kao **Van opsega — ostaje na telefonu** (ne briše se i ne zove se odbijenim).
9. Ponovi **Pošalji sada**: već poslani zapisi se ne šalju drugi put (server ih prepoznaje kao
   duplikate; brojač poslanih se ne udvostručuje).

## Radnik i ured

10. Odjavi se (odjava sa neposlanim stavkama prvo traži izričitu potvrdu) i prijavi se kao radnik:
    **Moj dan** — izaberi projekat i mašinu, sačuvaj, pošalji.
11. Na webu (`/ured/radni-dani`, OWNER/ADMIN) dan je vidljiv u pregledu; dan sa otvorenim
    segmentom ili nepoznatim krajem nosi oznaku **Za provjeru**.
