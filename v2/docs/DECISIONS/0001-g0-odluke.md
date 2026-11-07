# ADR 0001 — Odluke vlasnika na kapiji G0

**Datum:** 2026-11-07 · **Status:** odobreno (vlasnik, G0)
**Kontekst:** Faza 0 je isporučila razumijevanje, nalaze i 12 pitanja. Vlasnik je odobrio G0 i odgovorio na pitanja. Ove odluke imaju prednost nad `MASTER_BRIEF.md` dok se brief ne ažurira.

## Odluke

1. **Pilot firma (P1):** 80 radnika, 40 mašina, 12 istovremenih projekata. Ključni problemi: raspored radnika; praćenje mašina (radni sati, iskorištenost, lokacije, servisi, dokumenta); gorivo. Ranije pretpostavke 40/25/5 i „12 sedmica“ se **ne koriste** za odluke.
2. **Obračun (P2):** firma ne koristi aplikaciju za obračun — sve se svodi na Excel. MVP = sati + CSV izvoz. Puni obračun (R10) nije potreban za pilot.
3. **Redoslijed (P3):** ostaje iz B11, tenderi su R7. O obračunskim situacijama se odlučuje na G2. U model od prvog dana ulaze: **stacionaže, partner, Membership, valuta uz iznos**.
4. **Domen (P4):** **jedan domen s `/api`**. Staging ide na poddomenu. Produkcijski domen ostaje na v1 do posebne odluke.
5. **Pitanja P5–P12:** prihvaćene preporuke agenta (MinIO ostaje; vlastiti tanki offline engine; Android-first; fiksne role + opseg; multi-tenant od dana 1 bez UI operatora u MVP-u; čuvanje 5 godina uz anonimizaciju; dnevnik kao interna PDF forma u R9; pilot 12 sedmica od G1).
6. **Nalazi b1–b9 i b13–b14:** prihvaćeni. **b10–b12** (tajne, grane, Coolify) rješava vlasnik; agent ne dira v1 ni Coolify.

## Izmjene Faze 1

- Mini-kapije: stani i izvijesti **poslije koraka 5** (tenant scope + RLS spike) i **poslije koraka 7** (mobilni kostur + offline spike). Bez nastavka bez riječi vlasnika.
- Spikeovi su vremenski ograničeni; ishod „ne radi“ je validan i završava ADR-om s alternativom.
- v2 smije dropati v1 bazu, Redis prefiks i bucket i koristiti ih kao stvarne. Agent isporučuje ACL komandu za `redis-cli`, ne izvršava je.
- Nijedna tajna u repou. `.env.example` nosi samo imena i opise, šema se preuzima iz `v1/.env.example`. Stvarne vrijednosti su u root `.env`.
- Dizajn: u Fazi 1 samo minimalni shell s tokenima. Dva dizajn smjera su prvi zadatak Faze 2.
- **Cursor paginacija je zadana**; offset samo za male administrativne tabele.
- Na G1 se isporučuje demo skripta (lokalno jednom komandom, staging, šta radi / šta ne).
- A6 i dalje važi. Izvještaj počinje sa: šta je gotovo, šta ne radi, šta trebam od tebe.

## Posljedice

- `Membership`, `Money` i odvojen operator platforme ulaze u prvu migraciju (ne čekaju R1).
- Sekvenca rezova se ne mijenja, ali se **težina** mijenja: mašine, gorivo i raspored radnika dobijaju više pažnje nego u B11 (R2/R5), jer su to stvarni problemi pilot firme.
- Plan od 12 sedmica više nije osnov za procjene; procjena se daje po rezu, na osnovu izmjerenog tempa.
