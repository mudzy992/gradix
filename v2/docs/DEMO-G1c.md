# DEMO G1c — okvir, oblik, gustina (R1c)

**Datum:** 2026-11-08 · **Stanje:** ✅ prijedlog radi i provjeren je mašinski; **čeka vlasnikovu riječ**

Ovaj demo dokazuje tri stvari: (1) okvir postoji na stvarnim ekranima, (2) **radi bez miša** —
tastatura je testirana, ne izgovorena, (3) pristupačnost je **automatska u CI-ju**, ne
„pregledao sam snimke".

## 1. Šta se pokreće

```bash
cd v2/apps/web
pnpm build && pnpm start -p 3140        # ili: next start -p 3140 -H 0.0.0.0
```

Prijava: `ured@demo.ba` / `SEED_PASSWORD`.

## 2. Tastatura — šta pritisnuti i šta mora da se desi

| Gdje | Tipka | Rezultat |
|---|---|---|
| Bilo gdje | `Tab` (prvi) | „Preskoči na sadržaj“ → `Enter` vodi u `#sadrzaj` |
| Sidebar | `↑` `↓` | fokus ide na prethodnu / sljedeću stavku, ne izlazi iz navigacije |
| Sidebar | `Home` `End` | prva / posljednja stavka |
| Bilo gdje | `Ctrl+K` (`Cmd+K`) | otvara „Brza navigacija“, fokus u polje |
| Brza navigacija | kucanje | filtrira stavke po nazivu i opisu |
| Brza navigacija | `↑` `↓` `Enter` | izbor i prelazak na ekran |
| Brza navigacija | `Esc` | zatvara, fokus se vraća na dugme koje je otvorilo pretragu |
| Red korisnika | `Enter` na „⋯“ | otvara meni; `Esc` zatvara i vraća fokus na „⋯“ |
| Dijalog „Role i opseg“ | `Esc` | zatvara dijalog, fokus se vraća na „⋯“ (ne na `<body>`) |
| Dijalog | `Tab` kroz polja | fokus ostaje unutar dijaloga; „Sačuvaj“ je zaključan dok ništa nije promijenjeno |
| Dijalog „Detalj zapisa“ (audit) | `Esc` | zatvara, fokus se vraća na „Otvori“ |

## 3. Kako je to provjereno (ne tvrdnjom)

| Provjera | Komanda | Rezultat |
|---|---|---|
| Tastatura okvira | `pnpm --filter @gradix/web test src/components/shell.test.tsx` | 10 testova |
| Tastatura i a11y liste korisnika + dijaloga | `... test src/app/ured/korisnici/users-client.test.tsx` | 9 testova |
| Audit: filteri, „Učitaj još“, dijalog, a11y | `... test src/app/ured/audit/audit-client.test.tsx` | 7 testova |
| Matrica: pregled, greška, prazno, a11y | `... test src/app/ured/role/roles-client.test.tsx` | 4 testa |
| Dizajn pravila (radijus, sjene, gustina, mono, tabularne cifre, hex u komponentama) | `... test src/design/tokens.test.ts` | 12 testova |
| **A11y korak u CI-ju** | `pnpm test:a11y` | 30 testova (4 fajla) |
| Sve zajedno | `pnpm test` | **135** (34 domain, 10 db, 82 web, 9 mobile) |

Prag a11y: pad na `serious` ili `critical` (WCAG 2.0/2.1 A + AA). `moderate` se ne obara jer
gusta tabela namjerno ima male mete — odluka je u `apps/web/src/test/axe.ts`, na jednom mjestu.

**A11y korak je u CI-ju** (`.github/workflows/ci-v2.yml`, korak „Pristupačnost i tastatura“).
Zato ovaj demo ne traži da vjeruješ snimku: pad a11y testa obara build.

## 4. Snimci svih stanja

`docs/design/r1c-predlog/` — 14 PNG, 360 i 1440, sidebar otvoren i sklopljen (na 360: drawer
otvoren/zatvoren) za korisnike, matricu i audit, plus `Ctrl+K` na obje širine. Detalji i odluke:
`docs/design/r1c-predlog/README.md`.

## 5. Šta demo NAMJERNO ne dokazuje

- **Čitač ekrana u pravom okruženju** (NVDA/VoiceOver) — nije snimljen; axe pokriva mašinski
  provjerljiv dio, a test pokriva fokus i landmarks.
- **Tamnu temu** — nema je (preporuka „ne“, čeka tvoju potvrdu).
- **Dodir na pravom telefonu** — 360 px je viewport, ne uređaj.
- **Nove funkcionalnosti** — nijedna nije dodata; svi R1a/R1b testovi prolaze bez izmjene.

## 6. Šta tražim od tebe

1. Prihvataš okvir sa snimaka ili tražiš izmjene (uz naziv snimka).
2. Tamna tema: da / ne.
3. Fontovi: bez mreže (preporuka) ili samohostovan Inter/IBM Plex.

Poslije toga: kapija G1c, pa `packages/contracts`, pa R2.
