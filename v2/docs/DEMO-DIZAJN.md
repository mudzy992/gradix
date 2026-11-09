# Demo za kapiju dizajna v2 — šta pokazati i šta provjeriti

**Trajanje:** 10 minuta. **Cilj:** vlasnik sam prođe tok u **obje teme**, na 1440 i na 360.

Izvor istine za sve što se vidi: `docs/design/DESIGN.md` + `docs/design/reference.html`.
Snimci postojećih stanja i odobrenog R4a-1 dizajna: **`docs/demo-dizajn/`** (68 postojećih
slika + 4 R4a-1 pregleda = 72). R4a-1 dizajn je odobren „ovako“; implementacijske kapije su u
`docs/PLAN-R4.md`.

## 1. Gdje se prolazi

**Lokalno** (kako su snimci i napravljeni):

```bash
cd v2
DATABASE_URL=postgresql://gradix_app:app@127.0.0.1:5432/gradix_r1b \
AUTH_SECRET=lokalni-razvoj-secret-min-32-znaka-123456 \
pnpm --filter @gradix/web build && \
DATABASE_URL=... AUTH_SECRET=... pnpm --filter @gradix/web start -p 3140
```

Prijava: **`ured@demo.ba`** / `SEED_PASSWORD`. Ako je limit prijave aktivan (5 pokušaja / 60 s),
poruka na ekranu nosi broj sekundi — ne treba čistiti bazu.

**Mobilni ekran** (isti tokeni, ista pravila):

```bash
cd v2/apps/mobile
EXPO_PUBLIC_API_URL=http://<računar>:3000 npx expo start --web --port 8090   # bez telefona
npx expo start                                                                # Expo Go, SDK 58
```

## 2. Šta pogledati (redom)

| # | Provjera | Gdje |
|---|---|---|
| 1 | Tema prati sistem; prekidač mijenja odmah; izbor preživi osvježavanje | gornja traka, dugme s mjesecom |
| 2 | Nijedna boja nije nova — sve je iz šest boja palete | bilo koji ekran, obje teme |
| 3 | Fokus je vidljiv (`--link`, 2 px) i prolazi AA u obje teme | `Tab` kroz navigaciju i formu |
| 4 | Cijeli okvir radi tastaturom: `Ctrl+K` pretraga, strelice/`Home`/`End` u meniju, `Esc` zatvara | bilo koji ekran |
| 5 | Ista tabela na 360 prelazi u kartice (ništa nije odsječeno) | Korisnici, Audit trag |
| 6 | Mobilni: velika akcija ≥ 56 dp, mono brojevi, ista tema | `apps/mobile` |

## 3. Snimci i kako se prave

```bash
LD_LIBRARY_PATH=/tmp/chlibs/lib BASE=http://127.0.0.1:3140 \
  node apps/web/scripts/demo-shots-dizajn.mjs
```

Skripta pravi 17 stanja × {1440, 360} × {svijetla, tamna} i četiri statička R4a-1 pregleda iz
`docs/design/reference.html`, ukupno 72 PNG-a u `docs/demo-dizajn/`. Tri stanja (prazno, greška,
učitavanje) ne postoje u demo bazi, pa skripta za njih presreće
mrežu i vraća **isti ugovor koji API stvarno vraća**; ekran i stilovi su stvarni.
Stanja koja ne mijenjaju bazu (pogrešna lozinka, nevažeći link) rade bez presretanja.

## 3a. R4a-1 design gate — odobren „ovako“

U `docs/design/reference.html#r4a1-reference` dodana su dva predložena ekrana: radnik na 360 px
(unos vlastitog dana, otvoreni segment i outbox) i ured na 1440 px (read-only dani, uključujući
`UNKNOWN_END` oznaku). Svaki ima svijetlu i tamnu varijantu; četiri PNG pregleda su:

- `docs/demo-dizajn/360-light-r4a1-worker.png`
- `docs/demo-dizajn/360-dark-r4a1-worker.png`
- `docs/demo-dizajn/1440-light-r4a1-office.png`
- `docs/demo-dizajn/1440-dark-r4a1-office.png`

Imena, projekat i mašina su iz seed-a Niskogradnja Demo; datumi i segmenti su samo ilustrativni,
ne stvarni R4 podaci. Klikni četiri veze u odjeljku R4a-1 unutar reference za pune prikaze.
Vlasnik je izričito odobrio postojeći dizajn „ovako“; grupni unos šefa ostaje R4a-2.

## 4. Odstupanja — **odobrena 2026-11-08, referenca dopunjena**

`reference.html` pokriva: okvir i gornju traku, dugmad, polja, segment, chip, tabelu, rokove,
poruku i mobilni ekran. **Ne pokriva** ovo, a ekrani ga imaju:

| # | Element | Kako je riješeno (bez novog jezika) | Snimak |
|---|---|---|---|
| 1 | Dijalozi (pozivnica, role i opseg, detalj audita) | ploča 18 px na zatamnjenoj pozadini, iste primitive | `1440-*-korisnici-dijalog` |
| 2 | Prazna stanja | isprekidana ivica, naslov + jedna rečenica + jedna akcija | `*-korisnici-prazno`, `*-audit-prazno` |
| 3 | Učitavanje | skeleton trake u ploči, bez teksta i bez spinnera | `*-korisnici-ucitavanje` |
| 4 | Ekran prijave | ploča na pozadini, bez okvira (prije prijave nema navigacije) | `*-login` |
| 5 | Promjena / postavljanje lozinke | ista ploča i polja kao forma; nevažeći link = poruka + jedna rečenica | `*-lozinka-*` |
| 6 | Matrica rola (Pristup i role) | tabela bez zebre, iste ćelije kao Korisnici | `*-role` |
| 7 | Drawer ispod 960 px | sidebar klizi preko sadržaja, `Esc` i klik van zatvaraju | `360-*-korisnici-drawer` |
| 8 | Mobilni ekran | ista tipografija i teme; umjesto „Počni radni dan“ je stvarna akcija R0 („Sačuvaj zapis“) + pločica reda za slanje | `apps/mobile` |

Dopuna reference u istom commitu: `docs/design/reference.html` (tokeni `--danger`, `--danger-soft`,
`--success`, `--success-soft`, `--warn-soft`, `--scrim`, `--sunken`, `--shadow-lift`; sekcija
„Dijalozi, stanja i prijava“; drawer s hamburgerom; `table.cards`; mobilni sa stvarnom akcijom) i
`docs/design/DESIGN.md` (§ Stanja i slojevi, § Mobilni).

**Vlasnik je 2026-11-08 prihvatio sve osam** kao „isto, bez novog jezika“. `reference.html` je
zato dopunjen u istom commitu: tokeni stanja (`--danger`, `--danger-soft`, `--success`,
`--success-soft`, `--warn-soft`, `--scrim`, `--sunken`, `--shadow-lift`), sekcija „Dijalozi,
stanja i prijava“, drawer ispod 960 px s hamburgerom, tabela→kartice ispod 640 px i mobilni
ekran sa stvarnom akcijom R0. Pisana pravila su u `docs/design/DESIGN.md` (§ Stanja i slojevi).

## 5. Šta je provjereno, a šta nije

**Provjereno:** `pnpm test` 152 testa (db 10, domain 34, mobile 20, web 88) · `pnpm test:a11y`
33 · `lint` 0 · `typecheck` 4/4 · `next build` sve rute · snimci u obje teme na 1440 i 360 ·
mobilni ekran pokrenut na webu (`expo export -p web` + `expo start --web`), obje teme.

**Nije provjereno:** mobilni na **stvarnom uređaju / u Expo Go** (u sandboxu nema emulatora ni
telefona) — provjereno je samo web izdanje istog koda. Fontovi su na uređaju statičke instance
istih fajlova (vidi `apps/mobile/assets/fonts/`), ali to nije isto što i pogled na telefonu.
