# FRONTEND.md — Gradix web panel i javni sajt

> **Izvor istine za web sloj.** Sve tvrdnje provjerene u `frontend/` na commitu `e531ca2`.
> Dizajn smjer (nova paleta, admin dashboard) je odluka **D-008** — konkretan predlog ide
> vlasniku na odobrenje **prije** implementacije.

**Stack:** React 19, Vite 8, TypeScript 6, Tailwind CSS 4, Radix UI + CVA, TanStack Query,
Zustand, react-router 7, react-hook-form + zod, i18next (bs/en), Leaflet (mape), Sonner (toast).
**Lint:** `oxlint` (`.oxlintrc.json`). **Testovi:** Playwright (1 spec danas).
**Obim:** 115 fajlova u `src/`, ~8.600 LOC, **24** stranice.

---

## 1. Struktura

```
frontend/src/
  main.tsx / App.tsx        — ulaz, router provider
  routes/app-router.tsx     — sve rute (jedno mjesto)
  routes/guards.tsx         — RequireAuth, RequirePermission, RequireAnyPermission,
                              RequirePayroll, PublicOnly, CatchAllRedirect
  pages/                    — 24 stranice (jedan fajl = jedna stranica)
  components/               — layout (app-shell, sidebar-nav, bell, company-switcher, user-menu)
                              + domenske komponente (project-tabs, planned-gantt, quantity-tab,
                              erp-*, registry-fields, dispatch-sheet, diary-conflict-sheet…)
  hooks/                    — use-auth-bootstrap, use-me, use-socket, use-public-settings,
                              use-tenant-ready, use-logout-sync
  stores/                   — auth-store, company-store (Zustand)
  lib/                      — api klijent, query ključevi, helperi, formatiranje
  i18n/                     — bs (default) + en, namespace po domenu (ops, polish, payroll, erp)
  index.css                 — Tailwind + design tokeni (@theme inline)
  assets/
```

**Principi:**
- Jedan fajl = jedna stranica/komponenta; fajlovi 100–150 linija, preko 200 se dijeli.
- Rute su **deklarisane na jednom mjestu** (`app-router.tsx`) — bez „skrivenih“ ruta.
- Pristup ruti se izražava guard komponentom, ne `if`-om u stranici.

---

## 2. Routing (mapa)

| Putanja | Stranica | Pristup |
|---|---|---|
| `/` | redirect → `/login` | javno |
| `/login`, `/forgot`, `/reset` | auth stranice | `PublicOnly` |
| `/p/:slug` | javni one-page firme | javno |
| `/dashboard` | KPI po roli | `RequireAuth` |
| `/projects`, `/projects/:id` | projekti + detalj (tabovi: zadaci, količine, dnevnik, dokumenti, Gantt) | `RequireAnyPermission` |
| `/tasks`, `/tasks/:id` | zadaci + detalj | permisije zadataka |
| `/fleet`, `/fleet/map` | mašine + mapa | permisije flote |
| `/logistics` | ture + gorivo | ops permisije |
| `/diary`, `/hse` | dnevnik, HSE | SS/ADMIN |
| `/documents`, `/tenders`, `/services`, `/reports` | ured | `polish.*` |
| `/payroll` | obračun | `RequirePayroll` |
| `/erp` | partneri/troškovi/lager | `erp.*` |
| `/settings`, `/users`, `/companies` | administracija | `settings.write` / `users.*` / platform |
| `/change-password` | obavezna promjena | fullscreen kad `mustChangePassword` |

### 2.1 Shell i navigacija (FE-02, D-041)

- **Jedan spisak navigacije:** `src/components/layout/navigation.ts` (`NAV_SECTIONS`) — koriste ga
  sidebar, `<AppShell>` (naslov taba) i vidljivost po permisijama. Grupe: *Pregled · Posao · Teren ·
  Ured · Administracija*; ikona je uvijek uz tekst (nikad jedini nosilac značenja).
- **Aktivna stavka = najduži prefiks** (`activeNavPath`): `/fleet/map` gasi `/fleet`,
  a `/projects/:id` drži `/projects` aktivnim. `aria-current="page"` ide na aktivni link.
- **Vidljivost:** `isNavItemVisible` — `permission`, `anyPermission` (zadaci: `tasks.read` ili
  `tasks.dispatch`), `payroll` (uloge koje vide obračun) i `tenant` (stavke vezane za firmu su
  onemogućene dok firma nije izabrana). Guardovi na rutama ostaju mjerodavni — nav je samo UI.
- **Pristupačnost shella:** „Preskoči na sadržaj“ je prvi tabulator; `<main id="main">` prima fokus
  poslije navigacije; `document.title` je `<label> · Gradix`; skrol se resetuje na promjenu rute.
  Mobilni meni je `Sheet` sa `sr-only` naslovom i zatvara se klikom na stavku.
- **Lazy rute (D-015):** `fleet/map` (Leaflet), javni sajt, obračun i ERP se učitavaju tek kad se
  otvore, sa istim statusnim prikazom kao pri boot-u. Početni JS: **292.6 kB → 207.7 kB gzip**
  (budžet je 250 kB, D-015).

---

### Napomena o refresh-u u više tabova (CI-05)

Zapamćeni token osvježavaju kooperativne kartice kroz Web Locks kada su dostupni. Kartica ne
preuzima promijenjeni token automatski: druga prijava može pripadati drugom nalogu. Pri konfliktu
provjeriti nalog i osvježiti stranicu; ako se to desi pri početnom učitavanju, kartica ostaje na
prijavi. Ova zaštita ne obuhvata stare tabove, preglednike bez Web Locks, kopirane sessionStorage
tokene, blokiranu pohranu ni izgubljen odgovor nakon serverske rotacije. Logout-all/reuse signal sada sadrži ID korisnika, ne refresh token; nepoznati/legacy signali se
ignorišu. To nije puni session-ID protokol: stari tabovi mogu reagovati globalno, više odgođenih
signala istog korisnika nije potpuno uređeno, a bootstrap bez poznatog korisnika ne šalje signal.
Lokalno brisanje čuva očigledno različit zajednički token, ali provjera i brisanje nisu atomski.
Serverska detekcija ponovne upotrebe ostaje uključena.

Refresh `429` nije dokaz nevažeće sesije: token, korisnik i keš ostaju sačuvani, bez automatskog ponavljanja. Pretpostavka je da naš throttler odbija zahtjev **prije** rotacije; posrednik koji naknadno zamijeni uspješan odgovor sa 429 može ostaviti nepoznat ishod. Pri početnom učitavanju `429` ili mrežni prekid pokazuju pristupačan ekran sa izborom ponovnog pokušaja ili nastavka bez obnove; pri grešci profila nakon uspješne rotacije retry najprije ponavlja profil bez nepotrebne nove rotacije. Odabirom nastavka token se ne briše, ali kasnija nova prijava može ga zamijeniti. Neispravni/opozvani token i dalje briše sesiju i keš. Drugi neuspješni refresh odgovori (npr. 5xx) za sada zadržavaju ranije ponašanje odjave; izgubljen odgovor nakon uspješne rotacije i dalje može aktivirati reuse zaštitu.

## 3. State i podaci

| Sloj | Alat | Pravilo |
|---|---|---|
| Server state | TanStack Query | keširaj po `[resurs, parametri]`; mutacije invalidiraju precizno, ne globalno |
| Auth/session | Zustand `auth-store` | access token **u memoriji**; refresh u `sessionStorage` („zapamti me“ ⇒ `localStorage`) |
| Tenant | Zustand `company-store` | PLATFORM_ADMIN bira firmu ⇒ `X-Company-Id` se dodaje u klijentu |
| Forme | react-hook-form + zod | ista pravila kao backend DTO (min dužine, formati) |
| i18n | i18next | nijedan korisnički tekst se ne piše direktno u JSX |

**Poznato:** `403 AUTH_PASSWORD_CHANGE_REQUIRED` i `401` se rješavaju na nivou `api` klijenta
(redirect na change-password / login), ne u svakoj stranici.

**Zajednički sloj (D-055):**

- **Greške:** svaki pad mrežnog sloja je `ApiError` — mrežni prekid `NETWORK_ERROR` (status `0`),
  ne-JSON odgovor `INTERNAL_ERROR`/`RATE_LIMITED` po statusu, 401 → jedan pokušaj osvježavanja pa
  ponovni zahtjev (važi i za izvoz kroz `apiBlob`). `errorMessage()` prevodi kod, a nepoznat kod
  prikazuje poruku servera (nikad sirov ključ).
- **Ponavljanje:** `shouldRetry` ponavlja samo `NETWORK_ERROR` i 5xx, jednom; 4xx se ne ponavlja.
- **Odjava:** jedna funkcija `clearSession()` (store + keš upita + refresh token) — zovu je
  `forceLogin()`, korisnički meni, promjena lozinke i sinhronizacija tabova.
- **Pohrana:** pristup `localStorage`/`sessionStorage` je zaštićen (blokirana pohrana ne ruši app);
  memorijski fallback drži sesiju do reloada.
- **Utrke sesije i firme:** pri stvarnoj promjeni firme postojeći query podaci se resetuju, a aktivni upiti ponovo učitavaju; tako lista prethodne firme ne ostaje vidljiva dok novi zahtjev čeka ili pada. Izuzetak je keš nepotvrđenog dokumenta, zasebno vezan za sesiju/korisnika/firmu/projekat. Ponovni izbor iste firme ne resetuje keš. Otvoreni Sheet, Dialog i AlertDialog blokiraju stvarnu promjenu firme i čuvaju nacrt; prikazuje se prevedena poruka. Ovo uključuje dijalog prikazane jednokratne lozinke, ali i dijaloge bez forme. Navigacijski Sheet izuzet je da odabir u njemu radi, a drugi istovremeni dijalog i dalje blokira. Nacrti novih količina i dnevničkih unosa te materijala i deponija dodatno blokiraju promjenu dok su montirani i nude izričito odbacivanje. Uspješan upis ili odbacivanje vraća početnu jedinicu odnosno datum; tokom upisa polja/odbacivanje nisu dostupni. Ovo nije puna izolacija (F-CI-05-52): ostali inline oblici, izmjene na blur, ostali lokalni state i zahtjevi nakon zatvaranja/unmounta nisu pokriveni; navigacija ili reload mogu izgubiti nacrt, a obješeni zahtjev blokira izbor dok je komponenta montirana. Prije promjene treba sačuvati ili zatvoriti preostale obrasce, sačekati radnje i provjeriti kontekst. Prije nego lozinka bude prikazana rezultat u toku još nije zaštićen; reset ne može opozvati serverski obrađenu mutaciju. Reset se odnosi na postojeći zajednički QueryClient i standardni setter; drugi klijenti, vanjske izmjene storea i eventualni budući `initialData` nisu obuhvaćeni. Reset svih aktivnih upita izaziva dodatna učitavanja.
- **ERP partner:** nacrt naziva ili promjena tipa blokiraju promjenu firme i ERP kartice te internu data-router navigaciju; browseru se traži unload upozorenje. Korisnik može odbaciti nacrt. Upis onemogućava izmjene/odbacivanje i dvostruki submit; nepoznat ishod zadržava nacrt i zahtijeva potvrdu za retry. API nema idempotentni ključ: prije ponavljanja treba provjeriti da partner već ne postoji. Zatvaranje/browser izlaz je samo upozorenje, sesija i nepredviđeni unmount mogu izgubiti nacrt, a ostali ERP obrasci nisu zaštićeni ovim mehanizmom (F-CI-05-56).
- **Reset lozinke:** potvrda korisnika ostaje otvorena dok zahtjev traje; promjena firme, otkazivanje i dodatni klikovi su blokirani, a uspjeh prikazuje jednokratnu lozinku. Nakon greške postoji mogućnost da je reset već izvršen, pa se prikazuje upozorenje i ne ponavlja automatski; novi pokušaj zahtijeva ponovno otvaranje potvrde. Zaštita vrijedi dok stranica i sesija ostaju aktivne: navigacija, reload, zatvaranje taba, promjena sesije ili izgubljen odgovor mogu izgubiti jednokratnu lozinku. Zahtjev koji nikada ne završi ostaje blokiran; reload ne poništava serversku obradu. Slična zaštita prati i kreiranje korisnika/firme: obrazac čeka odgovor, zadržava unos i nakon greške traži izričitu potvrdu prije omogućavanja ponovnog pokušaja. Dok su ti obrasci, reset potvrda ili jednokratna lozinka otvoreni, data router blokira internu navigaciju i objašnjava razlog; browseru se traži standardno unload upozorenje. Sigurnosna odjava nakon čišćenja sesije nije blokirana. Back po historiji nastaloj izvan data routera nije pouzdano obuhvaćen njegovom blokadom, a cross-document odlazak zavisi od browser upozorenja. Native upozorenje zavisi od browsera i korisnik može izabrati izlaz; promjena sesije, nenajavljen prekid, izgubljen odgovor i nepredviđeni unmount još mogu izgubiti lozinku. Drugi obrasci i kartice osim navedenog ERP partnera nisu obuhvaćeni (F-CI-05-53/54/55 i F-CI-05-52).
- **Zaštita odgovora:** mrežni sloj provjerava generaciju sesije, korisnika i aktivnu firmu prije primjene odgovora i ponavljanja nakon refresh-a. Za platform administratora promjena izbora firme povećava reviziju, pa ni povratak A → B → A ne čini stari odgovor važećim. Stari refresh ne može prepisati ili obrisati novu prijavu; u tom slučaju prikazuje se `SESSION_CHANGED`. Ovo ne poništava zahtjev koji je server već obradio. Jedan tab dijeli refresh u toku za isti token; međutabna rotacija i serverski `revokeAll` ostaju zaseban otvoreni rizik F-FE-06-06.
- **Prijevodi:** `i18n/parity.spec.ts` drži paritet bs/en, vlasništvo sekcija i prijevod svakog
  `ERROR_CODES` sa backenda.

---

## 4. Design system

### 4.1 Trenutno stanje
- Tokeni su CSS varijable → Tailwind `@theme inline` (`--color-primary`, `--color-accent`, …).
- `index.css` definiše i dark varijantu (`@custom-variant dark`), ali je **niko ne aktivira**
  (web je light-only); mrtva grana — čisti se u FE-01.
- Boje iz starih pravila (primary `#1B365D`, background `#F4F1EA`, accent `#C45C26` …) su
  **polazna osnova**, ne obaveza (odluka D-008).

### 4.3 UI primitive — obaveze (D-056)
- **Kontrast sporednog teksta:** `--muted-foreground` (5,02:1 na `--muted`), nikad prozirna varijanta
  glavnog teksta (`text-foreground/60` = 4,26:1 → pada AA).
- **Nijedna oznaka u primitivama nije hardkodirana:** `common.close` kroz `useTranslation`
  (dijalog, šit); parity test drži ključ u oba jezika.
- **Skrolovanje tastaturom:** `Table` kontejner je `role="region"` + `tabIndex={0}` (+ `label` sa
  ekrana), `ScrollArea` viewport je fokusabilan; oba imaju vidljiv fokus.
- **Struktura:** kartice su imenovani regioni (`role="region"` + `aria-label`), `CardTitle` je `div`;
  naslovi ekrana ostaju `h1`/`h2` (bez preskočenih nivoa).
- **Testovi:** primitive se testiraju na uloge/imena/stanja (`primitives.spec.tsx`,
  `overlays.spec.tsx`), a ne na izgled.

### 4.2 Obaveze za novi dizajn (D-008, odobreno)
1. **Nova paleta** je dozvoljena; brend smije evoluirati.
2. Minimalni set tokena: `color.{bg,surface,border,text,muted,primary,primary-fg,accent,
   success,warning,danger,info}`, `radius.{sm,md,lg,xl}`, `space.{…}`, `font.{sans,mono}`,
   `shadow.{sm,md,lg}`, `z.{…}`, `breakpoint.{sm,md,lg,xl}`, `motion.{fast,base,slow}`.
3. **Nijedna sirova vrijednost u komponenti** (`#hex`, `px` za spacing) — samo semantički token.
4. **WCAG 2.2 AA** je obavezan minimum: kontrast 4.5:1 (tekst) / 3:1 (veliki tekst i UI),
   vidljiv fokus (`focus-visible` prsten), ciljne površine ≥ 24×24 px, bez oslanjanja samo na
   boju, poštovanje `prefers-reduced-motion`.
5. Light tema je primarna; dark se uvodi samo ako se odobri (danas nije u obimu).

### 4.4 Pristupačnost (FE-03) — šta je obezbijeđeno

| Zahtjev (WCAG 2.2 AA) | Kako je riješeno | Gdje |
|---|---|---|
| 2.4.7 / 2.4.11 vidljiv fokus | globalni `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` — i za elemente bez `ring` klase | `index.css` (base layer) |
| 2.3.3 animacije | `@media (prefers-reduced-motion: reduce)` skraćuje animacije/transition i gasi `scroll-behavior` | `index.css` |
| 1.3.1 / 3.3.1 / 3.3.2 labele i greške | `Field` vezuje `label ↔ polje ↔ poruka` (`aria-describedby`), greška ide u `role="alert"` i polje dobija `aria-invalid` | `components/field.tsx` |
| 1.3.1 tabele | `TableHead` po defaultu ima `scope="col"` | `components/ui/table.tsx` |
| 2.4.1 preskakanje blokova | skip-link na `#main` + `main` sa `tabIndex={-1}` i fokusom poslije navigacije | `components/layout/app-shell.tsx` (FE-02) |
| 1.4.10 reflow | nema horizontalnog skrola na 320 px (provjerava E2E) | `e2e/a11y.spec.ts` |
| 4.1.2 imena | ikonična dugmad imaju `aria-label` (`aria-hidden` na ikoni) | komponente |

**Namjerno bez `axe`:** uvođenje `@axe-core/playwright` je nova zavisnost i +1 korak u CI-ju; četiri
ciljane provjere (naslov, `aria-invalid` + poruka, vidljiv fokus, reflow) pokrivaju regresije koje su
se stvarno dešavale. `axe` ostaje kandidat u FE-06 (E2E tokovi) uz pisano obrazloženje.

### 4.3 Admin dashboard — obavezan postupak
Prije implementacije: (1) informaciona arhitektura (navigacija, grupe, prečice), (2) wireframe
opis po ekranu, (3) lista komponenti i stanja (loading/empty/error/success) → **odobrenje
vlasnika** → tek onda kod.

---

## 5. Kvalitet i standardi (cilj, uvodi se u FE segmentima)

| Provjera | Danas | Cilj |
|---|---|---|
| Lint | `oxlint` | isto + dodatna pravila (a11y plugin) |
| Format | ❌ nema | `prettier --check` (jedan alat za cijeli monorepo) |
| Tipovi | `tsc -b` u CI-ju | isto + `strict` u svim paketima |
| Tokeni | ❌ nema provjere | skripta pada na sirovim bojama/spacing-u u komponentama |
| A11y | ✅ CSS pravila (fokus, reduced motion) + 4 Playwright provjere (`e2e/a11y.spec.ts`) | `axe` za ključne ekrane (kad se doda zavisnost — FE-06) |
| Testovi | 1 Playwright spec | page objects + fixtures po tokovima (vidi `TESTING.md`) |
| Bundle | nema budžeta | `vite build` + budžet po chunk-u (npr. initial < 250 kB gzip) |

---

## 6. Poznati dugovi (FE segmenti)

| # | Dug | Segment |
|---|---|---|
| F1 | Samo 1 E2E spec (login); nema testova za timer/ture/payroll/settings | FE-06 |
| F2 | Nema unit/component testova (npr. `planned-gantt`, `quantity-tab`, forme) | FE-05 |
| F3 | Nema design token guard-a; sirove boje u nekim komponentama (`❓` mjeri se u FE-01) | FE-01 |
| F4 | ~~Dark varijanta u CSS-u je mrtva~~ **riješeno** u FE-01 (`.dark` tokeni; klasa se još ne dodaje) | FE-01 |
| F5 | ~~Nema a11y provjere~~ **riješeno** u FE-03 (globalni `focus-visible`, `prefers-reduced-motion`, `Field` veže grešku uz polje, `TableHead` `scope="col"`, 4 E2E provjere) | FE-03 |
| F6 | Admin dashboard nije redizajniran (informaciona arhitektura čeka odobrenje) | FE-04 |
| F7 | Nema `prettier`/format provjere; lint je samo oxlint | FE-02 |

### Obavijesti — stanja liste

Panel obavijesti razlikuje učitavanje, grešku sa ponovnim pokušajem i zaista praznu listu; mrežna greška ne smije izgledati kao „Nema obavijesti“.

### Planirani periodi

Gantt prikazuje početak i kraj i kao tekstualne datume; stavke bez valjanog perioda ne crtaju se, a grafičke trake su dekorativne.

### Količine projekta

Pri kreiranju se bira jedinica iz podržane šeme (m³, t, m, m², kom ili h). Neuspjela izmjena izvedene količine vraća prethodno prikazanu spremljenu vrijednost; greška učitavanja ima ponovni pokušaj.

### Kreiranje zadatka

Dispatch prikazuje greške obaveznih polja i greške učitavanja sa ponovnim pokušajem. Bez učitanih projekata nije moguće snimiti; dodjela korisnika je opciona i njeno neuspjelo učitavanje vidljivo je korisniku.

### Projektni dnevnik

Početni dan i mjesec prate vremensku zonu firme; ručni izbor se zadržava. Polja su označena, greška učitavanja nudi ponovni pokušaj, a neuspjela izmjena problema vraća ranije spremljeni tekst.

### Datumi projekta

Brisanje planiranog početka ili kraja u obrascu projekta šalje praznu vrijednost u PATCH, koju backend tretira kao brisanje datuma.

### Opciono uređivanje projekta

Pri izmjeni se kod, lokacija, naručilac i budžet šalju samo ako su promijenjeni; brisanje šalje praznu vrijednost. To ujedno štiti podatke koje API nije uključio u odgovor.

### Javna fotografija projekta

Upload cover fotografije blokiran je dok prethodni traje, uz prikaz statusa; nakon greške moguće je ponovo izabrati isti fajl.

### Kartice projekta

Podaci se učitavaju po aktivnoj kartici, uz stanja učitavanja, greške i ponovnog pokušaja. Promjena kartice ažurira samo query parametar `tab` i čuva ostale parametre. Odgovarajuća prava provjeravaju se prije učitavanja i prikaza podataka; izostanak prava na zadatke naznačen je u Gantt pregledu. Uklanjanje člana i upload dokumenta prijavljuju grešku. Dodavanje članova ima pretragu i stranice te izbor projektne uloge, uz filtriranje neaktivnih i već dodijeljenih. Zadaci, vozila, ture i gorivo koriste stranice; Gantt prikazuje sve faze i samo zadatke odabrane stranice, što je naznačeno uz navigaciju. Povratak na prethodnu stranicu moguć je i kada naredna ne uspije. Dvokoraki upload prati se u CI-05 (F-CI-05-15).

### Ponovno povezivanje projektnih dokumenata

Ako je upload odgovorio putanjom, ali povezivanje s projektom nije potvrđeno, referenca i UUID čuvaju se u memorijskom React Query kešu i nude ponovno povezivanje bez ponovnog uploada. Povratak na projekat u istoj sesiji zadržava stanje čak i nakon unmounta komponente; dok operacija traje isti projekat ne dozvoljava novi upload ili retry iz drugog prikaza koji koristi isti keš. Referenca i završetak operacije vezani su za izvorni projekat, sesiju, korisnika i firmu; nakon promjene konteksta na provjeri ne šalje se sljedeći korak. Prije retryja provjerava se dostupnost liste; ako provjera ne uspije, novi upis se ne šalje. Zatim backend odlučuje prema istom ključu: podudaranje samo po putanji/nazivu ne dokazuje istu operaciju. Ako je taj pokušaj obrisan, poruka objašnjava konflikt i lokalna referenca se uklanja; drugi konflikti zadržavaju mogućnost oporavka. Backend štiti paralelne upise istim ključem. Keš se čisti pri odjavi i odbijenom refreshu; zadržava stanje pri mrežnom prekidu i refresh 429.

Ovo nije potpuno pouzdana idempotentnost: osvježavanje ili zatvaranje kartice gubi memorijski keš, drugi browser tab ima nezavisan keš, nepoznat ishod prvog uploada se ne oporavlja, već poslani zahtjev se ne poništava, zaštita revizijom važi za izbor firme u ovoj kartici preko standardnog store API-ja, ne za vanjske/stare klijente ili proizvoljne direktne izmjene storea, dok su ranije fizički obrisane veze i stari serveri izvan nove tombstone zaštite. Zapisi keša ostaju do čišćenja sesije (bez automatskog GC-a), što omogućava povratak ali koristi memoriju. Praćenje F-CI-05-15 ostaje otvoreno.
