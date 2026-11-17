# Pilot — probni rad s jednom ekipom

## Ko učestvuje
- **Vlasnik/ured (1-2 osobe):** pozivnice, unos radnika/mašina/projekata, pregled
  radnih dana, razrješavanje sukoba. Direktan kontakt s Gradix podrškom.
- **Šef gradilišta (1):** vodi svoju ekipu na telefonu, unosi grupne dane.
- **Radnici (3-5):** unose vlastiti dan na telefonu; bez naloga oni koje šef vodi u grupi.

## Priprema (prije prvog dana)
1. Vlasnik šalje Excel primjere: spisak radnika, mašina i jedan aktivan projekat.
2. Ured ih uvozi kroz ekran **Uvoz** (isti format kao primjer) i provjeri brojke.
3. Korisnici se pozivaju pozivnicom iz **Korisnici**; svako postavi svoju lozinku.
4. Šef i radnici instaliraju aplikaciju i prijave se jednom **uz mrežu** (prva
   prijava mora biti online).

## Kontrolna lista prvog dana
- [ ] Svi pozvani su se prijavili; šef vidi svoju ekipu, radnik svoj „Moj dan“.
- [ ] Jedan probni unos poslan i vidljiv uredu u Radnim danima.
- [ ] Telefon zaključan PIN-om/otiskom; ugašen ekran ne gasi prijavu.
- [ ] Pokazan rad bez mreže: unos se sprema na telefon i šalje kad veza dođe.

## Šta reći pilot-korisnicima
- **Zaključavanje ekrana obavezno** — na telefonu su podaci firme.
- **Problem se javlja isti dan** vlasniku (poruka/poziv), ne na kraju sedmice:
  šta ste radili, šta je pisalo, fotografija ekrana pomaže.
- **Bez mreže se radi normalno.** Banner „Bez veze“ znači da zapisi čekaju na
  telefonu; „Pošalji sada“ kad veza dođe. Zapis označen „Van opsega“ nije
  odbijen — ostaje na telefonu i ured ga vidi kad opseg obuhvati taj datum.

## Šta mjerimo (sedmično, bez ulaska u bazu)
Vlasnik sve vidi iz aplikacije: **Radni dani** (unosi po danu, otvoreni dani),
**Pregled** (sukobi koji čekaju razrješenje i njihova starost), **Revizija/Audit**
(izmjene i greške slanja), svaki telefon pokazuje neposlane zapise i ishode
slanja. Ciljne mjere: unosi/dan po radniku, broj i starost sukoba, broj
otvorenih dana, vrijeme unosa (ručna procjena šefa), greške sinhronizacije.

## Ako pilot ne uspije
Aplikacija se gasi, pilot podaci se izvoze iz ureda (lista radnih dana), rad se
nastavlja dotadašnjim načinom. Nijedan podatak ne ostaje zarobljen: izvoz je
uvijek dostupan vlasniku, a lokalni zapisi na telefonima ostaju čitljivi u
aplikaciji do deinstalacije.

## Plan 2c — uvoz iz neurednih Excela (bez koda dok vlasnik ne odobri)

**Već postoji (R2, proširuje se):** `/ured/uvoz` — vrste `workers` i `equipment`;
`import-parser` (xlsx/csv); mapiranje kolona po aliasima; **pregled bez upisa**;
**potvrda u jednoj transakciji** (sve ili ništa); greške/duplikati po redu; nepoznata
kategorija mašine se ne stvara tiho; inventarska oznaka = ključ mašine; radnici bez
automatskog spajanja; audit traga; testovi parser/servis/izolacija/NUL. Demo seed ide
kroz isti servis.

**Model podataka (2c):** ostaje tenant (`companies`) + postojeće tabele radnika/mašina/
kategorija/obaveza. Proširenje vrsta uvoza (projekti, partneri) koristi iste tablice ili
minimalne FK koje model već ima. **B15 \[Rano u model\]:** (1) stacionaža — predviđena u
šemi/komentaru, 2c je **ne mora** uvoziti km+m dok nema kolone u izvornom Excelu, ali
uvoz projekata ne smije zaključati model bez dionice; (14) tok odobravanja — 2c ne gradi
workflow, samo ne uvodi polja koja bi ga kasnije blokirala; (22) SaaS/tenant — uvoz uvijek
u okviru firme (`withCompany`), valuta već na `Company`. Stavka B15.19 (onboarding/uvoz)
je upravo ovaj tok.

**Tok korisnika:** (1) otpremi Excel (sintetički/`.test` u CI; anonimizirani stvarni fajl
samo kod vlasnika); (2) izaberi vrstu; (3) mapiraj kolone; (4) pregled ishoda po redu
(ok / greška / duplikat / preskok); (5) potvrdi samo čiste odluke — potvrda piše ili
pada cijela.

**Neuredni redovi:** ostaju u izvještaju pregleda; ne upisuju se; korisnik ispravlja
Excel ili mapiranje i ponavlja. Nema djelimičnog commit-a.

**Testovi:** proširiti postojeće import testove (parser, preview, apply, izolacija tenanta,
kontrolni znakovi); fixturei samo sintetički (`.test`). E2E: jedan sretan + jedan fajl s
miješanim greškama.

**Van obima 2c:** OCR/AI čitanje (B15.18); situacije/predmjer (B15.2); GeoJSON trase;
R4b; produkcijski PII u repou; 2d.
