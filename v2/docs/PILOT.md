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

## Plan 2c — uvoz projekata (proširenje R2 uvoza)

**Status:** ODOBREN (vlasnik). Vrsta u 2c: **samo `projects`**.

**Već postoji (R2):** `/ured/uvoz` — `workers` / `equipment`; parser; mapiranje;
pregled bez upisa; potvrda u jednoj transakciji; audit; testovi. 2c dodaje `projects`.

**Model:** `projects` (r3); uvoz kroz `withCompany`. Uvoz **ne** uvodi stacionažu,
partnere ni workflow (B15 NE → R5).

### Kolone uvoza projekata (iz šeme `projects`)

| Polje | Obavezno | Aliasi (primjeri) | Napomena |
|---|---|---|---|
| `code` | da | šifra, oznaka, code | jedinstvena u firmi; 1–40 |
| `name` | da | naziv, ime, name | do 200 |
| `status` | ne | status, stanje | default ACTIVE; nepoznat → greška |
| `site_address` | ne | adresa, lokacija | do 300 |
| `site_place` | ne | mjesto, grad | do 120 |
| `starts_on` | ne | početak, datum početka | datum |
| `ends_on` | ne | kraj, završetak | ≥ početak |
| `manager` | ne | rukovodilac, voditelj | postojeći radnik (ime+prezime) |
| `note` | ne | napomena, note | do 2000 |

**Tok:** otpremi → vrsta Projekti → mapiranje → pregled → potvrda (sve ili ništa).

**Neuredni redovi:** samo u pregledu; ne upis; ispravi Excel/mapiranje.

**Testovi:** preview bez upisa; apply s greškom = 0 upisa; ista šifra u drugoj firmi
OK; izolacija tenanta; NUL/kontrolni znakovi; E2E sretan + miješane greške.

**Van obima 2c:** partneri/klijent (nema tabele; R5); stacionaža (R5); tok odobravanja
(R5/R4b); OCR; situacije; GeoJSON; R4b; 2d; PII u repou.
