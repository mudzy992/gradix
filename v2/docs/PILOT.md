# Pilot — vlasnik testira sve role

**Odluka vlasnika:** pilot = vlasnik testira **sve role** na Expo Go / emulatoru protiv
`https://gradix.ba101.top` (**DA**). Isporuka mobilnog: **Expo Go** (zadano); developer build
opciono kasnije. Sintetički podaci (`.test`). Telefon i rotacija tajni **nisu** uslov ovog
pilota (rotacija → COOLIFY §13, prije produkcije / stvarnih podataka).

## Ko učestvuje
- **Vlasnik** testira naloge po ulogama (web + Expo Go/emulator). **Radi (STATUS.md):**
  R1–R4a-2, Pregled, Uvoz, Radni dani, mobilni Moj dan / Grupa.
- Seed nalozi: vidi `MOBILE-EXPO-GO.md` (samo `.test`, bez lozinki u chatu).

**Ne radi još u pilotu (namjerno):** R4b (samo plan na odobrenju), R5 (stacionaža, partneri,
opšti workflow), partneri.

## Priprema
1. Staging seed (`@demo.test`) — **radi (STATUS.md)** (seed/prijava **PROŠLO**).
2. Expo Go / emulator po `MOBILE-EXPO-GO.md`, API `https://gradix.ba101.top`.
3. Prva prijava **uz mrežu**.

## Kontrolna lista prvog dana (vlasnik, po ulozi)

Web: `https://gradix.ba101.top`. Matrica: `permissions.ts` + STATUS Role; mobilni: `mobile-nav.ts`.

| Uloga | Prijava → ekran | Mora vidjeti | Ne smije vidjeti |
|---|---|---|---|
| OWNER/ADMIN (ured) | web → `/pregled`, `/ured/*` | Pregled; Projekti; Rokovi; Mašine; Radnici; **Uvoz**; Radni dani; Sukobi; **Korisnici**; Pristup i role; Audit | tuđe tenant podatke (RLS); R4b/R5 ekrane (**ne radi još**) |
| SITE_SUPERVISOR (šef) | mobilni → početni | **Grupa** (uz workerId + foremanScope); opseg ekipe; Moj dan ako je vezan na radnika; Moji rokovi/projekti | **Korisnici**, **Uvoz**, Audit, Pristup i role; tuđu firmu |
| WORKER / ostale role | mobilni ili web po matrici | Moj dan (ako workerId); rokovi/projekti u opsegu | Grupa (nije šef); Korisnici/Uvoz |

**Offline (Moj dan / Grupa)** — **radi (STATUS.md / MOBILNI-CHECKLISTA):** prva prijava online;
bez veze → „Čeka slanje”; „Pošalji sada” kad veza dođe.

**Prvi dan ček:** [ ] prijava po ulogama; [ ] jedan unos vidljiv uredu u Radnim danima;
[ ] offline probni unos pa sync (emulator/Expo Go).

## Šta mjerimo
Radni dani, Pregled/Sukobi, Audit; neposlani zapisi na klijentu — **radi (STATUS.md)**.
R4b metrike odobravanja — **ne radi još**.

## Ako pilot ne uspije
Ured izvozi radne dane; rad se vraća starom načinu. Lokalni zapisi ostaju do deinstalacije.

## Plan 2c — uvoz projekata (proširenje R2 uvoza)

**Status:** ODOBREN (vlasnik). Vrsta u 2c: **samo `projects`**. **Radi (STATUS.md).**

**Već postoji (R2):** `/ured/uvoz` — `workers` / `equipment`; parser; mapiranje;
pregled bez upisa; potvrda u jednoj transakciji; audit; testovi. 2c dodaje `projects`.

**Model:** `projects` (r3); uvoz kroz `withCompany`. Uvoz **ne** uvodi stacionažu,
partnere ni opšti B15 workflow (B15 NE → R5) — **ne radi još**.

### Kolone uvoza projekata (iz šeme `projects`)

| Polje | Obavezno | Aliasi (primjeri) | Napomena |
|---|---|---|---|
| `code` | da | šifra, oznaka, code | jedinstvena u firmi; 1–40 |
| `name` | da | naziv, ime, name | do 200 |
| `status` | ne | status, stanje | default ACTIVE; nepoznat → greška |
| `site_address` | ne | adresa, lokacija | do 300 |
| `site_place` | ne | mjesto, grad | do 120 |
| `starts_on` | ne | početak, datum početka | datum |
| `ends_on` | ne | kraj, završetak | ≥ početak |
| `manager` | ne | rukovodilac, voditelj | postojeći radnik (ime+prezime) |
| `note` | ne | napomena, note | do 2000 |

**Tok:** otpremi → vrsta Projekti → mapiranje → pregled → potvrda (sve ili ništa).

**Van obima 2c:** partneri (R5); stacionaža (R5); OCR; situacije; GeoJSON; PII u repou.
(R4b = zaseban plan u `PLAN-R4.md` §11, ne dio 2c.)
