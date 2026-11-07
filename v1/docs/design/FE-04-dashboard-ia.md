# FE-04 — Admin dashboard: informaciona arhitektura (IA) i redizajn

> **Status:** primijenjeno (2026-11-03). Odluka **D-043**. Obim: **jedan ekran** (`/dashboard`) na
> novim tokenima (D-040) i uz a11y pravila (FE-03). Ostali ekrani idu po segmentima FE-07…FE-13 —
> oni nasljeđuju isti shell, iste primitive i ista pravila stanja.

## 1. Za šta dashboard postoji

Dashboard nije „početna sa svime“, nego odgovor na **tri pitanja u dvije sekunde**, i to različito
po roli (rola već određuje kartice na backendu — `dashboard-role.ts`, BE-12):

1. **Šta kasni / šta ističe?** (rokovi, dokumenti, dozvole)
2. **Ko je na terenu?** (prisustvo po projektima)
3. **Koliko trošimo i koliko je otvoreno?** (budžet, timer-i, obavijesti)

Sve ostalo je jedan klik dalje — dashboard **ne** zamjenjuje listu projekata ni zadataka.

## 2. Zone ekrana (redoslijed = prioritet)

| Zona | Sadržaj | Pravilo |
|---|---|---|
| **A — Zaglavlje** | `h1` Dashboard, pozdrav s imenom, današnji datum (prema jeziku interfejsa) | datum je kontekst, ne dekoracija; nema sata/lica u realnom vremenu |
| **B — Brze akcije** | do 4 stavke iz navigacije (Projekti, Zadaci, Dnevnik, Flota/HSE/Dokumenti…) | ista vidljivost kao sidebar (`isNavItemVisible` + `tenantReady`) — nikad prečica do ekrana koji korisnik ne smije otvoriti |
| **C — KPI traka** | kartice koje backend vrati za rolu (2–5) | kartica je **link** kad postoji ciljna stranica; vrijednost ide kroz `dash()` (locale brojevi); `null` = „—“, ne „0“ |
| **D — Rokovi i dokumenti** | istekli i oni koji ističu, sortirano po hitnosti | istekli ostaju vidljivi (BE-12: do 90 dana unazad); boja **nije** jedini signal — piše i „isteklo prije X d“ |
| **E — Na terenu** | prisustvo (ime + inicijali), broj ljudi | prazno stanje je eksplicitno („nema nikoga na terenu“), ne prazna kutija |
| **F — Stanja** | loading skeleton, greška + „Pokušaj ponovo“, prazno stanje | greška nije toast koji nestane — ostaje na ekranu dok korisnik ne pokuša ponovo |

**Šta dashboard ne prikazuje (svjesno):** grafikone trendova (traže nova agregiranja na backendu),
„moje zadatke“ kao listu (traži novi endpoint sa rokovima po zadatku), widgete koje korisnik može
prevlačiti (nema dokazanog zahtjeva, a uvodi stanje po korisniku), brojače u realnom vremenu preko
Socket.IO (dashboard se osvježava pri otvaranju; realtime ostaje za obavijesti).

## 3. Raspored (grid)

```
┌──────────────────────────────────────────────────────────────────────┐
│ A  Dashboard · Dobrodošli, Amir.            utorak, 3. novembar 2026 │
│ B  [Projekti] [Zadaci] [Dnevnik] [Flota]                             │
├──────────┬──────────┬──────────┬──────────┐   ← C: 2–5 kartica, 1 red │
│ KPI      │ KPI      │ KPI      │ KPI      │                          │
├───────────────────────────────┬──────────────┤                       │
│ D  Rokovi i dokumenti          │ E  Na terenu │                      │
│    (do 6, sortirano)           │    (chips)   │                      │
└───────────────────────────────┴──────────────┘                       │
       1 kolona < md · 2 kolone ≥ md · KPI 2 < sm, 4 ≥ xl
```

## 4. Komponente i stanja

| Element | Komponente | Stanja |
|---|---|---|
| Zaglavlje | `h1`, `p` | — |
| Brze akcije | `Button` (`variant="secondary"`, `asChild` + `Link`) | skriveno ako nema vidljivih stavki |
| KPI kartica | `Card`, ikona (`lucide`), `Link` | loading (skeleton), `null` vrijednost, greška cijelog upita |
| Rokovi | `Card`, `Badge`, lista | prazno („Nema dokumenata koji ističu.“), isteklo (destructive), ≤ 5 d (destructive), ≤ 15 d (warning), ostalo (muted) |
| Prisustvo | `Card`, `Avatar`, `Badge` (broj) | prazno, bez prisustva („nema nikoga na terenu“) |

## 5. Pristupačnost (FE-03 pravila primijenjena)

- Svaka zona je `<section>` sa `aria-labelledby` na svom `h2`; `h1` je samo jedan.
- Boja nikad nije jedini nosilac značenja: uz crveno/amber ide tekst („isteklo prije 3 d“).
- Kartica-link ima vidljiv fokus (globalni `:focus-visible`, FE-03) i cijela površina je klikabilna.
- Greška je `role="alert"`; skeleton koristi `aria-busy="true"` na kontejneru.
- Reflow na 320 px: KPI grid prelazi u 1 kolonu (provjerava Web E2E).

## 6. Šta je popravljeno usput (nalazi FE-04)

| Nalaz | Prije | Poslije |
|---|---|---|
| Naslovi KPI kartica nisu bili prevedeni (`t('dash.<key>')` bez ijednog ključa) — ekran je prikazivao `dash.activeProjects` | `frontend/src/i18n/bs.ts` nije imao `dash` sekciju | dodata `dash` sekcija u **bs** i **en** za svih 11 ključeva koje backend vraća |
| Lista rokova nije razlikovala istekle od onih koji ističu | svi isti stil, `daysLeft` sirov | hitnost je izražena bojem **i** tekstom, istekli ostaju na ekranu |
| Nema loading/error/praznih stanja — prazna kutija izgleda kao „nema podataka“ | `cards ?? []` | skeleton, `role="alert"` + retry, eksplicitna prazna stanja |
| Prisustvo je bilo gola lista imena | lista `<li>` | avatar-inicijali + ime, broj ljudi, prazno stanje |
| Ekran nije imao brze akcije — do zadataka se išlo kroz sidebar | — | do 4 prečice, filtrirane istim pravilom kao navigacija |
