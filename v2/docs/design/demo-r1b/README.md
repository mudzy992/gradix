# Demo R1b — snimci sva stanja (360 px i 1440 px)

Stanje: 2026-11-08 · baza `gradix_r1b` (seed `nije,kikiriki`) · Next.js `16.0.1`
Snimci su napravljeni stvarnim preglednikom (Chromium) na **stvarnim podacima iz baze**, ne mock.
Skripta: `apps/web/scripts/demo-shots-r1b.mjs` (R1a ima svoju, `demo-shots.mjs`).

| Ekran | 360 px | 1440 px | Šta dokazuje |
|---|---|---|---|
| Matrica rola — uspjeh | `360-matrica-uspjeh.png` | `1440-matrica-uspjeh.png` | tabela ≥ 640, kartice < 640; matrica je građena iz `PERMISSIONS` |
| Matrica rola — greška | `360-matrica-greska.png` | `1440-matrica-greska.png` | mreža prekinuta samo za `/api/roles`; poruka + „Pokušaj ponovo“ |
| Matrica rola — učitavanje | `360-matrica-ucitavanje.png` | `1440-matrica-ucitavanje.png` | skeleton, ne prazna stranica |
| Zaštićen red | `360-red-zasticen.png` | `1440-red-zasticen.png` | vlasnika i sebe admin ne može mijenjati — nema menija, piše „samo vlasnik“/„vi“ |
| Dijalog „Role i opseg“ | `360-dijalog-role.png` | `1440-dijalog-role.png` | role (checkbox) + opseg (radio); primarno dugme puna širina < 640 |
| Dijalog — greška | `360-dijalog-greska.png` | `1440-dijalog-greska.png` | greška ostaje **u** dijalogu, forma se ne zatvara; dijalog se skroluje sam |
| Audit — uspjeh | `360-audit-uspjeh.png` | `1440-audit-uspjeh.png` | filteri, bosanski nazivi radnji, „Učitaj još“ (keyset) |
| Audit — detalj | `360-audit-detalj.png` | `1440-audit-detalj.png` | `metadata` zapisa, bez tajni; `Escape` zatvara |
| Audit — prazno (filter) | `360-audit-prazno-filter.png` | `1440-audit-prazno-filter.png` | prazno stanje kaže koji filter je prazan i nudi izlaz |
| Audit — greška | `360-audit-greska.png` | `1440-audit-greska.png` | mreža prekinuta za `/api/audit` |
| Audit — učitavanje | `360-audit-ucitavanje.png` | `1440-audit-ucitavanje.png` | skeleton |
| Zabrana (šef gradilišta) | `360-zabrana-role.png` | `1440-zabrana-role.png` | `/ured/role` **preusmjerava** na `/pregled` — ekran nije samo sakriven u meniju |

Ukupno: **24 snimka** (12 stanja × 2 širine).

## Šta snimci NE dokazuju

- **Ponašanje tastaturom** — fokus u dijalog, `Escape`, povratak fokusa su u kodu i u testu, ali
  se ne vide na slici.
- **Čitač ekrana** — nema ga u sandboxu; `aria-*` i `role` su u kodu.
- **`udobno` gustina** — snimci su u `gusto` (web). Gustina se mijenja atributom `data-density`.
- **Pravi telefon** — ovo je web panel; mobilni ekran nije dio R1b.
- **Sesija bez prava na audit** — pokriveno testom (`WORKER` → 403), ne snimkom.
