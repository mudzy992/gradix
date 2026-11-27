# Pilot — reset i hronološki vodič po rolama

**Ograničenje provjere:** Docker image i ovi koraci nisu izvršeni na konkretnom Coolify serveru;
vlasnik mora proći scenarije i odobriti pilot. Reset je samo za namjensku testnu bazu.

> Samo namjenska **sintetička** pilot baza. Ne unositi stvarne radnike, lozinke, priloge ili
> finansije. Pilot podaci i prijavni računi nisu za produkciju. Reset briše SVE javne tabele,
> uključujući sve firme, korisnike, platform naloge i audit trag. Provjeriti naziv i backup.

## Reset (administrator servera)

1. Napraviti i **provjeriti restore** backupa baze i objekata. Baza mora biti isključivo za pilot,
   ime baze mora sadržavati `pilot`, migracije moraju biti primijenjene. Provjeriti da URL za
   aplikaciju, migratora i pg-boss pokazuje na istu namjensku bazu. Ugasiti web i worker, onemogućiti
   promet i zakazane poslove; na svim mobilnim uređajima ukloniti stari lokalni outbox/podatke.
   Reset ne čisti S3/MinIO fajlove ni Redis; za pilot koristiti zaseban prazan bucket/prefiks.
2. Na serveru s checkoutom v2 i instaliranim zavisnostima postaviti `DATABASE_ADMIN_URL` na
   migracijskog vlasnika s BYPASSRLS/superuser pravima, a `PILOT_TEST_PASSWORD` na privremenu jaku
   lozinku od najmanje 12 znakova. Ne stavljati tajne u Git ili shell historiju. Zatim:

   ```sh
   cd v2
   pnpm db:reset:pilot --delete-all-pilot-data --confirm-db=ime_pilot_baze
   ```

   `ime_pilot_baze` zamijeniti **tačnim** imenom baze iz URL-a. Bez oba argumenta, lozinke ili ako
   se ime ne podudara, nema reseta. `BOSS_DATABASE_URL`, ako je postavljen, mora označavati istu
   bazu. Poznata `pgboss` šema se čisti od poslova, arhive i rasporeda; worker pri startu ponovo
   prijavljuje svoje rasporede. Skripta ne koristi `CASCADE`; neočekivane zavisnosti prekidaju
   transakciju. Ne pokretati dok je bilo koji proces spojen i upisuje.
3. Coolify: deployati sliku koja uključuje `/app/reset-pilot-clean.mjs`. Zaustaviti worker i
   sve druge web instance, isključiti pristup korisnicima i zakazane poslove; web terminal koristiti
   samo ako je preostali web proces potpuno miran i ne upisuje u bazu. Ako se miran rad ne može
   garantovati, zaustaviti i web i pokrenuti jednokratni kontejner iz iste slike sa istim mrežama,
   CA i varijablama. Izolovana baza i odobren restore su obavezni.

   U Coolify **web** terminalu pokrenuti `bash`, pa (zamijeniti `ime_pilot_baze` stvarnim tačnim
   imenom; to je jedini placeholder):

   ```bash
   read -rs -p 'Privremena pilot lozinka (najmanje 12 znakova): ' PILOT_TEST_PASSWORD; echo
   export PILOT_TEST_PASSWORD
   node /app/reset-pilot-clean.mjs --delete-all-pilot-data --confirm-db=ime_pilot_baze
   unset PILOT_TEST_PASSWORD
   ```

   Lozinka nije prikazana niti zapisana u historiji komandi. `DATABASE_ADMIN_URL` mora u web
   kontejneru već pokazivati na namjensku bazu, korisnik imati BYPASSRLS, a `BOSS_DATABASE_URL`
   mora odgovarati stvarnoj konfiguraciji workera i istoj bazi. Skripta ne može otkriti dodatni
   red koji joj nije prijavljen. Ako nije ista baza, prekinuti postupak. Slika se bundluje u
   Dockerfileu i ima build provjeru modula; stvarni Docker build i Coolify izvršenje nisu ovdje
   provjereni. Nakon uspjeha ukloniti lozinku, postaviti `SEED_DEMO=false`, ponovo pokrenuti web i
   worker, provjeriti `/api/health`, `/api/health/queue` i prijavu.

4. Reset je ponovljiv, ali svako novo izvršenje **opet briše sve**. Napravi novu lozinku i
   oprezno provjeri cilj. Ako izbaci grešku, transakcija se vraća; ne zaobilaziti guard.

## Računi i početna stanja

Sve role koriste lozinku koju je operator sam postavio kroz `PILOT_TEST_PASSWORD` (nije sačuvana u
repo-u niti ispisana). Emails su `vlasnik@pilot.test`, `voditelj@pilot.test`, `sef@pilot.test`,
`mehanicar@pilot.test`, `racunovodja@pilot.test`, `radnik@pilot.test`. Nema fiksnog 2FA seeda:
OWNER i ACCOUNTANT pri prvoj prijavi uparuju vlastitu TOTP aplikaciju i sigurno čuvaju recovery kodove.
Odjaviti se između rola ili koristiti odvojene privatne prozore. Svi računi imaju radnički zapis;
projekti, mašine, zalihe i promet počinju prazni. Cisterna ima kapacitet 5.000 l i stanje 0.

Parametri su **testni primjeri, ne zakonska potvrda**: teren 1500 `CENTS` = 15,00 KM/dan,
bolovanje `0.80 MULTIPLIER` = 80%; PERCENT `80` daje isto. Dodaci 1,50 prekovremeni/nedjelja/praznik,
1,30 noćni. Računovođa mora prije stvarnog obračuna provjeriti ugovor, propise i datume;
obračun MVP nije bruto-neto obračun doprinosa. Za pogrešnu jedinicu obračun blokira.

## 1. OWNER — priprema

1. Prijavi `vlasnik@pilot.test`; završi TOTP upis i zapiši recovery kodove na sigurno. Na **Pregled**
   provjeri firmu i prazne brojače. U **Postavke** provjeri Zenicu, BAM, zonu Sarajevo i radne sate.
2. U **Korisnici / Pristup i role** pregledaj šest naloga, dozvole i opseg. Ne dijeli jedan nalog.
   U **Radnici** provjeri veze sa svim nalozima; na radniku unesi važeću satnicu za test.
3. U **Mašine** dodaj bager i kamion s kategorijom i brojilom. U **Rokovi** unesi važeće
   registracije/tehničke preglede za mašine, a radniku ljekarski i obuku. U **Skladište / Dijelovi**
   dodaj filter, unesi dva prijema po različitim cijenama. U cisternu evidentiraj cjenovno poznat prijem.
4. U **Projekti** napravi aktivan projekat u drugom gradu, npr. Kakanj. Dodijeli voditelja,
   šefa, radnika i mašine za današnji datum. Pripremi budžet i fazu. Po potrebi unesi partnera,
   dobavljača i podizvođača. Odjavi se.

## 2. PROJECT_MANAGER — plan i trošak

5. Prijavi `voditelj@pilot.test`. U **Projekti** otvori dodijeljeni projekat, postavi faze i zadatke;
   provjeri radnike, mašine i datume dodjela. U **Nabavka** pripremi zahtjev, narudžbenicu i prijem;
   dodaj račun i prati stanje odobravanja. U **Tenderi** probaj nacrt i checklistu. U **Dnevnik** i
   **HSE** provjeri projektni pregled. Potvrdi da nema pristupa tuđem opsegu kada je opseg sužen.
6. Provjeri trošak projekta i budžet. Testiraj istek registracije: dodjela/tura/sati mašine se
   blokiraju prema konfiguraciji, iznimku odobrava ovlaštena rola. Sam unos goriva i radnog dana
   namjerno je dozvoljen uz upozorenje. Odjavi se.

## 3. SITE_SUPERVISOR i WORKER — teren i offline

7. Otvori mobilni klijent putem Expo Go/emulatora prema `MOBILE-EXPO-GO.md`, ali koristi gore
   navedene **pilot** račune i pilot API URL, ne stari demo. Prijavi `sef@pilot.test`. U **Grupa**
   vidi dodijeljenog radnika, evidentiraj njegov dan i sate na projektu; pošalji/potvrdi dan.
8. U **Dnevnik** dodaj zapis, količine i zastoj, provjeri automatske sekcije, potpiši i zaključaj
   ako rola ima dozvolu. U **HSE** prijavi testni incident ili toolbox i učesnika. Na telefonu
   privremeno prekini mrežu, unesi novu stavku, vrati mrežu i sačekaj sync; provjeri da nema duplikata
   i da je odbijanje/konflikt vidljiv, ne ponavljaj slanjem novog ID-a naslijepo.
9. Prijavi `radnik@pilot.test`. U **Moj dan** pokreni, pauziraj i završi testni dan; provjeri
   vlastite sate i da ne može vidjeti tuđe zarade. Po potrebi se vrati šefu da potvrdi prijavu.

## 4. MECHANIC — pregled, kvar, servis

10. Prijavi `mehanicar@pilot.test`. U **Dnevni pregled** odaberi mašinu i popuni šablon; prijavi
    kvar i prati njegov status. U **Servis** napravi/pokreni interni nalog, dodaj dio sa centralnog
    skladišta i završi ga. Uporedi stanje artikla, vrijednost izlaza, stavku naloga i ukupni trošak.
    Cijena je prosjek poznatih ulaza skladišta, ne ručno zadnja cijena; nepoznata cijena blokira izlaz.
    Odjavi se.

## 5. ACCOUNTANT — sati, korekcije i zaključavanje

11. Prijavi `racunovodja@pilot.test`, upari 2FA. U **Radnici** provjeri satnice i pod **Obračun sati**
    pregledaj parametre, njihove jedinice i periode važenja. Otvori period u kojem su potvrđeni dani,
    izračunaj i pregledaj linije/izvore; ukloni prikazane blokade. Ponovi obračun i provjeri da
    akontacija nije naplaćena dvaput. Odobri i zaključaj; ako je računovođa uključen u obračun, taj obračun mora odobriti drugi ovlašteni korisnik.
12. Izvezi XLSX/CSV, provjeri `OBRAČUN` i `RASPIS`. Nakon izmjene dana u zaključanom periodu
    otvara se korekcija u narednom periodu; na kartici radnika računovođa mora izračunati i
    potvrditi potpisani iznos i obrazloženje, potom ponovo izračunati ciljni period. Provjeri audit,
    blokadu neobrađenih korekcija, liniju i izvoz. Ne nagađati iznos samo iz razlike sati.

## 6. Izvještaji, pristup i završna kontrola

13. Kao vlasnik pregledaj **Izvještaji**, **Pregled**, troškove projekta, gorivo i izvoz; uporedi
    iznos sa izvorom. U **Audit** provjeri ko je odobrio, zaključao i potvrdio korekciju. Završi
    projekat i provjeri da timer i offline novi rad vraćaju `PROJECT_FINISHED`, da se novi troškovi
    ne knjiže na `FINISHED` i da se zaključan obračun ne preračunava. Isprobaj neovlaštene radnje u drugim rolama — moraju biti odbijene.
14. U **Profil / Sesije** pregledaj i opozovi sesiju; prijavi se ponovo TOTP-om. Dodaj passkey na
    podržanom uređaju preko HTTPS-a, odjavi se i isprobaj passkey prijavu; RP ID mora odgovarati
    javnoj domeni. Sačuvaj recovery kodove. Bez stvarnog uređaja i browsera ovo nije potvrđeno.
15. Za svaki korak zabilježi rolu, URL, datum, očekivani i stvarni rezultat, screenshot bez tajni,
    eventualni ID i prijavi regresiju. Nije dovoljno da CI bude zelen: vlasnik treba stvarno proći
    radne tokove i prihvatiti pilot.
