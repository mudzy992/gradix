# PLAN R1c — okvir i dizajn sistem v1 (kratak rez)

**Cilj:** industrijski, oštar, gust dashboard. Bez novih funkcionalnosti. **Kapija:** G1c.

## Odluke koje tražim od tebe prije koda

1. **Tamna tema: NE** (preporuka). Razlog: jedan mjerni set kontrasta, jedan set snimaka, nula
   rizika da „tamna" polovično procuri u R2. Ako kažeš da — radim `data-theme="dark"` kroz iste
   tokene, kontrast test u oba seta, i +12 snimaka.
2. **Tipografija bez mrežnog preuzimanja:** sans = `system-ui` (kao sada), mono =
   `ui-monospace, “SF Mono”, “Cascadia Mono”, “Roboto Mono”, monospace`. **Bez Google Fonts** —
   nema vanjskih resursa (ista odluka kao kod `Referer` pravila u R1a). Ako želiš Inter/IBM Plex,
   to je samohostovan `woff2` u `apps/web/public/fonts` (+2 fajla, `font-display: swap`).

## Šta se mijenja

| Sloj | Sada | R1c |
|---|---|---|
| Tokeni | `--radius-card: .75rem`, `shadow-sm/lg`, `rounded-full` | `--radius: 2px`, `--radius-dialog: 4px`, **nula sjenki**, linije 1 px (`--color-border` za razdjelnik, `border-strong` samo za polja) |
| Okvir | nema — stranice stoje same | `AppShell`: fiksni sidebar 240 px (`--sidebar-w`), sklopiv na 56 px ikone, grupe, aktivna stavka; header sa breadcrumbs, `Ctrl+K` pretraga, korisnički meni |
| Gustina | `gusto` 40/56 px red | web `gusto` = **36 px** red, `udobno` ostaje 56 za teren; ista dva atributa |
| Tipografija | samo sans | `--font-sans` + `--font-mono`; **tabularne cifre** (`font-variant-numeric: tabular-nums`) u tabelama i brojevima |
| Boje | iste vrijednosti | iste vrijednosti; `#140A9A` samo aktivna stavka / primarna akcija, `#FFC82F` samo bedž, fokus, naglasak — **nikad tekst** |

**Test poređenja web/mobilni ostaje i širi se:** isti test koji danas poredi 22 boje dobija i
provjeru da web i mobilni imaju isti `radius` i iste pragove gustine. Nijedna boja se ne mijenja.

## Definicija gotovosti

- **Tastatura:** sidebar (strelicama po stavkama, `Home/End`, `Enter`), `Ctrl+K` (otvara,
  filtrira, `↑↓`, `Enter`, `Esc`), dijalozi (`Esc`, fokus u dijalog, povratak fokusa).
  Sve pokriveno testom (`@testing-library/react`) — ne tvrdnjom.
- **A11y u CI-ju:** `vitest-axe` na renderovanim ekranima (lista korisnika, matrica, audit,
  dijalog, shell) — pad na bilo kojem `serious`/`critical` nalazu. Bez nove usluge, bez preglednika.
- **Snimci svih stanja** na 360 i 1440, **sidebar otvoren i sklopljen** (`docs/design/demo-r1c/`).
- Nijedna funkcionalnost se ne mijenja; svi R1a/R1b testovi prolaze bez izmjene.

## Redoslijed

1. tokeni + `AppShell` + testovi tokena/gustine,
2. tri ekrana preseljena u okvir (korisnici, matrica, audit) — bez diranja logike,
3. tastatura + `vitest-axe` + CI korak,
4. snimci 360/1440 × {sidebar otvoren, sklopljen} × sva stanja,
5. `docs/DEMO-G1c.md` + kapija.

**Ne ulazi:** tamna tema (osim ako kažeš da), nove stranice, izmjena API-ja, izmjena dozvola.
