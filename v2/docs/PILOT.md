# Pilot — probni rad (oblik A)

**Odluke vlasnika (2026-11-17):** oblik **A** = jedan Android telefon za šefa; trajanje **5 dana**;
rotacija svih tajni **prije stvarnih podataka = DA**. Dok rotacija nije urađena → samo
**sintetički** demo (domene `.test` / seed, bez stvarnih ličnih podataka).

## Ko učestvuje
- **Vlasnik/ured (1):** web na `https://gradix.ba101.top` — pozivnice, uvoz, pregled dana/sukoba.
  Rola OWNER (ili ADMIN). **Radi (STATUS.md):** R1–R4a-2, Pregled, Uvoz, Radni dani.
- **Šef gradilišta (1):** jedan Android telefon — grupni unos ekipe. Rola SITE_SUPERVISOR.
  **Radi (STATUS.md):** R4a-2 Grupa / Moj dan (mobilni).
- **Radnici:** u obliku A **bez vlastitih telefona/naloga** — šef ih vodi u Grupi.
  **Ne radi još** kao zasebni pilot-uređaji (to bi bio drugi oblik).

**Ne radi još u pilotu (namjerno):** R4b, R5 (stacionaža, partneri, workflow), partneri.

## Priprema (prije prvog dana)
1. Rotacija tajni urađena **ili** ostaje samo sintetički seed (odluka: DA prije stvarnih).
2. Ured na `https://gradix.ba101.top` uvozi sintetičke radnike/mašine/projekte (**Uvoz** —
   **radi (STATUS.md)**) i pozove šefa (**Korisnici** — **radi (STATUS.md)**).
3. Šef instalira mobilnu app po `MOBILE-EXPO-GO.md` i prijavi se **jednom uz mrežu**.
4. Telefon zaključan PIN-om/otiskom.

## Kontrolna lista prvog dana (vlasnik, po ulozi)

Web: `https://gradix.ba101.top`. Matrica: `permissions.ts` + STATUS Role; mobilni meni: `mobile-nav.ts`.

| Uloga | Prijava → ekran | Mora vidjeti | Ne smije vidjeti |
|---|---|---|---|
| OWNER/ADMIN (ured) | web → `/pregled`, `/ured/*` | Pregled; Projekti; Rokovi; Mašine; Radnici; **Uvoz**; Radni dani; Sukobi; **Korisnici**; Pristup i role; Audit | tuđe tenant podatke (RLS); R4b/R5 ekrane (**ne radi još**) |
| SITE_SUPERVISOR (šef, Android) | mobilni → početni | **Grupa** (uz workerId + foremanScope); opseg ekipe; Moj dan ako je vezan na radnika; Moji rokovi/projekti | **Korisnici**, **Uvoz**, Audit, Pristup i role (nema `users.manage` / `workers.manage`); tuđu firmu |
| WORKER (nije u obliku A) | — | — | nema uređaja u ovom pilotu |

**Offline (Moj dan / Grupa)** — **radi (STATUS.md / MOBILNI-CHECKLISTA):** prva prijava online;
bez veze unos → „Čeka slanje“ / banner Bez veze; „Pošalji sada“ kad veza dođe; rokovi/projekti
pokazuju zadnje preuzeto uz „Nema veze…“. Van opsega ostaje na telefonu (nije odbijen).

**Prvi dan ček:** [ ] šef prijavljen; [ ] jedan grupni unos vidljiv uredu u Radnim danima;
[ ] offline probni unos pa sync.

## Šta reći pilot-korisnicima
- Zaključavanje ekrana obavezno. Problem isti dan vlasniku (šta, poruka, screenshot).
- Bez mreže se radi; „Pošalji sada“ kad veza dođe. Samo sintetički podaci dok tajne nisu rotirane.

## Šta mjerimo (za 5 dana, bez ulaska u bazu)
Iz aplikacije: Radni dani, Pregled/Sukobi, Audit; na telefonu neposlani zapisi.
Cilj: unosi/dan (grupni), broj/starost sukoba, otvoreni dani, greške sync — **radi (STATUS.md)**
pregled tih ekrana. R4b metrike odobravanja — **ne radi još**.

## Ako pilot ne uspije
Aplikacija se gasi; ured izvozi radne dane; rad se vraća starom načinu. Lokalni zapisi na
telefonu ostaju do deinstalacije.

## Plan 2c — uvoz projekata (proširenje R2 uvoza)

**Status:** ODOBREN (vlasnik). Vrsta u 2c: **samo `projects`**. **Radi (STATUS.md).**

**Već postoji (R2):** `/ured/uvoz` — `workers` / `equipment`; parser; mapiranje;
pregled bez upisa; potvrda u jednoj transakciji; audit; testovi. 2c dodaje `projects`.

**Model:** `projects` (r3); uvoz kroz `withCompany`. Uvoz **ne** uvodi stacionažu,
partnere ni workflow (B15 NE → R5) — **ne radi još**.

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

**Neuredni redovi:** samo u pregledu; ne upis; ispravi Excel/mapiranje.

**Testovi:** preview bez upisa; apply s greškom = 0 upisa; ista šifra u drugoj firmi
OK; izolacija tenanta; NUL/kontrolni znakovi; E2E sretan + miješane greške.

**Van obima 2c:** partneri/klijent (nema tabele; R5); stacionaža (R5); tok odobravanja
(R5/R4b); OCR; situacije; GeoJSON; R4b; PII u repou.
