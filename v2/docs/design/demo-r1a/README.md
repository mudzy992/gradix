# Demo R1a — snimci sva stanja (360 px i 1440 px)

Stanje: 2026-11-08 · baza `gradix_r1b` (seed `nije,kikiriki`) · Next.js `16.0.1`
Snimci su napravljeni stvarnim preglednikom (Chromium), na **stvarnim podacima iz baze**, ne mock.

| Ekran | 360 px | 1440 px | Šta dokazuje |
|---|---|---|---|
| Korisnici — uspjeh | `360-korisnici-uspjeh.png` | `1440-korisnici-uspjeh.png` | gusta tabela ≥ 640, kartice < 640, jedna akcija + „⋯“ |
| Korisnici — prazno (filter) | `360-korisnici-prazno-filter.png` | `1440-korisnici-prazno-filter.png` | prazno stanje kaže šta je prazno i nudi izlaz |
| Korisnici — greška | `360-korisnici-greska.png` | `1440-korisnici-greska.png` | mreža prekinuta samo za `/api/users`; poruka + „Pokušaj ponovo“ |
| Korisnici — učitavanje | `360-korisnici-ucitavanje.png` | `1440-korisnici-ucitavanje.png` | skeleton sa `aria-busy`, ne prazna stranica |
| Pozivnica — dijalog | `360-pozivnica-dijalog.png` | `1440-pozivnica-dijalog.png` | primarno dugme puna širina < 640, `<dialog>` semantika |
| Link izdat | `360-link-izdat.png` | `1440-link-izdat.png` | token se vidi **jednom**, uz upozorenje da se poslije ne može prikazati |
| Prijava | `360-prijava.png` | `1440-prijava.png` | „Zaboravljena lozinka? → administrator“ |
| Prijava — greška | `360-prijava-greska.png` | `1440-prijava-greska.png` | ista poruka za sve slučajeve |
| Prijava — limit | `360-prijava-limit.png` | `1440-prijava-limit.png` | poslije 5 promašaja poruka kaže **stvarni** broj sekundi i sama odbrojava; dugme zaključano |
| Postavi lozinku (link) | `360-postavi-lozinku.png` | `1440-postavi-lozinku.png` | firma, email, rola iz pozivnice |
| Link ne važi | `360-link-nevazeci.png` | `1440-link-nevazeci.png` | istekao = iskorišten = izmišljen (bez razlike) |
| Obavezna promjena | `360-promjena-lozinke.png` | `1440-promjena-lozinke.png` | prva prijava vodi ovdje, ostatak sistema zaključan |

Ukupno: **24 snimka** (12 stanja × 2 širine).

## Kako su napravljeni

`apps/web/scripts/demo-shots.mjs` — Puppeteer, snimke pravi iz žive aplikacije:
prijava kroz `/api/auth/login` (cookie u preglednik), pa prolaz kroz sva stanja.
Chromium i biblioteke nisu u `package.json`; skripta to dokumentuje na vrhu.

## Šta snimci NE dokazuju

- **Ponašanje tastaturom** — to je provjereno ručno i testom fokusa, ali se ne vidi na slici.
- **Čitač ekrana** — nema ga u sandboxu; obilježja (`aria-*`, `role`) su u kodu i u testovima.
- **`udobno` gustina** — na ovim snimcima je `gusto` (web). `udobno` je za teren (mobilni) i
  mijenja se atributom `data-density` bez izmjene komponenti.
- **Pravi telefon** — mobilni ekran nije dio R1a; ovo je web panel.
