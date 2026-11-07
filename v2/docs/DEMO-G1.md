# Demo za G1 — kako pokazati i šta provjeriti

**Trajanje:** 10 minuta. **Cilj:** vlasnik sam prođe tok, ne gleda snimak.

## 1. Gdje se prolazi

**Preporučeno: testna domena** (ista baza, isti seed, ništa ne dižeš lokalno).

```
https://gradix.ba101.top
```

Prijava: `ured@demo.ba` / lozinka iz `SEED_PASSWORD`. Provjeri prije početka:
`curl -s https://gradix.ba101.top/api/ready` ⇒ `"status":"ok"`.

**Alternativa — lokalno** (samo ako želiš svoju bazu; traži Docker):

```bash
cd v2
./infra/scripts/dev-up.sh          # podigne bazu, primijeni migracije, napuni demo podatke
pnpm --filter @gradix/web dev      # http://localhost:3000
```

Lokalna lozinka: `demo-lozinka-123`. **Ne miješaj**: lokalno i testna domena imaju različite lozinke.

## 2. Šta proći (redom)

| # | Korak | Šta dokazuje |
|---|---|---|
| 1 | Prijavi se kao `ured@demo.ba` | sesija, Argon2id, tenant iz sesije |
| 2 | Vidiš 3 mašine svoje firme | `/api/me` i stranica idu kroz tenant scope |
| 3 | Odjavi se, prijavi kao `vlasnik@druga.ba` | vidiš **1** mašinu (Druga Firma) — izolacija radi |
| 4 | Otvori `/pregled` bez prijave u privatnom prozoru | preusmjerenje na `/login` (nema curenja) |
| 5 | Na telefonu (Expo Go): `pnpm --filter @gradix/mobile start` — skeniraj QR, prijavi se, ukucaj zapis, klikni **Sačuvaj na uređaju** (detalji: `docs/MOBILE-EXPO-GO.md`) | zapis je u lokalnoj bazi prije mreže |
| 6 | Ugasi mrežu (aviо režim), klikni **Pošalji sve** | poruka „Nema veze… čeka slanje“, zapis nije izgubljen |
| 7 | Vrati mrežu, klikni **Pošalji sve** | „Poslano: 1. Čeka: 0.“ |
| 8 | Klikni **Pošalji sve** još jednom | „Poslano: 0“ — nema duplikata (idempotentno) |
| 9 | Na webu osvježi `/pregled` | broj offline zapisa se povećao |

## 3. Staging

`https://<poddomena>.ba101.top` (vlasnik postavlja). Provjere: `/api/health` (liveness), `/api/ready` (baza + primijenjene migracije), prijava istim seed korisnicima.

## 4. Šta NE radi (namjerno, u ovom rezu)

- Nema registracije, pozivnica, resetovanja lozinke (admin reset je R1).
- Nema promjene lozinke na prvom ulasku — polje `mustChangePassword` postoji, ekran ne.
- Nema rola u UI-u: matrica dozvola je R1.
- Nema MinIO/priloga, nema Redis-a, nema `worker` procesa.
- Mobilni je jedan ekran i jedan tip zapisa (`note`); radni dan, ture i gorivo su R4/R5.
- Rate limit prijave je **u memoriji procesa**: radi za jednu instancu, ne dijeli se između replika.
- Tamna tema, dizajn smjerovi, ikone: Faza 2.

## 5. Ako nešto padne

```bash
# provjeri bazu i migracije
curl -s localhost:3000/api/ready | jq
# ponovi migracije (idempotentno)
./infra/scripts/db-apply.sh
# reset na čisto stanje
dropdb gradix && createdb gradix && ./infra/scripts/dev-up.sh
```
