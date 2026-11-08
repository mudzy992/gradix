# Demo za G1b — matrica rola, dodjela, audit

**Trajanje:** 6 minuta. **Cilj:** sam prođeš kroz R1b; snimci su u `docs/design/demo-r1b/`.

## 1. Gdje se prolazi

Isto kao za G1: testna domena ako je živa, inače lokalno. Prijava `ured@demo.ba`
(ADMIN) — vlasnik (`vlasnik@demo.ba`) je potreban samo za korak 4.

## 2. Šta proći (redom)

| # | Korak | Šta dokazuje |
|---|---|---|
| 1 | `/ured/role` | matrica je pregled: `✓`/`—`, opis svake role, bez dugmeta za izmjenu |
| 2 | `/ured/korisnici` → „⋯“ na `sef@demo.ba` → **Role i opseg** | dijalog sa trenutnim stanjem; „Sačuvaj“ je zaključan dok ništa ne promijeniš |
| 3 | Dodaj rolu „Radnik“, opseg „Samo svoje“, **Sačuvaj** | lista se osvježi, zelena poruka; promjena važi odmah (bez ponovne prijave) |
| 4 | Otvori **„⋯“** na `vlasnik@demo.ba` | **nema ga** — piše „samo vlasnik“. Admin ne može ni otvoriti dijalog |
| 5 | `/ured/audit` | izmjena iz koraka 3 je prva; „Otvori“ pokaže `from`/`to` role i opseg |
| 6 | Filter: radnja = „Promijenjene role ili opseg“ | ostaje samo ta radnja; „Obriši filtere“ vraća sve |
| 7 | Filter: radnja = „Sve sesije ugašene“ | prazno stanje sa objašnjenjem i izlazom |
| 8 | Prijavi se kao `sef@demo.ba` → `/ured/role` | preusmjeren na `/pregled` (403 na API-ju) |

## 3. Na šta obratiti pažnju

- **Nema uređivanja dozvola** — matrica je pregled, kako je dogovoreno. Izmjena dozvola po
  roli nije u R1.
- **Opseg** ima dvije vrijednosti („Cijela firma“, „Samo svoje“). „Dodijeljeni projekti“ je
  odloženo u R2 i **nema ga ni u bazi ni u API-ju** — upisano u `docs/PLAN-R2.md`.
- **Trag se ne briše** iz ekrana; filter je jedini način da se suzi.
