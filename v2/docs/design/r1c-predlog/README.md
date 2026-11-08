# R1c — prijedlog okvira (JEDAN, na stvarnim ekranima)

**Datum:** 2026-11-08 · **Stanje:** prijedlog radi na stvarnim ekranima; čeka tvoju riječ.
**Plan:** `docs/PLAN-R1c.md` · **Snimci:** ovaj folder (14 PNG)

Ovo nije maketa. Okvir je u kodu i pokreće se; snimci su sa demo servera (`ured@demo.ba`), na
stvarnim podacima. Ono što vidiš je ono što bih zaključao.

## Šta gledaš (14 snimaka)

| Širina | Ekran | Sidebar | Fajl |
|---|---|---|---|
| 1440 | Korisnici | otvoren | `1440-korisnici-sidebar-otvoren.png` |
| 1440 | Korisnici | sklopljen (ikone) | `1440-korisnici-sidebar-sklopljen.png` |
| 1440 | Matrica rola | otvoren / sklopljen | `1440-matrica-sidebar-{otvoren,sklopljen}.png` |
| 1440 | Audit trag | otvoren / sklopljen | `1440-audit-sidebar-{otvoren,sklopljen}.png` |
| 1440 | Brza navigacija | `Ctrl+K`, utipkano „mat“ | `1440-ctrl-k.png` |
| 360 | Korisnici | drawer otvoren / zatvoren | `360-korisnici-sidebar-{otvoren,zatvoren}.png` |
| 360 | Matrica rola | drawer otvoren / zatvoren | `360-matrica-sidebar-{otvoren,zatvoren}.png` |
| 360 | Audit trag | drawer otvoren / zatvoren | `360-audit-sidebar-{otvoren,zatvoren}.png` |
| 360 | Brza navigacija | preko cijelog ekrana | `360-ctrl-k.png` |

Na telefonu „sklopljen“ ne postoji — drawer je ili otvoren ili zatvoren (sklapanje na ikone od
56 px na 360 px nema smisla i dugme „Skupi“ je tamo sklonjeno).

## Odluke utkane u prijedlog

1. **Oblik:** radijus 2 px, dijalog 4 px, linije 1 px. **Nula sjenki, nula gradijenata, nula
   pilula.** Bedž role je pravougaonik sa 1 px ivicom, ne pilula.
2. **Boje:** tvoja paleta, bez izmjena. `#140A9A` = primarna akcija („+ Pozovi osobu“) i aktivna
   stavka (lijeva 2 px traka + svijetla podloga). `#FFC82F` = samo fokus i naglasak, **nikad
   tekst**. Nijedna komponenta ne sadrži hex — sve ide kroz tokene.
3. **Gustina:** web `gusto` = **36 px red**, kontrola 32 px. Terenski `udobno` ostaje 56/48 px.
   Cifre u tabelama su tabularne (kolone stoje).
4. **Tipografija:** sans = `system-ui`; mono = `ui-monospace…` za šifre, ID-jeve i brojeve.
   **Bez mrežnog preuzimanja fontova** (nema vanjskih resursa).
5. **Tamna tema: preporuka NE** — jedan mjerni set kontrasta, jedan set snimaka. Ako kažeš da,
   radim `data-theme="dark"` kroz iste tokene + kontrast u oba seta + 12 novih snimaka.

## Šta je provjereno, a šta ne

**Provjereno (mašinski):**
- Tastatura: sidebar (strelice, `Home/End`), `Ctrl+K` (filter, `↑↓`, `Enter`, `Esc`, povratak
  fokusa), meni reda i dijalog (`Esc`, fokus ulazi i vraća se na dugme koje ga je otvorilo).
  **10 testova** u `apps/web/src/components/shell.test.tsx`, **9** u `users-client.test.tsx`,
  **7** u `audit-client.test.tsx`.
- A11y: `axe` (WCAG 2.1 AA) na okviru, listi korisnika, matrici, audit tragu i oba dijaloga —
  pad na `serious`/`critical`. **30 testova** pod `pnpm test:a11y`, korak u CI-ju.
- Dizajn pravila kao test: radijus, nula sjenki, tabularne cifre, mono font, zabrana heksa u
  komponentama, zabrana akcenta kao teksta — **12 testova** u `apps/web/src/design/tokens.test.ts`.
- Ukupno **135 testa** (bilo 93), `pnpm lint` 0, `pnpm typecheck` 4/4, `next build` prolazi.

**Nije provjereno:**
- **Čitač ekrana na pravom uređaju** (NVDA/VoiceOver). axe hvata mašinski provjerljivo; red
  fokusa i landmarks su pokriveni testom, ali izgovor nije snimljen.
- **Kontrast u tamnoj temi** — nema je, po preporuci.
- **Dodir na pravom telefonu** — snimci su 360 px viewport, ne uređaj.

## Šta tražim od tebe

1. **Da li prihvataš ovaj okvir** kakav je na snimcima, ili tražiš izmjene (piši uz naziv
   snimka — npr. „na 360 header je previsok“).
2. **Tamna tema:** potvrda „ne“ ili „da“ (ako da, +12 snimaka i kontrast u oba seta).
3. **Fontovi:** potvrda „bez mreže“ ili želiš samohostovan Inter/IBM Plex (+2 `woff2` fajla).

Poslije tvoje riječi: `docs/DEMO-G1c.md` sa svim stanjima i kapija G1c. Zatim `packages/contracts`,
pa R2. Izmjene okvira ne diraju funkcionalnost — nijedna odluka ovdje ne mijenja API ni dozvole.
