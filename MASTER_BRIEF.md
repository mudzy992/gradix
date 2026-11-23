# Gradix v2 — Master brief za AI agenta i projektni zadatak

Verzija 0.1 (nacrt za pregled vlasnika) · 7. novembar 2026. · Radni naziv proizvoda: Gradix

## 0. Kako se koristi ovaj dokument

Ovo je **jedini ulazni dokument** za AI agenta. Sastoji se iz dva dijela:

- **Dio A — Upute agentu:** šta agent radi, kojim redoslijedom, šta mora isporučiti prije prve linije proizvodnog koda i gdje mora stati i čekati odobrenje vlasnika.
- **Dio B — Projektni zadatak:** šta se gradi, za koga, zašto i do kojeg nivoa kvaliteta. Ovo je izvor istine za opseg. Sve što nije ovdje, ili što je ovdje označeno kao "van opsega", agent ne gradi bez pisanog odobrenja.

Prethodna verzija sistema ("v1") je zamrznuta kao arhiva i služi samo kao referenca za domenska pravila i infrastrukturne podatke navedene u odjeljku B2. Kod iz v1 se ne kopira "jer već postoji". Ako se nešto preuzima, to je svjesna odluka zapisana kao ADR.

Oznake u tekstu: **MORA** = obavezno, **TREBA** = zadano ponašanje uz opravdano odstupanje, **MOŽE** = opcionalno. Stavke označene **\[OTVORENO\]** čekaju odluku vlasnika (sabrane u B13).

---

# DIO A — UPUTE AGENTU

## A0. Granica između V1 i V2 (pročitaj prvo)

Ovaj dokument je u korijenu repozitorija (`MASTER_BRIEF.md`). Repozitorij ima **dvije potpuno izolirane cjeline**:

- `v1/` — kompletan prethodni projekat, **zamrznut i samo za čitanje**. Služi isključivo kao referenca za domenska pravila, ideje i infrastrukturne podatke iz odjeljka B2.
- `v2/` — novi projekat koji se gradi iznova. **Jedino mjesto na kojem agent piše kod i dokumentaciju.**
- Korijen repoa sadrži samo: `MASTER_BRIEF.md`, kratak `AGENTS.md` (granica verzija i pokazivač na `v2/AGENTS.md`), `README.md`, `.gitignore` i `.github/` (workflowi isključivo za v2).

Pravila granice (provjeravaju se automatski gdje je moguće):

1. **v1 se ne mijenja.** CI provjera pada ako commit dira `v1/`, osim uz izričito odobrenje vlasnika.
2. **v2 ništa ne uvozi iz v1.** Nema importa, kopiranja zavisnosti ni zajedničkih konfiguracija. Alati (lint, tsconfig, workspace, test runner) u v2 ignorišu `v1/`.
3. **Preuzimanje iz v1 je svjesno i zapisano.** Ideja ili pravilo koje se prenosi dobija napomenu `Izvor: v1/<putanja>` u specifikaciji ili ADR-u i prolazi pregled po B2.6.
4. **v2 je samostalan:** vlastiti workspace, Dockerfile-ovi, CI workflow, `.env.example`, dokumentacija i `AGENTS.md`.
5. **Imenovanje:** riječ "v2" ne ulazi u imena paketa, domene, baze ni kod (paketi su `@gradix/*`). "v2" je samo naziv foldera, da se poslije ništa ne preimenuje.
6. **Git:** prije premještanja se postavlja oznaka `v1-final`; premještanje je jedan commit s `git mv` da historija ostane čitljiva.
7. **Deploy:** automatski deploy v1 se pauzira ili usmjerava na base directory `v1/` prije premještanja. v2 ide na privremene poddomene do odluke o preuzimanju produkcijskih domena **\[OTVORENO\]**.

Ako je išta u ovom dokumentu u sukobu sa onim što agent vidi u `v1/`, **ovaj dokument ima prednost**, a razlika se prijavljuje vlasniku.

## A1. Misija i pravila igre

Tvoja misija je da, zajedno s vlasnikom, isporučiš **radni, brz, pouzdan i vizuelno kvalitetan** sistem za digitalizaciju poslovanja firme koja radi na niskogradnji. Mjerilo uspjeha nije količina dokumentacije, broj testova ni zeleni CI. Mjerilo je da **stvarni korisnik (ured, šef gradilišta, radnik, vozač, mehaničar, knjigovođa) može obaviti svoj posao brže i sigurnije nego prije**, i da to vlasnik može vidjeti i isprobati.

Pravila koja važe u cijelom projektu:

1. **Vertikalni rezovi.** Posao se isporučuje kao tanki, kompletni tokovi (baza → API → web/mobile → testovi → dizajn), a ne po slojevima. Rez je gotov tek kad ga vlasnik može proći od početka do kraja.
2. **Vlasnik je u petlji.** Poslije svakog reza slijedi demo i odobrenje. Bez odobrenja se ne počinje sljedeći rez.
3. **Dokumentacija služi kodu, ne obrnuto.** Gornja granica dokumentacije je definisana u A6. Zabranjeni su dnevnici sa CI brojevima, "ledgeri nalaza" i samoinicijativni auditi.
4. **Dizajn prije implementacije ekrana.** Nijedan ključni ekran se ne kodira dok vlasnik nije odobrio wireframe ili prototip.
5. **Nema stubova koji glume funkcionalnost.** Ako nešto nije implementirano, ne postoji u UI-ju i API-ju. (U v1 je email servis bio stub koji samo broji pozive.)
6. **Ne izmišljaj posao.** Ako zadatak nije u backlogu izvedenom iz ovog dokumenta, predloži ga vlasniku; ne radi ga.
7. **Iskreno izvještavanje.** Ako nešto nije testirano, nije dokazano ili radi "samo djelimično", to se piše jednom rečenicom na vrhu izvještaja, ne u fusnoti.

## A2. Faze rada i kapije

Agent prolazi kroz faze redom. Na kraju svake je **kapija (G)** na kojoj čeka odobrenje vlasnika.

**Faza 0 — Čitanje i pitanja (bez koda).** Pročitaj cijeli dokument. Zatim isporuči kratak dokument "Razumijevanje i pitanja" (najviše 2 stranice): šta si razumio, koje pretpostavke praviš, koje nelogičnosti ili rupe vidiš u ovom zadatku i koja pitanja trebaju odgovor prije planiranja. Pitanja iz B13 su polazna lista, ne konačna. Kapija **G0:** vlasnik odgovara na pitanja i odobrava razumijevanje.

**Faza 1 — Postavljanje projekta i agentske infrastrukture.** Postavi repozitorij, alate, pravila i skillove opisane u A3. Nema poslovne funkcionalnosti osim jednog "hodajućeg kostura" (walking skeleton): prijava korisnika, jedna zaštićena stranica, jedan API poziv, jedan zapis u bazi, jedan mobilni ekran, sve deployano na pravu infrastrukturu. Kapija **G1:** vlasnik pregleda strukturu, pravila, skillove i hodajući kostur uživo na produkcijskoj domeni.

**Faza 2 — Detaljan plan implementacije.** Isporuči plan opisan u A4: ADR-ove, model podataka, dizajn sistem, plan rezova, testnu strategiju i procjene. Kapija **G2:** vlasnik odobrava plan i redoslijed. Tek tada počinje implementacija funkcionalnosti.

**Faza 3 — Implementacija po rezovima.** Za svaki rez: kratki plan reza → wireframe/prototip (odobrenje) → implementacija → testovi → demo → odobrenje. Ciklus se ponavlja do kraja plana isporuke (B11). Kapija **G3.x** (po rezu): demo + definicija gotovosti (A3.7) ispunjena.

**Faza 4 — Stabilizacija i pilot.** Performanse, sigurnosni pregled, migracija podataka, obuka i pilot u stvarnoj firmi. Detalji u B11.

## A3. Šta agent mora napraviti u Fazi 1

### A3.1 Struktura repozitorija

Struktura `v2/` je polazna i potvrđuje se u G1. Zadano je **monorepo** (pnpm workspaces + Turborepo) s **modularnim monolitom** na backendu:

- `apps/web` — Next.js (App Router), web panel i API.
- `apps/mobile` — Expo aplikacija za teren.
- `apps/worker` — Node proces za pozadinske poslove (podsjetnici, obračuni, izvještaji, obrada slika).
- `packages/db` — Prisma šema, migracije, klijent, tenant scope.
- `packages/domain` — poslovna logika bez zavisnosti od framework-a (čisti TypeScript, najlakše se testira).
- `packages/contracts` — zod šeme, generisani OpenAPI i tipizirani klijent koji dijele web i mobilni.
- `packages/ui`, `packages/config`, `packages/i18n`, `packages/testing`.
- `infra/` (Docker, Coolify, skripte) i `docs/` (STATUS, DECISIONS, PRODUCT, PLAN).

Bilo koja složenija arhitektura (mikroservisi, event sourcing) traži ADR s jasnim opravdanjem.

### A3.2 Datoteke za vođenje agenta

Kreiraj kratke, održavane datoteke koje agent čita na početku svake sesije:

- `AGENTS.md` (ili `CLAUDE.md`): najviše \~150 linija. Sadrži: svrhu projekta u 5 rečenica, komande (pokreni, testiraj, lintaj, migriraj), strukturu repoa, ključna pravila (A3.3) i pokazivače na dublje dokumente. Ne ponavlja ono što je u kodu.
- `docs/STATUS.md`: **najviše 100 linija.** Trenutni rez, šta je gotovo, šta je sljedeće, otvorena pitanja za vlasnika. Prepisuje se, ne dopisuje.
- `docs/DECISIONS/` (ADR): jedan fajl po odluci, najviše jedna stranica, format u A3.6.
- `docs/PRODUCT/`: ovaj brief i po jedna kratka specifikacija po modulu, izvedena iz B5.

### A3.3 Pravila (rules)

Postavi ih kao strojno provjerljiva pravila gdje god je moguće (lint, testovi, pre-commit, CI), a ne samo kao tekst. Obavezna pravila:

1. **Tenant izolacija.** Svaki poslovni zapis nosi `companyId`; svaki upit je tenant-scopovan na jednom mjestu (repozitorijumski sloj ili ekstenzija ORM-a), a ne ručno u svakom servisu. Pored toga se razmatra PostgreSQL Row Level Security kao dubinska zaštita (ADR). Test koji dokazuje da firma A ne vidi podatke firme B je obavezan za svaki novi resurs, a generiše se iz definicije resursa, ne piše ručno.
2. **Novac.** Jedan zajednički tip i jedna funkcija za sve iznose (zadano: decimalni tip u bazi, string u API-ju, jedna biblioteka u kodu). Valuta je eksplicitna uz svaki iznos. Zaokruživanje je definisano jednom i testirano.
3. **Vrijeme.** Sve se čuva u UTC; poslovni datumi (dan rada, rok, period obračuna) čuvaju se kao kalendarski datum uz zonu firme (zadano `Europe/Sarajevo`). Jedan zajednički modul za rad s datumima.
4. **Greške i API ugovor.** Jedinstven oblik odgovora i zatvoren katalog kodova grešaka. **OpenAPI ugovor se generiše iz koda** i klijentski tipovi se generišu iz njega; ručno održavanje ugovora je zabranjeno.
5. **Autorizacija.** Dozvole su podaci (matrica rola × dozvola), a ne rasuti uslovi. Svaka ruta mora imati eksplicitnu deklaraciju (javna / zahtijeva dozvolu X); CI pada ako je ruta bez deklaracije.
6. **Audit trag.** Sve izmjene poslovnih podataka (ko, šta, kada, prije/poslije) bilježe se jednim mehanizmom, ne ručno u svakom modulu.
7. **Tajne.** Nikada u repou. Validacija konfiguracije pri startu (aplikacija ne starta s nepotpunom konfiguracijom).
8. **Zavisnosti.** Nova biblioteka traži kratki ADR (problem, alternative, rizik). Bez zapisa nema zavisnosti.
9. **Commit i grane.** Mali, logični commitovi; poruke po dogovorenom formatu; svaki commit prolazi lokalne provjere. Granu i način integracije definiše vlasnik u G1.
10. **Bez mrtvog koda i mrtve konfiguracije.** Ako se nešto ne koristi, briše se (u v1 su postojale Redis varijable bez korištenja).

### A3.4 Skillovi (ponovljivi radni postupci)

Za svaku vrstu ponavljanog posla agent piše kratak skill: korake, šablon, listu provjera i primjer. Minimalni skup:

- `new-resource` — dodavanje novog poslovnog resursa (migracija, model, tenant scope, dozvole, DTO, servis, ruta, audit, generisani testovi izolacije, OpenAPI).
- `db-migration` — pisanje i provjera migracije (naprijed-samo, reverzibilnost opisana, test na praznoj i popunjenoj bazi).
- `ui-screen` — izrada ekrana po dizajn sistemu (stanja: učitavanje, prazno, greška, uspjeh; tastatura; a11y; responzivnost; i18n).
- `mobile-offline-entity` — dodavanje entiteta koji radi offline (lokalna šema, red za sinhronizaciju, rješavanje konflikata, testovi prekida mreže).
- `slice-demo` — priprema demo skripte i snimaka ekrana za vlasnika.
- `write-adr` — format i kada se piše.
- `review-slice` — samoprovjera prije demoa po definiciji gotovosti (A3.7).
- `seed-data` — realistični demo podaci iz niskogradnje (ne "Test 1", "Test 2").

### A3.5 Testna infrastruktura i automatske provjere

U Fazi 1 se postavlja, a ne planira: pokretanje testova lokalno i u CI-ju, test baza, test Redis, MinIO/S3 test okruženje, E2E za web, test okvir za mobilni, generisani testovi tenant izolacije, provjera pokrivenosti ruta deklaracijama dozvola, lint, type-check, provjera tajni, provjera performansi bundlea. Strategija je u B10. CI mora biti **brz** (cilj: pregled svake promjene za manje od 10 minuta); spori paketi idu u noćni pokret.

### A3.6 Format ADR-a

Naslov, datum, status (predloženo / odobreno / zamijenjeno), kontekst (3–5 rečenica), odluka, razmotrene alternative (najviše 3), posljedice. Najviše jedna stranica. ADR se piše samo za odluke koje je teško promijeniti poslije.

### A3.7 Definicija gotovosti (Definition of Done) za rez

Rez je gotov kad su sve stavke tačne:

1. Vlasnik je prošao tok uživo na stvarnoj okolini i odobrio ga.
2. Zadovoljeni su kriteriji prihvatanja iz specifikacije modula.
3. Testovi: jedinični za logiku, integracijski za API, E2E za glavni tok, test tenant izolacije; svi prolaze, bez preskočenih testova bez zapisanog razloga.
4. Dizajn: ekrani odgovaraju odobrenom prototipu, sva stanja ekrana postoje, radi na telefonu i desktopu.
5. Pristupačnost: osnovna provjera automatskim alatom bez ozbiljnih propusta i ručna provjera tastaturom.
6. Performanse: poštovani budžeti iz B7.
7. Sigurnost: provjerene dozvole za sve role, bez novih upozorenja alata za tajne i zavisnosti.
8. Dokumentacija: ažuriran `STATUS.md`, po potrebi ADR; nema novih dokumenata mimo pravila A6.
9. Migracije i seed podaci rade na praznoj bazi.
10. Poznata ograničenja su navedena jednom rečenicom u izvještaju o rezu.

## A4. Plan implementacije (Faza 2) — šta agent isporučuje

Jedan dokument `docs/PLAN.md` (do \~15 stranica) i prateći ADR-ovi. Sadržaj:

1. **Specifikacija po modulu** (iz B5): korisničke priče, kriteriji prihvatanja, ekrani, API pregled, model podataka, dozvole, notifikacije, izvještaji, rubni slučajevi.
2. **Model podataka:** ER dijagram, ključna ograničenja i indeksi, strategija migracija i prenosa postojećih podataka iz Excela/papira.
3. **Dizajn sistem:** boje, tipografija, razmaci, komponente, ikone, pravila za tabele, forme, prazna stanja i mapu. Prototip za najmanje: prijava, dashboard, lista i detalj projekta, jedan mobilni tok.
4. **Plan rezova:** redoslijed, zavisnosti, procjena veličine, kriteriji prihvatanja i rizik za svaki rez (polazište u B11).
5. **Sinhronizacija i offline:** protokol, rješavanje konflikata po entitetu, šta je online-only i zašto.
6. **Sigurnosni model:** autentikacija, sesije, role, tenant izolacija, upload fajlova, zaštita javnih ruta, evidencija pristupa.
7. **Testna strategija** (B10) razrađena po rezovima.
8. **Operativni plan:** okoline, deploy, backup i restore (sa provjerenim restore testom), monitoring i logovi, upravljanje tajnama.
9. **Plan migracije podataka i obuke korisnika.**
10. **Registar pretpostavki i rizika.**

## A5. Način rada s vlasnikom

- Svaki izvještaj počinje sa: *šta je gotovo, šta radi, šta ne radi, šta trebam od tebe*.
- Odluke se ne donose "u hodu": ako postoji više razumnih opcija, predloži najviše tri sa preporukom i posljedicama.
- Ako vlasnik izrazi nezadovoljstvo izgledom ili ponašanjem, agent ne brani implementaciju nego traži konkretan primjer i ispravlja.
- Agent ne mijenja opseg samoinicijativno. Prijedlozi unapređenja idu u listu prijedloga (`docs/PRODUCT/PRIJEDLOZI.md`), vlasnik odlučuje.

## A6. Zabranjeno i ograničeno (lekcije iz v1)

U v1 je dokumentacija i proces narasla do veličine veće od samog koda, dok su osnovni ekrani ostali slabi, a mobilna aplikacija zapuštena. Zato:

- Ukupna dokumentacija u `docs/` ne smije preći **30 stranica** bez odobrenja vlasnika (`STATUS.md` ≤ 100 linija, ADR ≤ 1 stranica, specifikacija modula ≤ 3 stranice).
- Zabranjeno: dnevnik sa identifikatorima CI pokretanja, ledgeri nalaza, matrice sa hiljadama redova, samoinicijativni "auditi", ručno održavani spiskovi izuzetaka.
- Zabranjeno: više od jednog backloga i više od jedne liste statusa.
- Zabranjeno: proglasiti rez gotovim zbog zelenog CI-ja bez demoa vlasniku.
- Zabranjeno: "prekomjerno inženjerstvo" prije stvarne potrebe (npr. složeni protokoli replay zaštite, strogi parseri za sve moguće ulaze, hiljade kombinacija testova) bez ADR-a koji dokazuje stvarni rizik za ovaj proizvod u ovoj fazi.
- Mobilna aplikacija je **ravnopravan dio proizvoda** i ne smije biti odgođena "za kasnije" dok web ne bude savršen.

---

# DIO B — PROJEKTNI ZADATAK

## B1. Kontekst, vizija i ciljevi

### B1.1 Kontekst

Naručilac je građevinska firma koja radi **niskogradnju** (putevi, kanalizacija, vodovod, zemljani radovi, infrastruktura). Poslovanje se danas vodi kombinacijom papira, Excela, poruka i pamćenja ljudi. Posljedice: kašnjenje informacija s terena, teško praćenje troškova po projektu, propušteni rokovi (dozvole, registracije, servisi, ljekarski pregledi, tenderi), spor i podložan greškama obračun plaća i rad mašina bez prave evidencije iskorištenosti.

### B1.2 Vizija

Jedan sistem u kojem firma **vodi cijeli životni ciklus posla**: od praćenja tendera i pripreme ponude, preko izvođenja projekta, mehanizacije i radnika na terenu, do troškova, obračuna plaća i izvještaja. Podaci se unose jednom, na mjestu gdje nastaju (najčešće na terenu, s telefona), i automatski teku do svih koji ih trebaju.

### B1.3 Ciljevi i mjerila uspjeha (za pilot)

Svi ciljevi su podložni potvrdi vlasnika **\[OTVORENO\]**, ovo su prijedlozi:

1. Radnik na terenu evidentira rad, vožnju ili gorivo u **manje od 30 sekundi** i **bez internet veze**.
2. Mjesečni obračun sati i plaća priprema se u **manje od jednog sata** umjesto višednevnog posla.
3. **Nijedan** rok dozvole, registracije, osiguranja, tehničkog pregleda, ljekarskog ili sertifikata ne smije proći nezabilježen: sistem upozorava unaprijed, a ured vidi sve rokove na jednom mjestu.
4. Za svaki aktivni projekat vidi se **stvarni trošak naspram budžeta** u svakom trenutku (rad, mehanizacija, gorivo, materijal, podizvođači).
5. Za svaku mašinu vidi se **iskorištenost, troškovi po radnom satu i raspored servisa**.
6. Za svaki tender postoji evidencija od interesa do ishoda, s rokovima, dokumentacijom i konverzijom u projekat.
7. Prosječan odziv ekrana i API-ja unutar budžeta iz B7, a aplikacija je "brza" po osjećaju korisnika na prosječnom telefonu.
8. Pilot firma koristi sistem u svakodnevnom radu najmanje 4 sedmice bez povratka na papir za pokrivene tokove.

### B1.4 Šta nije cilj

Sistem **nije** računovodstveni program (glavna knjiga, PDV, finansijsko izvještavanje prema zakonu), **nije** zamjena za CAD/projektantske alate i **nije** javni portal za građane. Integracije s računovodstvom su izvoz podataka, ne zamjena (B5.13).

## B2. Šta se preuzima iz v1

Samo sljedeće, i to s provjerom, ne slijepim kopiranjem:

1. **Baza podataka:** PostgreSQL s TLS vezom; u produkciji se koristi mountani CA certifikat (`verify-ca`), a veza je definisana jednom varijablom `DATABASE_URL` koju postavlja vlasnik infrastrukture. Aplikacija pri startu provjerava vezu i certifikat i glasno pada ako nešto nedostaje.
2. **Redis:** eksterni Redis na zajedničkoj mreži (`redis_net`), TLS s CA fajlom, vlastiti ACL korisnik sa pravom samo na ključeve s prefiksom `gradix:`. Varijable: host, port (6380), korisnik, lozinka, prefiks, putanja CA. **Redis se koristi samo tamo gdje donosi vrijednost** (npr. throttling, privremeni tokeni, keš i redovi poslova) i svaka upotreba se opravdava u ADR-u. Ponašanje kad Redis nije dostupan mora biti definisano za svaku upotrebu (fail-open ili fail-closed).
3. **Domene:** web `gradix.ba101.top` i API `api.gradix.ba101.top` (dva domena, CORS i sigurnosna politika sadržaja usklađeni). \[OTVORENO\] Ostaje li ovaj raspored ili se prelazi na jedan domen s putanjom `/api`; agent predlaže u ADR-u. Posebno riješiti prikaz slika i fajlova koji zahtijevaju autorizaciju (potpisani kratkotrajni URL-ovi umjesto zaglavlja koje `<img>` ne šalje).
4. **Pohrana fajlova:** S3-kompatibilna pohrana (v1 koristi MinIO). \[OTVORENO\] potvrda da ostaje.
5. **Hosting i deploy:** Coolify i Docker. Tajne se unose isključivo kroz Coolify, nikada u repo.
6. **Poslovna pravila iz v1** (`docs/BACKEND.md` §4, `docs/DECISIONS.md`) koriste se kao ulaz za razgovor s vlasnikom. Agent ih prolazi, svako pravilo označava kao *preuzeto / izmijenjeno / odbačeno* i obrazlaže. Neprovjerena pravila se ne smatraju obavezujućim.

Sve ostalo (kod, šema, dizajn, testovi, CI skripte) se projektuje iznova. Agent smije čitati v1 kod radi razumijevanja domena, ali ne smije prenijeti arhitektonske odluke bez ADR-a.

## B3. Korisnici i role

### B3.1 Persone

- **Vlasnik/direktor:** želi pregled cijele firme, troškova, rokova i rizika; rijetko unosi podatke; koristi telefon i desktop.
- **Administrator/ured:** unosi i održava šifarnike, projekte, tendere, dokumenta i dozvole; radi na desktopu cijeli dan.
- **Voditelj projekta (PM):** planira projekat, prati troškove i napredak, dodjeljuje ljude i mašine.
- **Šef gradilišta/poslovođa:** radi na terenu, dnevna evidencija, raspoređivanje radnika i mašina, HSE; telefon, često loš signal.
- **Radnik:** evidentira rad i prisustvo, vidi svoje zadatke; telefon, rukavice, sunce, minimalna pismenost u tehnologiji; ekrani moraju biti krupni i jednostavni.
- **Vozač:** ture, količine, gorivo, vozilo; telefon u kabini.
- **Rukovalac mašine:** radni sati mašine, kvarovi, dnevni pregled; telefon.
- **Mehaničar:** servisni nalozi, rezervni dijelovi, kvarovi.
- **Računovođa/finansije:** obračun plaća, troškovi, izvozi, kontrola; desktop.
- **Operator platforme (tehnički administrator instalacije):** nije korisnik firme; upravlja firmama (tenant), ne vidi poslovne podatke bez izričitog, evidentiranog pristupa.

### B3.2 Model rola i dozvola

- Korisnik može imati **više rola** (efektivne dozvole su unija).
- Dozvole su finozrnate (npr. `projects.read`, `payroll.approve`, `machines.write`), a role su paketi dozvola. Matrica je podatak koji vlasnik može pregledati u aplikaciji, a firma može prilagoditi role unutar granica koje definiše platforma **\[OTVORENO\]**.
- Pristup podacima ima i **opseg**: cijela firma, dodijeljeni projekti ili samo vlastiti podaci.
- Osjetljivi podaci (plate, lični podaci, ljekarski nalazi) imaju zasebne dozvole i dodatni audit pristupa.
- Sistem **MORA** podržati jedan korisnik → jedna firma u prvoj verziji; arhitektura ne smije onemogućiti kasnije članstvo u više firmi (npr. vanjski računovođa) **\[OTVORENO\]**.

## B4. Opseg i prioriteti

Prioritet po metodi MoSCoW. Konačnu podjelu potvrđuje vlasnik u G0.

**MVP (mora, prvi pilot):**

- Firme, korisnici, role, prijava, audit.
- Projekti (faze, budžet, tim, dokumenti, troškovi).
- Radnici i evidencija radnog vremena (web + mobilni, offline).
- Mehanizacija: evidencija mašina i vozila, dodjela, radni sati, ture, gorivo.
- Rokovi i obaveze: dozvole, registracije, osiguranja, ljekarski, sertifikati, sa upozorenjima.
- Dokumenti (pohrana, kategorije, verzije, rokovi).
- Obračun sati i plaća (prvo: obračun sati i priprema za isplatu; puni obračun uz potvrdu računovođe).
- Dashboard za vlasnika i PM.

**Treba (v1.1):**

- Tenderi i priprema ponude.
- Servis i održavanje mašina (preventivni plan, nalozi, rezervni dijelovi).
- Dnevnik građenja i HSE (incidenti, obuke, inspekcije).
- Skladište, dobavljači, nabavka.
- Izvještaji i izvozi.

**Može (v2):**

- GPS telematika i IoT integracije, automatsko prisustvo na lokaciji.
- Predmjer i obračunske situacije s uporedbom ponuđeno / izvedeno.
- Javni profil firme.
- Push i email obavještenja punog obima.
- Integracija s računovodstvenim programom.

**Van opsega (dok vlasnik ne odluči drugačije):** glavna knjiga i PDV, e-fakturisanje, CAD/BIM, javni portal za građane, upravljanje ljudskim resursima izvan evidencije koja je potrebna za rad i obračun (npr. regrutacija).

## B5. Funkcionalni moduli

Za svaki modul su navedeni cilj, glavni sadržaj i kriteriji prihvatanja na nivou koji agent razrađuje u specifikaciju modula (A4). Spisak je namjerno detaljan da agent ne mora pogađati, ali nije zamrznut: agent u G0/G2 predlaže dopune.

### B5.1 Firme, korisnici, role (temelj)

- Firma (tenant) s osnovnim podacima: naziv, identifikacioni i PDV broj, adresa, kontakt, logo, zona (`Europe/Sarajevo`), valuta, jezik.
- Korisnici: pozivanje emailom ili kreiranje od administratora, prva prijava s obaveznom promjenom lozinke, resetovanje lozinke, deaktivacija (nikad brisanje korisnika koji ima historiju).
- Prijava: email/lozinka; **MOŽE** dvofaktorska za administratore i finansije. Sesije se mogu pregledati i opozvati. Jednostavan, siguran model sesija (ADR); izbjegavati nepotrebno kompleksne mehanizme.
- Matrica rola i dozvola vidljiva u aplikaciji.
- Audit trag pregledan u UI-ju (filtri: korisnik, resurs, vrijeme).
- Postavke firme: radno vrijeme, praznici, pravila prekovremenog, jedinice, kategorije, predlošci.

Kriterij: novi korisnik se može pozvati, prijaviti i vidi samo ono što mu rola dozvoljava; test dokazuje da ne vidi podatke druge firme.

### B5.2 Projekti

**Cilj:** jedno mjesto za sve o jednom gradilištu.

- Podaci: šifra, naziv, naručilac/investitor, lokacija (adresa + koordinate + mapa), ugovorena vrijednost, rokovi (početak, plan završetka), status (priprema, aktivan, pauziran, završen, arhiviran), odgovorni PM i šef gradilišta.
- **Faze** projekta s planiranim i stvarnim datumima, procentom završenosti i zavisnostima.
- **Budžet** po kategorijama (rad, mehanizacija, gorivo, materijal, podizvođači, ostalo) naspram stvarnih troškova koji se **automatski** sabiraju iz drugih modula (radni sati, rad mašina, gorivo, nabavka) i ručnih troškova.
- **Tim i resursi** dodijeljeni projektu (radnici, mašine, vozila) s periodima dodjele.
- **Zadaci** (dodjela, rok, prioritet, status, komentari, prilozi).
- **Predmjer i količine** (stavke, planirano / izvedeno), aneksi i promjene ugovora s evidencijom uticaja na vrijednost i rok.
- **Dokumenti projekta** (ugovor, projekt, dozvola za građenje, zapisnici, situacije, fotografije) s kategorijama i verzijama.
- Pregled stanja projekta: trošak naspram budžeta, napredak naspram plana, rizici (prekoračenje budžeta, kašnjenje, istek dozvola vezanih za projekat).

Kriteriji: PM kreira projekat s fazama i budžetom; kad radnik zatvori radni dan, a vozač upiše gorivo, trošak se vidi na projektu bez ručnog unosa; prekoračenje praga budžeta (npr. 80%/100%) šalje upozorenje.

### B5.3 Tenderi

**Cilj:** ni jedan tender ne smije promaknuti, svaka ponuda ima ishod i učenje.

- Evidencija: izvor/portal, naručilac, predmet, procijenjena vrijednost, rok za dostavu, rok za pitanja, status.
- Tok: `Prilika → Odluka o učešću → Priprema → Predano → Ocjenjivanje → Dobijeno | Izgubljeno | Povučeno | Poništeno`. Pravila prelaza su eksplicitna; zabranjeno je "preskakanje" bez razloga.
- **Tenderska dokumentacija** po kontrolnoj listi (uvjerenja, garancije, referentne liste, kvalifikacije kadra i mašina) s rokovima važnosti; sistem upozorava da potrebni dokument ode prije roka dostave.
- **Garancije** (ponudbena, za dobro izvršenje) s iznosom, bankom i rokovima.
- **Kalkulacija ponude:** stavke predmjera, jedinične cijene, resursi; mogućnost kopiranja iz sličnog ranijeg tendera.
- **Ishod:** razlog gubitka, cijena pobjednika (ako je poznata), evidencija za buduće ponude.
- **Konverzija u projekat** jednim klikom, bez gubitka podataka (predmjer, dokumenti, tim), atomski.
- Kalendar rokova i podsjetnici (npr. 14/7/3/1 dan).
- Izvještaj: uspješnost ponuda, vrijednost u toku, ponude po naručiocu.

### B5.4 Dokumenti i evidencija dozvola, licenci i rokova

**Ovo je jedan od najvažnijih unapređenja.** Umjesto zasebnih mehanizama za dokumente, registracije, ljekarske i sertifikate, uvodi se **jedan univerzalni mehanizam "obaveza s rokom"** koji se veže za bilo koji entitet (firma, projekat, radnik, mašina, vozilo, tender).

Tipovi (kategorije su podaci koje firma može proširivati):

- **Firma:** registracija, ovlaštenja i licence za izvođenje radova, certifikati sistema upravljanja, osiguranja odgovornosti, potvrde o izmirenim obavezama, bonitetne potvrde.
- **Projekat:** građevinska dozvola / odobrenje za građenje, saglasnosti, dozvole za zauzimanje javne površine i obustavu saobraćaja, okolišne saglasnosti, dozvole za vanredni prijevoz, elaborat HSE i plan organizacije gradilišta, tehnički prijem.
- **Radnik:** ljekarski pregled, obuka iz zaštite na radu, obuka za rad na visini / u iskopu / u skučenom prostoru, ovlaštenje za rukovanje mašinom, vozačka dozvola (kategorije), certifikat za opasnu robu ako je potreban, protivpožarna obuka, prva pomoć.
- **Mašina/vozilo:** registracija, tehnički pregled, osiguranje, tahograf/kalibracija, atest dizalice i ostale periodične ispravke, vatrogasni aparat, garancija.

Zajednička pravila:

- Svaka obaveza ima: tip, entitet, broj dokumenta, izdavač, datum izdavanja, **datum isteka**, prilog (sken/PDF), odgovorna osoba, status (važeće, uskoro istječe, isteklo, zamijenjeno).
- **Podsjetnici** s pragovima prema tipu (npr. 60/30/15/7 dana), kanali (u aplikaciji, email, push) i eskalacija odgovornoj osobi i ured u ako se ne reaguje.
- **Blokade s razlogom:** radnik s isteklim ovlaštenjem za mašinu **ne može biti dodijeljen** toj mašini; vozilo s isteklom registracijom ili tehničkim pregledom ne može dobiti turu; sve uz mogućnost evidentirane iznimke koju odobrava ovlašteno lice **\[OTVORENO\]**.
- Jedan pregled "Rokovi" za cijelu firmu s filtrima: ko, šta, kad, ozbiljnost.
- Obnova stvara novu verziju, a stara ostaje u historiji.
- Dokumenti: kategorije, verzije, pretraga po nazivu/tagu/entitetu, pregled u pregledniku, ograničena veličina i tipovi, provjera tipa po sadržaju, zaštitu pristupa (nema trajnih javnih linkova).

Kriterij: unosom jedne dozvole sa rokom, sistem u pravo vrijeme upozorava odgovorne; istekla obaveza je jasno vidljiva na kartici entiteta i u pregledu rokova.

### B5.5 Radnici (evidencija osoblja)

- Profil: osnovni podaci, kontakt, radno mjesto, vrsta angažmana (stalno, određeno, sezonski, ugovor), datum zasnivanja i prestanka, odjel/ekipa, nadređeni, fotografija. Osjetljivi podaci (JMBG, adresa, bankovni račun) imaju zasebnu dozvolu i audit pristupa.
- Kvalifikacije: zanimanje, stručna sprema, ovlaštenja (preko mehanizma B5.4).
- Evidencija izostanaka: godišnji odmor, bolovanje, plaćeno/neplaćeno odsustvo, praznici; saldo godišnjeg odmora.
- Zaduženja: lična zaštitna oprema i alati s datumom izdavanja i povrata.
- Dodjela projektima i ekipama; istorija.
- Satnica / koeficijent i dodaci: istorija promjena s datumom važenja (ne prepisuje se).
- Povezanost sa korisničkim nalogom (nije svaki radnik korisnik aplikacije, a nije svaki korisnik radnik).

### B5.6 Evidencija radnog vremena i prisustva

- **Radni dan** radnika: početak, pauze, kraj, projekat/faza/zadatak, mašina koju je koristio. Pokretanje jednim dodirom na mobilnom (offline), a ured može unijeti ili ispraviti uz obavezan razlog.
- Razlika između **evidentiranog rada** (to što radnik/šef potvrdi) i **procjene prisustva po GPS-u** (informacija za nadzor, ne osnova za plaćanje). Ne miješati ova dva pojma.
- Odobravanje: šef gradilišta potvrđuje dnevne zapise svoje ekipe; PM ili ured odobravaju sedmično/mjesečno. Zapis ima status: `nacrt → predano → odobreno → zaključano za obračun`. Zaključani zapisi se mijenjaju samo kroz evidentiranu ispravku.
- Pravila automatskog zatvaranja zaboravljenog radnog dana su jasna, vidljiva i ispravljiva (ne "tiho" zatvaranje nakon 12 sati).
- Grupni unos: šef unosi prisustvo cijele ekipe za dan jednim ekranom.
- Kontrole: preklapanja, zapis duži od dozvoljenog, rad na projektu na koji radnik nije dodijeljen — upozorenje, ne tiha blokada.

### B5.7 Obračun plaća

**Napomena:** zakonski propisi o plaćama, doprinosima, porezima i naknadama razlikuju se po entitetima (FBiH, RS, Brčko) i mijenjaju se. Ovaj modul se **ne smije pisati prema pretpostavkama agenta**. Parametre i formule potvrđuje računovođa firme, a svi propisani parametri su konfigurabilni podaci s datumom važenja.

Faze:

1. **Faza 1 (MVP): obračun sati i bruto osnove.** Od odobrenih radnih zapisa nastaje mjesečni obračun po radniku: redovni sati, prekovremeni, noćni, rad nedjeljom/praznikom, odsustva, terenski dodaci, akontacije i pozajmice. Izvoz u Excel/CSV u formatu koji računovodstvo može uvesti.
2. **Faza 2: puni obračun** bruto → neto (doprinosi, porezi, olakšice prema parametrima), platni listić (PDF) po radniku, zbirni izvještaj za firmu i uplatni nalozi. Tek nakon pisane potvrde modela od računovođe i probnog paralelnog obračuna na stvarnim podacima.

Pravila:

- Plata se računa iz **istorijskih parametara** (satnica važila na dan rada), ne iz trenutnih.
- Obračun je **ponovljiv i objasnjiv**: za svaki iznos može se otvoriti raspis (koji zapisi, koji parametar).
- Radnik ne vidi tuđe plate; PM/šef ne odobravaju vlastiti obračun.
- Obračun se zaključuje; ispravka nakon zaključavanja ide kroz korektivni obračun, ne prepisivanje.
- Trošak rada se automatski knjiži na projekte prema stvarno provedenim satima.

### B5.8 Mehanizacija: mašine i vozila

**Cilj:** znati gdje je koja mašina, ko je koristi, koliko radi, šta košta i kada treba servis.

- **Evidencija:** kategorije (kamioni, bageri, utovarivači, valjci, buldožeri, grejderi, finišeri, miksetri/čršta, kompresori, agregati, prikolice, putnička vozila, ostalo, kao podatak koji firma proširuje), proizvođač, model, serijski/šasijski broj, godina, registarska oznaka, nabavna vrijednost, vlasništvo (vlastita / lizing / najam), brojilo (radni sati ili kilometri), nosivost/kapacitet, gorivo, interna šifra.
- **Dodjela:** projektu, lokaciji i rukovaocu s periodima; sprječavanje dvostruke dodjele; kalendar zauzetosti.
- **Radni sati mašine** (iz dnevnog zapisa rukovaoca ili brojila): stvarni rad, stanje, praznohodno, kvar. Iz njih proizlaze **iskorištenost** i **trošak po radnom satu** (amortizacija, gorivo, servis, rukovalac, osiguranje/registracija).
- **Ture (kamioni):** polazište, odredište, materijal, količina (m3/t), vaga, broj tura po danu, vozač. Zapisi iz sinhronizacije su nepromjenjivi, ispravke idu kroz evidentiranu korekciju (princip iz v1 se zadržava).
- **Gorivo:** točenje (litara, cijena, odometar/radni sati, lokacija, vozač), prosječna potrošnja po mašini, upozorenje na odstupanje (moguća krađa/kvar). Izvor istine za gorivo je **jedan** (zapis točenja); rezervoar/cisterna na skladištu se obračunava iz istog izvora, a ne iz dva paralelna evidentiranja.
- **Dnevni pregled mašine** (check-lista prije rada) s fotografijom i prijavom kvara.
- **Kvarovi i zastoji:** prijava s terena, prioritet, povezivanje sa servisnim nalogom, vrijeme zastoja.
- **Rokovi** (registracija, tehnički, osiguranje, atesti) preko B5.4.
- **GPS/telematika (v2):** lokacija, radni sati, geofence; integracije kao zasebni adapteri.

### B5.9 Servis i održavanje

- Plan preventivnog održavanja po satima/kilometrima/datumu (npr. zamjena ulja svakih X radnih sati) s automatskim nalozima.
- Servisni nalog: prijava → dijagnoza → odobrenje troška → u radu → završeno; vanjski ili interni servis, utrošeni dijelovi (veza prema skladištu), sati rada mehaničara, trošak.
- Historija servisa po mašini, ukupni trošak održavanja, pouzdanost (učestalost kvarova).
- Trošak servisa se **automatski** računa u trošak mašine i, ako je primjenjivo, projekta.

### B5.10 Dnevnik građenja i HSE

- **Dnevnik:** dnevni zapis po projektu (vrijeme/vremenski uslovi, radnici, mašine, izvedeni radovi, količine, posebni događaji, fotografije), potpis šefa, izvoz u PDF u zakonski prihvatljivom obliku \[OTVORENO: potvrditi šablon\]. Zaključavanje dana.
- **HSE:** prijava incidenta i skoro-nesreće (opis, fotografije, lokacija, šta je učinjeno), istraga i korektivne mjere s rokovima i odgovornima, evidencija obuka i toolbox razgovora, inspekcije, statistika (LTIFR i slično, ako vlasnik želi).
- **Prijava incidenta mora raditi offline** (u v1 je bila samo online, što je na terenu nepraktično). Fotografije se šalju kad se vrati veza.

### B5.11 Skladište, nabavka, dobavljači i podizvođači

- Partneri: dobavljači, podizvođači, naručioci (jedan model "partner" s ulogama).
- Skladišta (centralno, na gradilištu, cisterna), artikli, jedinice, minimalne zalihe, ulazi/izlazi/prenosi, popis.
- Zahtjev za nabavku → odobrenje → narudžbenica → prijem → račun; trošak se vezuje za projekat.
- Ugovori s podizvođačima i obračun izvedenih radova.
- Troškovi (ručni unos s prilogom računa), kategorije, odobravanje, **idempotentan unos** (dupli dodir ne stvara dupli trošak).

### B5.12 Dashboard, izvještaji i obavještenja

- **Dashboard po roli:** vlasnik (novac, rizici, rokovi, aktivni projekti, iskorištenost mehanizacije), PM (njegovi projekti, budžet, rokovi, zadaci), šef gradilišta (današnji plan, ekipa, mašine, otvoreni problemi), računovođa (obračuni za zatvaranje, troškovi za odobrenje).
- Svaki prikaz odgovara na pitanje "šta moram danas uraditi?" prije "koliko ima ukupno". Stavke koje traže akciju su prve.
- Izvještaji (PDF/Excel): trošak po projektu, iskorištenost i trošak mašina, potrošnja goriva, radni sati po radniku/projektu, rokovi i isteci, tenderi, HSE.
- Obavještenja: u aplikaciji, push (mobilni), email; korisnik bira kanale; sve poruke imaju jasan uzrok i direktnu vezu na ekran na kojem se rješava.
- Globalna pretraga i brza navigacija (tastaturom na desktopu).

### B5.13 Izvozi i integracije

- Izvoz u Excel/CSV/PDF iz svih listi i izvještaja.
- Uvoz početnih podataka iz Excela (radnici, mašine, projekti, partneri) uz pregled grešaka prije potvrde.
- Izvoz za računovodstvo (plaće, troškovi) u dogovorenom formatu.
- Otvoren REST API za buduće integracije (v2).

### B5.14 Mobilna aplikacija (teren)

**Zahtjevi:** radi **offline-first**, brza, krupni elementi, jednostavan tok za svaku rolu, jedan dodir do glavne akcije.

- Ekrani po roli: radnik (početak/kraj rada, zadaci), šef (ekipa, dnevni zapis, HSE), vozač (ture, gorivo), rukovalac (radni sati, pregled mašine, kvar), mehaničar (nalozi).
- Lokalna baza, red za sinhronizaciju, jasan indikator stanja ("sve poslano" / "3 čeka slanje"), rješavanje konflikata po entitetu definisano u planu (A4).
- Fotografije i prilozi sa kompresijom i slanjem u pozadini.
- Sigurno čuvanje pristupa, odjava na daljinu.
- Podrška za Android kao prioritet; iOS **\[OTVORENO\]**.
- Distribucija: interni build/OTA izdanja od prvog reza (ne na kraju projekta). Mobilni nije "opcionalna faza".

---

## B6. Unapređenja, nelogičnosti i ispravke u odnosu na v1

Ovo je lista problema uočenih pri pregledu v1 i odluka koje se prenose u v2. Agent ih pokriva u planu i javlja ako se ne slaže.

**Proces i proizvod**

1. **Dokumentacija je prerasla proizvod.** Riješeno pravilima A6 i definicijom gotovosti koja uključuje demo.
2. **Mobilna aplikacija je zaustavljena, a web dobio sav fokus.** v2 ih gradi paralelno kroz iste rezove.
3. **Izgled je ocijenjen slabim (6/10) i radi se naknadno.** v2 počinje dizajn sistemom i prototipom odobrenim prije implementacije.
4. **Dashboard je prikazivao brojke bez akcije** (prazna mapa, jedan događaj). v2 prvo prikazuje "šta traži pažnju".

**Model i poslovna logika**

5. **Razdvojeni mehanizmi za dokumente, servis, registraciju i ovlaštenja.** v2 uvodi jedan mehanizam obaveza s rokom (B5.4).
6. **Isplata iz timer minuta** bez prekovremenog, noćnog, praznika, odsustava, akontacija. v2 pravi pravi model radnog vremena i obračuna (B5.6, B5.7).
7. **"Prisustvo" kao procjena iz GPS-a** pomiješano s evidencijom rada. v2 ih razdvaja.
8. **Tihi auto-close timera nakon 12 sati.** v2 koristi vidljivo pravilo i ispravku.
9. **Gorivo ne skida cisternu automatski**, pa postoje dva paralelna "izvora istine". v2 ima jedan izvor.
10. **Ture i gorivo su nepromjenjivi, ispravke kroz Amendment.** Princip je dobar; v2 ga zadržava, ali s jasnim UI-jem za ispravku i razlogom.
11. **HSE je online-only.** v2 ga radi offline.
12. **Jedan korisnik = jedna firma.** Prihvata se za MVP, ali model ne smije biti prepreka za vanjskog računovođu s više firmi.
13. **Email servis je stub.** v2 implementira stvarno slanje ili ga ne uvodi.
14. **Javni profil firme** nije jezgro poslovanja i prebacuje se u v2.
15. **Pravila prisutna samo u tekstu** (npr. "svaka ruta ima auth pravilo") postaju automatske provjere.

**Tehničko**

16. **Prekomjerno složen sistem sesija** (replay zaštita sa više tajni, generacije, porodice tokena). Vratiti se na jednostavan, provjeren model (ADR).
17. **Ručno održavan OpenAPI s hiljadama izuzetaka.** Generisanje iz koda.
18. **Novac i decimale:** više različitih parsera i skala. Jedan Money tip.
19. **Redis konfiguracija bez korištenja** u dijelu v1. Svaka upotreba ima ADR.
20. **Slike i fajlovi traže Authorization zaglavlje**, koje `<img>` ne šalje. Potpisani URL-ovi.
21. **Mrtva dark tema u CSS-u.** Odluka: ili puna podrška tamnoj temi (korisno za rad u kabini i noću) ili uklonjena.
22. **Spori i nepouzdani testovi** (povremeni padovi bez objašnjenja). CI mora biti determinističan; "flaky" test se popravlja ili uklanja, ne ignoriše.

---

## B7. Nefunkcionalni zahtjevi

Budžeti su polazna vrijednost; agent ih mjeri od prvog reza i prijavljuje odstupanja.

**Performanse**

- Web: prvi sadržaj (LCP) ≤ 2,5 s na prosječnoj vezi i srednjem laptopu; interakcije ≤ 100 ms za lokalne akcije; početni JS bundle ≤ 250 KB (gzip) za prijavljenu ljusku, ostalo se učitava po rutama.
- API: p95 ≤ 300 ms za uobičajene upite i ≤ 1 s za izvještaje; liste su uvijek paginirane (cursor); nema N+1 upita (provjera u testovima).
- Mobilni: hladan start ≤ 3 s na srednjem Android uređaju; zapis radnog vremena trenutan (lokalno), sinhronizacija u pozadini.
- Baza: indeksi prema stvarnim upitima; plan upita provjeren za velike tabele (GPS, zapisi rada, audit).

**Pouzdanost**

- Dostupnost cilj 99,5% (radno vrijeme prioritet); automatski backup baze i fajlova, **restore test** barem kvartalno; migracije su sigurne za izvršenje u produkciji bez zastoja gdje je izvodljivo.
- Idempotentne operacije za sve unose koje mobilni može ponoviti (zapis rada, tura, gorivo, trošak).

**Sigurnost**

- OWASP ASVS nivo 2 kao orijentir; zaštita od uobičajenih napada (XSS, CSRF gdje je primjenjivo, injekcije, IDOR, nesigurni upload); ograničenje učestalosti zahtjeva; sigurnosna zaglavlja i CSP.
- Tenant izolacija dokazana testovima i dubinskom zaštitom na nivou baze (ADR o RLS).
- Osjetljivi podaci šifrovani u mirovanju gdje je to izvodljivo; evidencija pristupa osjetljivim podacima; lozinke Argon2id ili ekvivalent.
- Zaštita podataka: usklađenost s primjenjivim propisima o zaštiti ličnih podataka u BiH i EU gdje je primjenjivo; pravila čuvanja i brisanja definisati sa vlasnikom **\[OTVORENO\]**.

**Upotrebljivost i pristupačnost**

- Web: WCAG 2.2 AA orijentir, potpuna navigacija tastaturom, dovoljan kontrast, jasna stanja greške.
- Mobilni: velike površine za dodir (≥ 48 dp), kontrast za rad na suncu, minimalan unos teksta (izbori, brojevi, glasovni unos gdje je prikladno).
- Jezik: bosanski (primarni), engleski; lokalizacija datuma, brojeva i valute; spremnost za srpski/hrvatski varijante teksta.

**Održivost**

- Strogi TypeScript, lint, formatiranje; modularne granice provjerene alatom; pokrivenost testovima po pragovima (B10).
- Logovi su strukturisani i nikad ne sadrže tajne ni lične podatke; metrike i upozorenja za produkciju.

---

## B8. Arhitektura: polazne odluke i ADR kandidati

**Stack je odlučen (vlasnik):** Next.js, TypeScript (strict), PostgreSQL, Prisma, Tailwind CSS; mobilni isključivo **Expo**. Sve ostalo ispod su polazne preporuke koje agent potvrđuje ili osporava kroz ADR u Fazi 1/2. Agent ne mijenja odlučeni stack bez pisanog odobrenja.

- **Jedan API za web i mobilni (najvažnija odluka).** Poslovna logika živi u `packages/domain` servisima i izlaže se kroz **jedan tipizirani HTTP API** (npr. Hono ili route handleri u Next.js, sa zod šemama i OpenAPI-jem generisanim iz koda). Web i mobilni koriste isti klijent. Server Actions su dozvoljeni samo kao tanki web-specifični omotači istih servisa; Expo ih ne može koristiti. Razlog: offline sinhronizacija, mobilne verzije koje ostaju instalirane mjesecima i buduće integracije traže stabilan, verzionisan ugovor.
- **Next.js kao dugotrajan Node proces, ne serverless** (`output: standalone`, Docker, Coolify). Keširanje (Next cache, RSC, `fetch`) **nikad** ne smije miješati podatke različitih firmi: tenant podaci se ne keširaju na serveru osim ako ključ nosi `companyId`.
- **PostgreSQL + Prisma:** migracije samo naprijed, tenant scope kroz klijentsku ekstenziju, RLS kao dubinska zaštita (npr. `SET LOCAL app.company_id` u transakciji). **Spike u Fazi 1** mora dokazati da to radi s connection poolom i Prisma driver adapterom prije nego se na tome gradi.
- **Autentikacija:** ne pisati vlastiti sistem; evaluirati provjerenu biblioteku koja podržava cookie sesije za web i token za Expo (npr. Better Auth ili Auth.js), uz jednostavan model sesija. ADR.
- **Pozadinski poslovi:** `apps/worker`; red poslova na Redisu (BullMQ) ili na Postgresu (pg-boss). ADR, uz opravdanje korištenja Redisa.
- **Realtime:** za MVP SSE ili polling; WebSocket tek ako ADR dokaže potrebu (Next.js ne hostuje WebSocket dobro).
- **Web UI:** Tailwind CSS, komponente nad Radix primitivima (shadcn/ui kao polazište, ali vlastiti tokeni dizajn sistema), TanStack Query i Table, react-hook-form + zod, next-intl.
- **Mobilni:** Expo (aktuelni SDK), expo-router, expo-sqlite; stilizacija sa NativeWind-om (isti tokeni kao web) ili bez, ADR; EAS Build i EAS Update **od R0**. Sinhronizacija: *graditi vlastiti engine* ili *evaluirati gotovo rješenje* (npr. PowerSync, WatermelonDB) odlučuje se kroz ADR **nakon spikea u Fazi 2**, jer je to najrizičniji dio sistema.
- **Pohrana fajlova:** S3-kompatibilna, potpisani URL-ovi, kompresija slika.
- **Observability:** strukturirani logovi (pino), Sentry ili ekvivalent za web/worker/mobilni, health i readiness, osnovne metrike.
- **Okoline:** lokalno jednom komandom (docker compose: Postgres, Redis, S3), CI, staging (preporučeno zbog pilota), produkcija.
- **Testovi:** Vitest, Testcontainers (prava PostgreSQL baza), Playwright, Maestro za mobilni.

ADR kandidati za Fazu 1/2: struktura repoa; model sesija; tenant izolacija (aplikacijski scope + RLS); Money i datumi; offline sinhronizacija i konflikti; generisanje API ugovora; model dozvola; mehanizam rokova i obavještenja; pozadinski poslovi; domene i fajlovi; mobilna distribucija; tema (svijetla/tamna).

---

## B9. UX i dizajn

- Izgled mora djelovati **moderno, mirno i profesionalno**, bez generičkog "admin template" dojma. Agent predlaže 2 smjera (paleta, tipografija, ton) sa primjerima na stvarnim ekranima; vlasnik bira.
- **Dizajn sistem** (tokeni, komponente, pravila) i njegov dokumentirani katalog komponenti.
- **Gusti, ali čitljivi** ekrani za ured (tabele s filtrima, spremljenim pogledima, grupnim akcijama, izvozom); **krupni, jednostavni** ekrani za teren.
- Svaki ekran ima: stanje učitavanja (skeleton), prazno stanje s akcijom, stanje greške s oporavkom, potvrdu uspjeha, prilagođavanje malim ekranima.
- Jezik poruka: jasan, kratak, bez tehničkog žargona; greške govore šta uraditi.
- Pokretanje glavnih akcija bez više od 2–3 koraka; tastaturske prečice u uredu; brza pretraga.
- Podaci u demu su realistični (stvarne vrste mašina, projekata, imena lokacija).
- Svaki rez ima snimke ekrana (svijetlo/tamno ako se podržava, telefon/desktop) za odobrenje vlasnika.

---

## B10. Strategija testiranja

Cilj: **povjerenje u promjenu uz mali trošak**, ne brojke radi brojki.

- **Jedinični testovi** za poslovnu logiku (obračun sati, budžet, pravila rokova, sinhronizacija, Money, datumi). Brzi, bez baze.
- **Integracijski testovi API-ja** na pravoj PostgreSQL bazi (kontejner): ugovor, validacija, dozvole po roli, transakcije, idempotentnost.
- **Tenant izolacija:** generisani testovi iz definicije resursa; svaki novi resurs ih dobija automatski.
- **E2E web** (Playwright) za glavne tokove: prijava, kreiranje projekta, dodjela, unos rada, obračun, rokovi. Mali broj, stabilni, brzi.
- **Mobilni:** jedinični/komponentni testovi i E2E tokovi (npr. Maestro) za offline scenarije: rad bez veze, prekid mreže tokom slanja, konflikti, ponovno slanje.
- **Vizuelni i a11y:** snimci ključnih ekrana i automatska provjera pristupačnosti.
- **Performanse:** provjera budžeta bundlea u CI-ju; mjerenja LCP i API p95 na seed podacima srednje veličine (npr. 50 projekata, 300 radnika, 100 mašina, 2 godine zapisa).
- **Sigurnosne provjere:** tajne, zavisnosti, osnovni DAST na staging okolini prije pilota.
- **Podaci za testove:** fabrike i seed, ne ručno popunjavanje.
- **Pravila:** nema "flaky" testova; pad bez objašnjenja se ne ignoriše. Pragovi pokrivenosti rastu postepeno i primjenjuju se na novi kod; ne troši se vrijeme na već zadovoljavajuće dijelove.
- Ono što ne može biti automatizovano (npr. pravi uređaj na terenu bez signala) ima **ručni scenarij** u demu reza.

---

## B11. Plan isporuke (polazna sekvenca)

Agent ovo razrađuje u Fazi 2 i može predložiti drugi redoslijed. Svaki rez je vertikalan (web + mobilni gdje je primjenjivo) i završava demoom.

- **R0 — Hodajući kostur:** infrastruktura, prijava, jedna zaštićena stranica, jedan zapis, jedan mobilni ekran, CI, deploy na produkcijske domene.
- **R1 — Firma, korisnici, role, audit:** pozivi, matrica dozvola, tenant izolacija s generisanim testovima.
- **R2 — Radnici i mašine (osnovna evidencija) + mehanizam rokova i dozvola:** profili, kategorije, prilozi, podsjetnici.
- **R3 — Projekti i dodjele:** projekti, faze, tim, mašine, budžet (struktura), dokumenti projekta.
- **R4 — Rad na terenu (mobilni, offline):** radni dan, pauze, grupni unos šefa, odobravanje, sinhronizacija i konflikti.
- **R5 — Mehanizacija u radu:** radni sati mašina, ture, gorivo, kvarovi, dnevni pregled; trošak po satu mašine.
- **R6 — Obračun sati i troškovi projekta:** obračun sati, izvoz, automatsko knjiženje troška na projekat, dashboard vlasnika i PM-a.
- **PILOT 1 — interni pilot** sa stvarnim podacima jedne ekipe i mašina (najmanje 2–4 sedmice).
- **R7 — Tenderi** (cijeli tok + konverzija).
- **R8 — Servis i održavanje, nabavka i skladište.**
- **R9 — Dnevnik građenja, HSE, izvještaji.**
- **R10 — Puni obračun plaća** (nakon potvrde računovođe) i izvoz za računovodstvo.
- **R11 — Stabilizacija, sigurnosni pregled, performanse, obuka i migracija podataka, produkcijski start.**
- **v2 backlog:** GPS/telematika, predmjer i situacije, javni profil, integracije.

---

## B12. Rizici

- **Obim:** prevelik za jednu isporuku. Ublažavanje: vertikalni rezovi, MVP granica, strogo upravljanje opsegom.
- **Obračun plaća:** zakonska specifičnost i rizik greške u novcu. Ublažavanje: faze, potvrda računovođe, paralelni obračun, objašnjivost.
- **Usvajanje na terenu:** radnici se opiru promjeni. Ublažavanje: jednostavan mobilni, obuka, pilot s malom ekipom, brzo ispravljanje.
- **Offline sinhronizacija:** teška i sklona greškama. Ublažavanje: rano prototipisanje, jasni konflikti, E2E scenariji prekida.
- **Agentov drift:** agent ostane u procesu umjesto u proizvodu (desilo se u v1). Ublažavanje: pravila A6, kapije, demo na kraju svakog reza.
- **Kvalitet podataka pri migraciji:** neuredni Excel i papiri. Ublažavanje: alat za uvoz s pregledom grešaka i rano uključenje ureda.
- **Zavisnost od jednog dobavljača infrastrukture:** Ublažavanje: standardni kontejneri, backup i restore provjeren.
- **Sigurnost i privatnost:** Ublažavanje: RLS, audit, minimizacija podataka, sigurnosni pregled prije pilota.

---

## B13. Otvorena pitanja za vlasnika (polazna lista)

1. Ko je pilot firma i koji su joj tri najveća problema danas? Koliko ima radnika, mašina i istovremenih projekata?
2. Koji entitet/entiteti (FBiH, RS, Brčko) su relevantni za obračun plaća i ko je računovođa koji potvrđuje model? Koji programski paket koristi računovodstvo?
3. Da li je prioritet MVP-a iz B4 ispravan? Da li tenderi ulaze ranije?
4. Da li radnici imaju pametne telefone (Android/iOS), kakav je signal na gradilištima, i da li firma daje uređaje?
5. Da li ostaje dvodomenski raspored (B2.3) i da li je potreban staging?
6. Da li postoji već GPS/telematika na mašinama i kojih proizvođača?
7. Kakav je željeni nivo prilagodbe rola po firmi?
8. Koji su šabloni dokumenata obavezni (dnevnik građenja, platni listić, situacije)?
9. Pravila čuvanja i brisanja podataka, pravne obaveze za dokumentaciju.
10. Da li sistem prodajemo drugim firmama (multi-tenant kao poslovni model) ili je za jednu firmu? Utiče na cijenu, planove, onboarding i podršku.
11. Preferencije izgleda: referentne aplikacije koje vlasniku djeluju dobro.
12. Budžet i vremenski okvir pilota.

---

## B14. Glosar (skraćeno)

- **Tenant / firma:** zasebna organizacija u sistemu s izolovanim podacima.
- **Rez (slice):** tanki, kompletni tok od baze do ekrana.
- **ADR:** zapis arhitektonske odluke.
- **Obaveza s rokom:** dozvola, licenca, registracija, ljekarski, sertifikat ili sličan dokument s datumom isteka.
- **Idempotentnost:** ponovljeni isti zahtjev ne stvara duple zapise.
- **Offline-first:** aplikacija radi bez mreže i sinhronizuje se kad se veza vrati.
- **RLS:** sigurnost na nivou reda u PostgreSQL bazi, dubinska zaštita tenant izolacije.

## B15. Dodatni prijedlozi: šta bi ovakav sistem još trebao pokriti

Oznake: **\[Rano u model\]** = ne mora se graditi odmah, ali se mora predvidjeti u modelu podataka jer je naknadna promjena skupa. Prioritete konačno određuje vlasnik.

**Specifično za niskogradnju**

1. **Stacionaže i dionice (km+m) \[Rano u model\].** Izvedeni radovi, količine, fotografije i nesukladnosti vezani za dionicu trase, ne samo za projekat. Uvoz trase (GeoJSON/KML).
2. **Predmjer, građevinska knjiga i obračunske situacije.** Privremene i okončane situacije po izvedenim količinama, ovjera nadzora, usporedba ponuđeno / izvedeno / naplaćeno. Najveći finansijski tok u niskogradnji.
3. **Otpremnice i vaga.** Dokument za svaki prevoz materijala (kamenolom, asfaltna baza, deponija), foto-otpremnica, usklađivanje s računom dobavljača.
4. **Kontrola kvaliteta.** Ispitivanja zbijenosti i materijala, laboratorijski izvještaji, atesti, nesukladnosti s rokom ispravke.
5. **Radni nalozi i dispečing.** Dnevni plan raspodjele ljudi i mašina (povuci-i-pusti), potvrda prijema na mobilnom, uvid u kolizije.
6. **Resursno planiranje i Gantt.** Kapacitet radnika i mašina kroz vrijeme, "šta ako" scenariji.
7. **Vrijeme i prekidi rada.** Vremenski uslovi u dnevniku automatski, evidencija zastoja zbog kiše i drugih razloga kao dokaz za produženje roka.
8. **Najam mehanizacije i podizvođači s mašinama.** Ulazni i izlazni najam, obračun po satu ili danu.
9. **Dodatni radovi, promjene i potraživanja (claims).** Nalozi, zapisnici i vremenski dokazi na jednom mjestu.
10. **Primopredaja i garantni rokovi.** Kontrolne liste tehničkog prijema, reklamacije nakon predaje s rokovima.
11. **Zaštita na radu u dubinu.** Dozvole za rad (npr. iskop, visina), toolbox razgovori, inspekcije, kontrola lične zaštitne opreme; digitalni potpis na ekranu.
12. **Evidencija otpada i okolišnih uslova** (ako je zakonski primjenjivo).

**Finansije**

13. **Profitabilnost i prognoza.** Marža po projektu u toku, procjena troška do završetka, upozorenje na projekat koji ide u gubitak; projekcija naplate i izdataka (cash flow).
14. **Tok odobravanja (workflow).** Pragovi iznosa, više nivoa, zamjena odsutnih. **\[Rano u model\]** jer će ga koristiti nabavka, troškovi, obračun i servis.
15. **Kartice goriva i tahograf.** Uvoz izvoda, poređenje s vlastitom evidencijom.

**Platforma i operacije**

16. **Digitalni potpisi i potvrde** za zapisnike, dnevnik i primopredaju (jednostavan potpis uz audit; kvalificirani potpis u v2).
17. **Kanali obavještenja koje teren stvarno koristi** (push, SMS, eventualno Viber/WhatsApp ako je izvodljivo i dozvoljeno). **\[OTVORENO\]**
18. **AI podrška (kasnije i uz stroge granice).** Čitanje računa, otpremnica i dozvola (OCR + izvlačenje polja), glasovna bilješka u dnevnik, sažetak tenderske dokumentacije, upit prirodnim jezikom nad izvještajima. Pravila: nikad automatski upis bez potvrde korisnika, definisan tok podataka i trošak, mogućnost isključenja po firmi.
19. **Onboarding i uvoz.** Čarobnjak za prvu postavku firme, uvoz iz Excela s pregledom grešaka, demo firma s realističnim podacima.
20. **Upravljanje mobilnim verzijama.** Minimalna podržana verzija i prisilno ažuriranje, da stari klijent ne ošteti podatke.
21. **Operativna zrelost.** Backup s provjerenim restore testom, izvoz svih podataka firme i gašenje firme (offboarding), feature flagovi, status sistema, podrška unutar aplikacije.
22. **SaaS sloj (ako se prodaje drugim firmama).** Planovi, limiti, naplata, fakturisanje. **\[OTVORENO\]** i **\[Rano u model\]**: čak i ako se ne gradi, tenant model mora to dopustiti.
23. **Zaštita podataka.** Evidencija pristanaka, pravila čuvanja i brisanja, evidencija pristupa osjetljivim podacima.
24. **Offline mape za teren** (v2).

**Prijedlog prioriteta:** u model od prvog dana ugraditi stacionaže (1), partnere, tok odobravanja (14), valutu uz iznos i tenant spremnost za SaaS (22). U MVP+/v1.1 dodati otpremnice (3), radne naloge i dispečing (5) i dashboard profitabilnosti (13). Situacije (2) su najvrjedniji sljedeći korak nakon pilota.
