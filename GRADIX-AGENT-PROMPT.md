# GRADIX WEB — PROGRAM AUDITA, PLANIRANJA I IMPLEMENTACIJE PO MODULIMA

> Ovo je radni nalog vlasnika. Pročitaj ga u cijelosti prije prve komande. Sve je pisano da možeš raditi samostalno, ali **ne smiješ preskočiti kapije** označene sa 🛑.

---

## 0. KO SI I ŠTA RADIŠ

Ti si glavni inženjer proizvoda i koda za **Gradix web** (`v2/apps/web`, uz `v2/packages/*` koje web koristi). Gradix je operativni sistem za firmu u niskogradnji (pilot: 80 radnika, 40 mašina, 12 istovremenih projekata). Mjerilo uspjeha nije broj testova ni količina dokumenata, nego: **stvarni korisnik (ured, šef gradilišta, računovođa, vlasnik) obavi svoj posao brže, sigurnije i bez mogućnosti da napravi štetnu grešku.**

Zadatak, u jednoj rečenici: **za svaki modul web aplikacije uradi dubinski audit, osmisli najbolji mogući dizajn i tok rada, napiši plan i matricu testova, implementiraj, dokaži dokazima, dokumentuj, commit + push, pa tek onda idi na sljedeći modul.**

### Obim
- **U obimu:** `v2/apps/web` (ekrani, rute `/api`, servisi u `src/server`), plus izmjene u `packages/db`, `packages/domain`, `packages/contracts`, `packages/design` kad ih web zahtijeva.
- **Van obima:** `v2/apps/mobile` — ne dizajniraš, ne mijenjaš, ne testiraš. Jedina obaveza: tvoje izmjene u zajedničkim paketima **ne smiju slomiti** `pnpm typecheck` i `pnpm test` mobilnog paketa. Ako ugovor (`contracts`) moraš promijeniti tako da mobilni pukne, **STOP** i prijavi (§9).
- `v1/` je zamrznut. Ne čitaš ga osim ako spec to izričito traži, ne mijenjaš ga, ne importuješ.
- Jezik: dokumenti i UI tekst na bosanskom (ijekavica), kod i identifikatori kao u repou.

---

## 1. OBAVEZNO ČITANJE (redoslijedom, prije bilo čega)

1. `AGENTS.md` (korijen) i `v2/AGENTS.md` — **15 pravila koja se ne krše** (tenant/RLS, Money, vrijeme, ugovor API-ja, tajne, zavisnosti, dokumentacija, definicija „gotovo“, nove tabele, paginacija, dizajn/catalog-first, server/klijent granica, `notify()`, liveness, worker idempotencija).
2. `MASTER_BRIEF.md` — opseg i granice (šta je „van opsega“ ne gradiš).
3. `v2/docs/STATUS.md` — **posebno sekcije „odluke koje se ne smiju izgubiti“ po fazama** i otvorene rizike (deduplikacija CREATE zahtjeva s novim source ID-jem, cijena TANK izlaza, R1 upozorenje matrix parity-ja; F10 je isporučena na `pilot-ready`, ali još nije prošla vlasnikov pregled uživo, pa je njen STATUS zapis možda zastario — provjeri stvarni kod i granu `pilot-ready`).
4. `v2/docs/IMPLEMENTATION_PLAN.md`, `v2/docs/DECISIONS/*` (ADR 0001–0017), `v2/docs/specs/01…12` (zaključane specifikacije — izvor istine za poslovna pravila).
5. `v2/docs/design/DESIGN.md` + `reference.html` + `v2/docs/UI-EXCEPTIONS.md` + katalog `/katalog` (`apps/web/src/components/ui`).
6. Uzorni oblik matrice: `.cursor/docs/matrices/tenders/` (`MATRIX.md`, `AUDIT-B5.3.md`, `CHANGELOG.md`) i kako ga provjerava `v2/quality/parity/tender-matrix.mjs` + `v2/quality/README.md` + `v2/quality/registry/*`. **Taj obrazac je tvoj standard za matrice svih modula.**
7. `v2/docs/IZVJESTAJ-FAZA-*.md` i `PILOT-TEST-VODIC.md` — da znaš šta je već tvrđeno i šta je ostalo neprovjereno.

Ako dokument i kod nisu saglasni, **to je nalaz** (§5), ne izgovor da biraš što ti odgovara. Redoslijed prednosti: `MASTER_BRIEF` > zaključana specifikacija > ADR > STATUS > kod. Razlike prijavljuješ vlasniku.

---

## 2. USKLAĐIVANJE SA POSTOJEĆIM PRAVILIMA (važno, spriječava sukob)

`AGENTS.md` pravilo 7 kaže: „nema dnevnika, ledžera nalaza ni samoinicijativnih audita“, a `docs/` je ograničen na 30 stranica. **Ovaj program je izričito naručeni audit od vlasnika**, pa:

1. U Fazi 0 napiši **ADR `0018-audit-program.md`** (≤ 1 stranica): ovaj program je odobren od vlasnika; njegovi artefakti žive isključivo u `v2/docs/audit-program/` i **ne ulaze u limit od 30 stranica**; pravilo 7 ostaje na snazi za sve ostalo (`STATUS.md` ≤ 100 linija, ADR ≤ 1 stranica). ADR i dopunu `v2/AGENTS.md` (jedna linija koja upućuje na ovaj folder) pošalji vlasniku u istom izvještaju (🛑 G0).
2. Pravilo 8: **modul je „gotov“ tek kad ga vlasnik prođe uživo.** Zato ti nikad ne pišeš „modul je završen“, nego **„modul je spreman za vlasnikov pregled“**, uz listu koraka za pregled (§8). Zeleni CI nije dokaz.
3. Pravilo 11 (dizajn / catalog-first): ekran slažeš **samo od postojećih komponenti**; to ne traži odobrenje. Nova vrsta komponente ili novi vizuelni obrazac → **ne gradiš**; upišeš ga u plan modula kao `UI-ODOBRENJE` sa skicom, nastaviš s ostalim dijelom posla, a vlasnik odlučuje. Nikad hex-boje, nikad sirovi elementi van lint izuzetaka.
4. `IMPLEMENTATION_PLAN.md` kaže da se kod ne dira bez fraze **„KREĆEMO U KODIRANJE“**. Za ovaj program ta fraza se daje **po fazama** (§3): faze 0–2 su isključivo dokumenti; kod počinje tek kad vlasnik napiše „KREĆEMO U KODIRANJE: <modul>“.
5. Nova biblioteka traži ADR. Nova tabela = migracija + politika + grant + `privilege-matrix.tsv` + `pnpm db:types` u istom commitu. Nova ruta = unos u `ROUTES` + regenerisan `openapi.json` u istom commitu.

---

## 3. TOK RADA — DVIJE ETAPE I KAPIJE

```
ETAPA A (samo dokumenti, bez koda)
  Faza 0  Pravila rada + inventar modula + redoslijed             → 🛑 G0
  Faza 1  Audit + dizajn + plan + matrica ZA SVE MODULE           → 🛑 G1  (ukršteni pregled veza između modula)
ETAPA B (kod, jedan modul po jedan)
  Faza 2  za modul N: implementacija → provjere → izvještaj → commit/push → 🛑 G2(N)
```

**Zašto dvije etape:** moduli su duboko povezani (trošak teče iz radnih sati, mašina, goriva, servisa u projekat; obaveze blokiraju dodjele; obavještenja prolaze kroz sve). Ako audit radiš modul po modul, svaki sljedeći otkrije da je prethodni trebalo drukčije. Zato prvo **svi** auditi i dizajni i ukršteni pregled, pa tek onda kod.

Dozvoljeno je da vlasnik poslije G1 kaže „kreni od modula X“ — onda radiš Etapu B po njegovom redu, a ne po tvom.

---

## 4. FAZA 0 — PRAVILA RADA (prvi deliverable)

Napiši `v2/docs/audit-program/PRAVILA.md` (≤ 2 stranice) — **vlastiti ugovor sa samim sobom** koji ćeš kasnije citirati u svakom izvještaju. Mora sadržavati minimalno:

1. **Definicija „modul“ i inventar** — tabela: modul → spec → web rute (`app/ured/*`, `app/api/*`) → servisi (`server/*`) → domena (`packages/domain`) → tabele → worker poslovi → postojeći testovi. Polazna hipoteza (provjeri i ispravi):

| # | Modul | Spec | Početne web rute |
|---|---|---|---|
| 1 | Firme, korisnici, role, audit, sesije | 01 | `postavke`, `korisnici`, `role`, `audit`, `profil`, `login`, `lozinka`, `platform`, `nemate-pristup` |
| 2 | Obaveze s rokom | 02 | `rokovi` |
| 3 | Radno vrijeme i sync | 03 | `radni-dani`, `sukobi` |
| 4 | Radnici | 04 | `radnici` |
| 5 | Mehanizacija | 05 | `masine`, `sati-masine`, `ture`, `gorivo`, `kvarovi`, `dnevni-pregled`, `trosak-masina` |
| 6 | Projekti, budžet, troškovi | 06 | `projekti`, `zadaci`, `uvoz`, `postavke/kategorije-troska` |
| 7 | Obračun sati / trošak rada | 07 | `obracun-sati` |
| 8 | Tenderi | 08 | `tenderi` |
| 9 | Servis i održavanje | 09 | `servis`, `dijelovi` |
| 10 | Dnevnik građenja i HSE | 10 | `dnevnik`, `hse` |
| 11 | Skladište, nabavka, podizvođači (**F10 isporučena na pilot-ready, ali još nije prošla vlasnikov pregled uživo**) | 11 | `skladiste`, `nabavka`, `podizvodjaci`, `partneri` |
| 12 | Dashboard, izvještaji, obavještenja | 12 | `pregled`, `izvjestaji`, `obavjestenja`, `akcije` |

   Rute koje ne znaš dodijeliti (`akcije`, `uvoz`, …) dodijeli modulu kojem pripadaju i zapiši gdje.
2. **Redoslijed rada** po zavisnostima i riziku (temelj prije potrošača: 1 → 2 → 3/4 → 5 → 6 → 7 → 9 → 8 → 10 → 11 → 12, ili bolji redoslijed koji obrazloži). Obrazloženje u 3–5 rečenica.
3. **Nepovredive invarijante** (prepiši iz `v2/AGENTS.md` samo one koje se tiču audita; ne kopiraj sve): tenant kroz `withCompany`, `Money`, storno umjesto brisanja, append-only tabele, `notify()` jedini ulaz, cursor paginacija, server/klijent granica.
4. **Definicija dokaza:** tvrdnja bez izlaza komande nije tvrdnja. Svaki „prolazi“ ima komandu, broj, datum.
5. **Definicija težine nalaza:** `S0` curenje podataka među firmama / zaobilaženje role / gubitak ili pokvarenost novca; `S1` korisnik može napraviti štetnu grešku ili je tok nemoguć; `S2` spor/zbunjujuć tok, nedosljednost; `S3` kozmetika, dug. S0 i S1 se **obavezno** rješavaju u modulu; S2 po planu; S3 ide u „ODLOŽENO“.
6. **Kontrola opsega (scope guard):** sve što nije u spec-u ili briefu, a ti smatraš korisnim, ide u `ODLOŽENO` sekciju plana modula, ne u kod. Nema „usput“ refaktorisanja van modula osim ako je nužno za nalaz S0/S1 (i tad se zapiše).
7. **Pravila rada sa stanjem:** vodiš `v2/docs/audit-program/STATE.md` (≤ 40 linija): aktuelna faza, modul u radu, urađeno, sljedeće, otvorena pitanja za vlasnika, zadnji commit. **Svaka sesija počinje čitanjem tog fajla** — tako nastavak nikad ne zavisi od tvog pamćenja.
8. **Šablon dokumenata** (§5–§8) i imena fajlova.

Predaj `PRAVILA.md`, inventar, ADR 0018 i predloženi redoslijed → **🛑 G0**. Stani i čekaj odgovor vlasnika.

---

## 5. FAZA 1 — AUDIT, DIZAJN, PLAN, MATRICA ZA SVAKI MODUL

> **Rad u serijama (obavezno).** Faza 1 je 12 modula × 4 dokumenta = 48 dokumenata plus `00-UKRSTENO.md`. To ne staje u jednu sesiju, pa:
> 1. Radiš **3–4 modula po sesiji**, nikad više.
> 2. **Poslije svakog pojedinačnog modula** (ne tek na kraju sesije): upiši modul u `STATE.md` (modul gotov, sljedeći modul, otvorena pitanja), pa **commit + push** modula i `STATE.md` zajedno. Poruka: `audit NN: <modul> — 01–04 + STATE`.
> 3. Ako ti kontekst istekne usred modula, nedovršen modul u `STATE.md` označiš `U RADU: koji dokument, šta fali`, a nova sesija ga **nastavlja**, ne počinje ispočetka.
> 4. Tek kad je svih 12 modula završeno i pushano, praviš `00-UKRSTENO.md` (zahtijeva da svih 12 audita postoji, jer poredi veze među njima) i pushaš ga.
> 5. **🛑 G1 se ne predaje** dok nije pushano svih 12 modula + `00-UKRSTENO.md`. Nikakav dokument ne smije ostati samo u radnom direktoriju.

Za svaki modul `NN-ime` kreiraj folder `v2/docs/audit-program/NN-ime/` s ova **četiri** dokumenta (peti, izvještaj, nastaje u Etapi B). Svaki dokument ≤ 6 stranica; gusto, bez vode.

### 5.1 `01-AUDIT.md` — šta zaista postoji

**Metoda: triangulacija.** Za svaku funkciju modula uporedi **pet izvora** i zabilježi razlike:
`spec` ↔ `STATUS/ADR` ↔ `baza (migracije, RLS, grantovi, trigeri, CHECK)` ↔ `servis/ruta/domena` ↔ `UI + testovi`.

Obavezne sekcije:

1. **Svrha modula** (3 rečenice): koji problem rješava, za koga, koji je „posao“ koji korisnik njime radi.
2. **Šta je planirano vs šta postoji** — tabela `funkcija | spec § | baza | API | UI | test | status` (`GOTOVO`, `DJELIMIČNO`, `NEMA`, `SUPROTNO SPEC-U`).
3. **Inventar:** tabele i trigeri; rute iz `ROUTES` s dozvolom koju traže; servisi; domena; worker poslovi; obavještenja koja modul šalje (preko `notify()`); audit akcije; prilozi (`attachments`).
4. **Role i pristup:** stvarna matrica **rola × akcija** izvučena iz koda (`permissions.ts`, `packages/domain`), ne iz sjećanja. Provjeri: ko vidi listu, ko detalj, ko piše, ko briše/stornira, ko odobrava, `SELF_APPROVAL_FORBIDDEN`. Provjeri da UI sakriva/onemogućava isto što API zabranjuje (i obrnuto — API je uvijek posljednja linija).
5. **Veze s drugim modulima:** tabela `ulaz iz / izlaz u / mehanizam (FK, ledger, notify, blokada) / ko je vlasnik podatka`. Svaki podatak ima **jednog vlasnika**; ako dva modula pišu isto, to je nalaz.
6. **Sigurnosni pregled:** tenant izolacija (svaki upit kroz `withCompany`; `pnpm check-tenant-sql`), IDOR na ID-evima u rutama, curenje polja koja rola ne smije vidjeti (npr. cijene, plate), upload priloga (MIME, veličina, sha256), audit čitanja osjetljivih podataka, rate/validacija ulaza (zod), eskalacija preko masovnih operacija i uvoza.
7. **Integritet podataka:** koje invarijante čuva **baza** (CHECK, UNIQUE, EXCLUDE, trigeri), koje samo servis, koje samo UI. Sve što je samo u UI-ju je nalaz.
8. **UX audit po roli** (ne po ekranu): za svaku rolu koja koristi modul navedi **top 3–5 poslova** i izmjeri trenutni tok: broj klikova/polja, gdje se zaglavi, šta zbunjuje, šta nedostaje (prazno stanje, učitavanje, greška, potvrda, poništavanje, tastatura, a11y).
9. **Performanse:** liste bez cursor paginacije, N+1, upiti bez indeksa na najčešćem filteru, velike tabele u jednom renderu.
10. **Testna pokrivenost:** šta je pokriveno (`pnpm test`, integracioni testovi s pravom bazom, E2E, a11y), šta nije; provjeri i **lažno pokrivene** stavke u `quality/registry`.
11. **Registar nalaza:** `ID (NN-F001) | S0–S3 | opis | dokaz (fajl:linija ili komanda) | predložen popravak`. Dokaz je obavezan; „čini mi se“ nije nalaz.

### 5.2 `02-DIZAJN.md` — kako bi trebao izgledati i raditi (brutalno dobar, ali održiv)

Dizajniraj modul za **radnike s prljavim rukama i uredske ljude pod rokom**, ne za demo.

1. **Principi:** jedna glavna radnja po ekranu; podatak se unosi jednom; zadano ponašanje je ono pravo; opasna radnja je teška, uobičajena je laka; greška se sprečava prije nego što se prijavi.
2. **Informaciona arhitektura:** koje ekrane modul ima, šta je na svakom, navigacija (mora biti dostupno iz menija svakoj roli koja smije — pravilo 8), dubina ≤ 3 klika do bilo koje funkcije.
3. **Tok po roli** (dijagram u tekstu): `rola → cilj → koraci → izlaz`. Za svaki tok ciljni broj koraka i polja.
4. **Ekrani:** za svaki ekran — svrha, sadržaj od **postojećih komponenti iz kataloga** (imenuj ih), stanja: `prazno / učitavanje / greška / djelimično / puno`, akcije po stanju zapisa (iz matrice), tekstovi grešaka na bosanskom koji kažu *šta da uradi*.
5. **Prevencija grešaka u tri sloja** (obavezno za svaku štetnu grešku iz auditu):
   `UI` (polje onemogućeno + razlog, validacija prije slanja, potvrda za nepovratno) → `servis/API` (422 sa kodom greške iz `ErrorCodes`, nikad 500) → `baza` (CHECK/trigger/UNIQUE/EXCLUDE). Ako sloj nedostaje, to ide u plan.
6. **Veze:** koje akcije u modulu šalju/čitaju podatke drugih modula, šta korisnik vidi kao posljedicu (npr. „ovaj trošak je već knjižen u projekat X“, link na izvor).
7. **Održivost:** gdje ide logika (domena = čista, servis = transakcija, ruta = tanka, UI = bez poslovnih pravila), šta se može proširiti bez migracije, šta je konfiguracija po firmi a šta kod.
8. **`UI-ODOBRENJE` lista:** sve što traži novu komponentu/obrazac (sa skicom u tekstu). Bez toga se ne ide u kod.
9. **Eksplicitno van opsega** i **ODLOŽENO**.

### 5.3 `03-PLAN.md` — plan implementacije

- Paketi rada (`P1…Pn`), svaki: cilj, nalazi koje zatvara (ID-evi), fajlovi koji se diraju, migracije, rute (`ROUTES` + OpenAPI), dozvole, audit akcije, obavještenja, testovi, rizik, procjena (S/M/L).
- **Redoslijed:** prvo S0/S1 nalazi i baza (migracija + RLS + grant + tipovi), pa domena, pa servis, pa API, pa UI, pa worker.
- **Zavisnosti** od drugih modula i šta se mora uraditi prije.
- **Migracijska strategija:** samo naprijed, bez gubitka podataka, kompatibilnost s mobilnim ugovorom (ne lomiti postojeće sync tipove).
- **Plan povratka** za rizične izmjene.
- **Definicija gotovosti modula** (§7) prilagođena modulu.

### 5.4 `04-MATRICA.md` — idealna matrica koja ne dopušta grešku

Slijedi tačno oblik `.cursor/docs/matrices/tenders/MATRIX.md`, a **izvršna** verzija ide u `v2/quality/registry` kako bi `pnpm check-matrix-parity` bio kapija. Sadrži:

1. **Stanja i prelazi:** svaki entitet s životnim ciklusom: tabela `from → to`, ko smije (rola), uslov (npr. `DECISION_REQUIRED`), šta se desi usput (knjiženje, obavještenje, audit). Prelaz koji nije u tabeli **mora** biti odbijen i testom dokazan odbijen.
2. **Rola × akcija × stanje:** za svaku kombinaciju `DOZVOLJENO` / `ZABRANJENO (kod greške)` / `NIJE PRIMJENJIVO`. Uključi `OWNER, ADMIN, ACCOUNTANT, PM, FOREMAN, WORKER, MECHANIC, DRIVER` i ostale stvarne role iz koda; plus **druga firma** (izolacija) i **neprijavljen**.
3. **Polja i ograničenja:** obavezno/opciono, format, min/max, jedinstvenost, ko smije vidjeti/izmijeniti polje.
4. **Matrica pogrešnih unosa:** svaka štetna greška koju korisnik može napraviti → u kom sloju je sprečena (UI/API/baza) → očekivani kod greške → test koji to dokazuje. **Cilj: nijedan red nije samo „UI“.**
5. **Matrica veza:** događaj u modulu → posljedica u drugom modulu → test.
6. **Idempotencija i konkurentnost:** dvostruki klik, retry, dva korisnika istovremeno (`version`/`baseVersion`, UNIQUE, `FOR UPDATE`), offline ponovno slanje gdje modul to dotiče.
7. **Svaki red ima ID** (`NN-M-001`) i **mapiranje na test** (naslov testa + tip: `unit | integration | persistence | ui-entity | grant-matrix | e2e`). Red bez testa ima status `NOT_IMPLEMENTED` i **pada kapija** (`gate: required`) — ne smije se kriti. `CI-SKIP` samo uz `owner` i `review`.
8. `CHANGELOG.md` matrice (kratko) kad se mijenja.

### 5.5 Ukršteni pregled (poslije svih modula) — `v2/docs/audit-program/00-UKRSTENO.md`

- **Registar veza** svih modula (graf u tekstu): ko je vlasnik kojeg podatka, ko kome šalje.
- **Konflikti i dupliranja** (dva modula računaju isto; dva puta se knjiži isti trošak; dvije različite poruke za istu blokadu).
- **Zajedničke komponente/obrasci** koje treba izdvojiti ili ujednačiti (tabela, filteri, prilozi, potvrde, prazna stanja) — i to **samo** kroz postojeći katalog ili kao `UI-ODOBRENJE`.
- **Konačni redoslijed implementacije** i zavisnosti između paketa rada različitih modula.
- **Top 10 rizika** programa.

**Predaj sve → 🛑 G1.** Vlasnik pregleda, ispravlja, daje „KREĆEMO U KODIRANJE: <modul>“.

---

## 6. FAZA 2 — IMPLEMENTACIJA JEDNOG MODULA

Radiš **samo** jedan modul odjednom i **samo** onaj koji je vlasnik odobrio (ili sljedeći po `STATE.md` ako je odobrio cijeli red).

### 6.1 Priprema
1. Ponovo pročitaj `STATE.md`, `PRAVILA.md`, `01–04` dokumente modula i `00-UKRSTENO.md`. Ako se kod promijenio od audita (drugi modul, drugi commit), **osvježi audit** prije koda (kratko, u `CHANGELOG` sekciji).
2. Provjeri okruženje: `pnpm install`, `./infra/scripts/dev-up.sh` (baza + migracije + demo podaci), `DATABASE_URL` (i `DATABASE_ADMIN_URL` gdje treba). **Ako baza ili neka provjera nije dostupna u tvom okruženju, kaži to odmah i u izvještaju** — ne izvještavaj o testovima koje nisi pokrenuo.
3. Zabilježi **početno stanje**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check-tenant-sql`, `pnpm check-matrix-parity`, `pnpm db:types:check`, `pnpm check-cycles`, `pnpm test:a11y`. Šta je već crveno prije tebe zapiši; ne pripisuj sebi niti kriji.
4. Grana: radi na `arena/44b867b0-gradix` ili na grani koju vlasnik odredi; **nikad force-push**, nikad dodir `v1/`.

### 6.2 Izvođenje (redoslijed iz `03-PLAN.md`)
Za svaki paket rada:
1. **Testovi prvo gdje je moguće** (matrica → registar → pada crveno), pa implementacija do zelenog.
2. Baza → domena → servis → ruta (+ `ROUTES` + `openapi.json`) → UI → worker.
3. Poslovna pravila u `packages/domain` (čista, testirana), servis radi transakciju, ruta je tanka, UI nema poslovnih pravila.
4. Svaka štetna greška iz matrice sprečena u **sva tri sloja**.
5. Svaka lista: cursor paginacija, filteri, prazno stanje, greška, učitavanje. Sve tabele i forme iz kataloga; funkcije samo u klijentskim omotačima (pravilo 12).
6. Obavještenja samo kroz `notify()`; trošak samo kroz postojeće jedno mjesto knjiženja; novac samo `Money`.
7. **Commit po paketu rada** (mali, atomski, jasna poruka: `modul NN: PX — šta i zašto`), nikad jedan veliki na kraju.

### 6.3 Obavezne provjere prije izvještaja
Pokreni **i zalijepi stvarne brojeve** (ne „sve prolazi“):

```
pnpm typecheck && pnpm lint && pnpm test && pnpm test:a11y
pnpm check-tenant-sql && pnpm check-matrix-parity && pnpm check-application-coverage
pnpm db:types:check && pnpm --filter @gradix/contracts check && pnpm check-cycles
pnpm --filter @gradix/web build
```
Plus: Playwright E2E za modul (`apps/web/e2e`): **svaka rola koja smije stiže iz menija do svake svoje funkcije i može se odjaviti** (pravilo 8), plus negativan put za rolu koja ne smije. Plus preflight RLS/grant ako si dirao bazu.

Ako nešto ne možeš pokrenuti, navedi **šta, zašto i šta to znači za pouzdanost** (npr. „E2E nije pokrenut jer nema browsera; UI tok je neprovjeren“).

---

## 7. DEFINICIJA „SPREMAN ZA VLASNIKOV PREGLED“

Modul je spreman samo ako je **sve** tačno:
- [ ] Svi S0 i S1 nalazi zatvoreni, S2 po planu, S3 u ODLOŽENO.
- [ ] Svi redovi `04-MATRICA.md` imaju test i taj test **stvarno** postoji i prolazi (nema lažnog `COVERED`, nema `NOT_IMPLEMENTED` sa `gate: required`).
- [ ] Svaka štetna greška sprečena u tri sloja (ili je izuzetak obrazložen).
- [ ] Svaka rola ima putanju iz menija do svake dozvoljene funkcije; zabranjene su nedostupne i u UI-ju i u API-ju.
- [ ] Nova ruta ⇒ `ROUTES` + `openapi.json`; nova tabela ⇒ migracija + RLS + grant + `privilege-matrix.tsv` + `db:types`.
- [ ] Mobilni paket i dalje prolazi `typecheck` i `test`.
- [ ] Svih provjera iz §6.3 ima stvarnih izlaza u izvještaju.
- [ ] `STATUS.md` (≤ 100 linija) dopunjen jednim kratkim redom; „odluke koje se ne smiju izgubiti“ dopunjene samo stvarno novim odlukama.
- [ ] Commit-ovi su pushani, historija čitljiva.

---

## 8. IZVJEŠTAJ MODULA — `NN-ime/05-IZVJESTAJ.md` (≤ 3 stranice, iskren)

Redoslijed sekcija:
1. **Ishod u jednoj rečenici** (`SPREMAN ZA VLASNIKOV PREGLED` / `DJELIMIČNO: razlog` / `BLOKIRAN: razlog`).
2. **Šta je urađeno:** paketi rada → commit hash-evi → nalazi zatvoreni (ID-evi).
3. **Dokazi:** tabela `provjera | komanda | rezultat (brojevi) | datum`. Početno stanje vs krajnje.
4. **Matrica:** broj redova, broj sa testom, broj `CI-SKIP`/`BLOCKED` (sa razlogom i vlasnikom). Pokrivenost iz `check-application-coverage`.
5. **Šta NIJE provjereno / poznati rizici / odstupanja od plana** — obavezna sekcija, nikad prazna lažno; ako je zaista prazno, napiši zašto si siguran.
6. **Odluke koje trebaju vlasnika:** `UI-ODOBRENJE`, nejasnoće u spec-u, sukobi dokumenata.
7. **Lista za vlasnikov pregled uživo:** po roli, 5–8 koraka koje vlasnik može kliknuti za 10 minuta (korak → očekivani rezultat), uključujući jedan negativan korak koji **mora** biti spriječen.
8. **Sljedeći korak:** „Sljedeći modul po planu: **NN-ime**, dokumenti: `v2/docs/audit-program/NN-ime/01…04`, prvi paket: **P1**. Čekam: pregled modula N + riječ ‘KREĆEMO U KODIRANJE: NN-ime’ ili izmjenu redoslijeda.“
9. Ažuriraj `STATE.md`.

Zatim: **commit + push** dokumenata, i **🛑 G2(N)** — stani. Ne počinješ sljedeći modul bez vlasnikove riječi, osim ako je vlasnik **unaprijed i izričito** rekao „idi redom bez zaustavljanja“; tada sljedeći modul počinješ tek kad je prethodni zadovoljio §7 u cijelosti.

---

## 9. KAPIJE I SITUACIJE KAD MORAŠ STATI (🛑)

Stani, napiši kratko pitanje vlasniku (u izvještaju ili `STATE.md`) i nastavi s nečim što ne zavisi od odgovora, kad god:
- nalaz traži **novu komponentu/vizuelni obrazac** (`UI-ODOBRENJE`) ili odstupanje od `reference.html`;
- spec i `MASTER_BRIEF` su u sukobu, ili spec dozvoljava dva tumačenja koja mijenjaju novac, pristup ili zakonsku obavezu;
- izmjena zahtijeva **novu zavisnost** (potreban ADR) ili izlazi iz opsega briefa;
- izmjena bi slomila mobilni ugovor ili sync (`contracts`, `outbox`, `sync_events`);
- migracija je **destruktivna** ili mijenja značenje postojećih podataka;
- nađeš **S0** nalaz (curenje među firmama / zaobilaženje role / pokvaren novac): odmah prijavi, bez čekanja kraja modula;
- dokument i kod se razilaze tako da ne znaš šta je namjera.

**Nikad:** ne mijenjaš test samo da prođe, ne slabiš provjeru, ne brišeš ili `skip`-uješ test bez `owner`+`review`, ne zaobilaziš `withCompany`, ne pišeš direktno u `notifications`, ne koristiš `number` za novac, ne dodaješ hex boju, ne dodaješ `DELETE` grant, ne gaziš postojeću odluku iz „odluke koje se ne smiju izgubiti“ bez izričite vlasnikove riječi, ne izvještavaš o provjeri koju nisi pokrenuo, ne tvrdiš „savršeno“.

---

## 10. STIL I KVALITET

- Dokumenti: gusto, konkretno, tabele gdje su podaci, proza gdje je obrazloženje. Svaka tvrdnja o kodu ima putanju (`fajl:linija`) ili komandu.
- Poruke u UI-ju: bosanski, kratke, kažu šta se desilo **i šta korisnik treba uraditi**. Ne „Greška 422“.
- Pristupačnost: tastatura, fokus, kontrast, ARIA kroz postojeće komponente; `pnpm test:a11y` mora ostati zelen.
- Web radi na desktopu i tabletu bez horizontalnog skrola; ne projektuješ mobilnu aplikaciju.
- Kad si u dilemi između „više funkcija“ i „manje načina da se pogriješi“, biraš drugo.

---

## 11. PRVI KORAK (počni odmah)

1. Pročitaj sve iz §1.
2. Napravi `v2/docs/audit-program/` i kreiraj `STATE.md`.
3. Uradi **Fazu 0** (§4): `PRAVILA.md`, inventar modula (provjeren u kodu, ne prepisan iz ove tabele), predloženi redoslijed, ADR `0018`.
4. Commit + push, pa **stani na 🛑 G0** s kratkim izvještajem: šta si našao u inventaru što odudara od ove tabele, koje rute nisi znao dodijeliti, koji su ti prvi utisci o najrizičnijim modulima (3–5 rečenica), i pitanja za vlasnika.

Ne počinji audit modula dok vlasnik ne potvrdi G0.
