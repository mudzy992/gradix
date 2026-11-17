# Mobilni u Expo Go — put za šefa (pilot oblik A)

**Cilj:** šef na Androidu vidi **Grupa** i **Moj dan**, API na `https://gradix.ba101.top`.

**Zašto Expo Go (ne EAS/dev build):** trenutni mobilni koristi samo module koje Expo Go za
**SDK 58** već ima (`expo-router`, `expo-sqlite`, `expo-secure-store`, …). Development build
treba tek kad uđe modul kojeg Expo Go nema — **ne radi još** kao zahtjev za ovaj pilot.

**Stanje provjera:** Metro/`expo export` i `check-expo` su ranije dokazani u CI/sandboxu
(SDK 58). Jedinični: `mobile-nav` (Grupa = SITE_SUPERVISOR + workerId + foremanScope;
Moj dan = workerId). **Fizički telefon šefa: nema (odluka vlasnika)** — koraci ispod nisu
prođeni na uređaju u ovom bloku. Emulator 2c/A1: **PRIHVAĆEN** (vlasnik).

---

## 1. Prije svega (ured / vlasnik)

1. API živ: preglednik ili `curl` na `https://gradix.ba101.top/api/ready` → očekivano
   `"status":"ok"` i postgres ok. (Ako ne — Coolify, ne telefon.)
2. Demo ekipa u bazi (sintetički seed, vidi §5): šef + radnici + projekti/dodjele.
3. Na računaru: Node 22.13+; telefon i računar **ista Wi-Fi** (Metro nije javni internet).
4. Na telefonu: **Expo Go za SDK 58** ([expo.dev/go](https://expo.dev/go) → SDK 58). Stariji
   Expo Go → „Project is incompatible…“.

---

## 2. Numerisani koraci (šef / laik)

| # | Šta uradiš | Očekivani ekran |
|---|---|---|
| 1 | Na računaru: `cd v2 && pnpm install && cd apps/mobile` | terminal bez greške |
| 2 | Jednom: `cp .env.example .env` — u `.env` mora biti `EXPO_PUBLIC_API_URL=https://gradix.ba101.top` (ne ispisuj druge tajne) | fajl postoji |
| 3 | `pnpm start` (poslije izmjene `.env`: `pnpm start -- --clear`) | QR / `exp://…:8081` |
| 4 | Android: Expo Go → Scan QR (ili upiši `exp://…`) | učitava se `gradix-teren` |
| 5 | Prijava nalogom šefa iz seeda (`sef@demo.ba`; lozinka = `SEED_PASSWORD` s kojim je seedan staging — **ne upisuj vrijednost u chat/repo**) | početni: ime firme + ime |
| 6 | Na početnom mora biti **Grupa — unos za ekipu** i **Moj dan** (šef je vezan na radnika + foremanScope) | oba dugmeta vidljiva |
| 7 | Otvori **Grupa** → izaberi aktivan projekat → vidiš ekipu | lista radnika (ne prazno) |
| 8 | Otvori **Moj dan** → možeš sačuvati unos na telefon | „Sačuvaj…“ / red čekanja |

`pnpm android` / `pnpm ios` = emulator, **nije** put za fizički telefon.

---

## 3. Offline (ograničenja)

- **Prva prijava mora biti online** (token/sesija).
- Zatim avio režim: Moj dan / Grupa → sačuvaj → **„Čeka slanje“**; banner Bez veze.
- Rokovi/projekti offline: zadnje preuzeto + „Nema veze…“.
- „Pošalji sada“ tek s mrežom. Van opsega ostaje na telefonu (nije „odbijeno“ zauvijek).
- Expo Go ne zamjenjuje zaključan telefon (PIN/otisak) — to je obaveza pilota.

---

## 4. Šta je / nije provjereno

| Provjereno | Kako |
|---|---|
| Meni Grupa / Moj dan (pravila) | jedinični `mobile-nav` testovi |
| SDK / zavisnosti Expo | `pnpm --filter @gradix/mobile check-expo` |
| Bundle Android | ranije `expo export -p android` / Metro (sandbox/CI dokaz u historiji) |
| Seed šef↔radnik + roster ekipe | `seed-demo.integration.test.ts` (prava baza) |

| Nije u ovom bloku | Zašto |
|---|---|
| Fizički telefon šefa | **nema** (odluka) |
| Mobilni E2E/emulator u CI | namjerno se ne traži |
| EAS / store build | nije potreban dok sta je u Expo Go |

---

## 5. Sintetički pilot podaci i povrat na početno

**Šta seed daje (idempotentno, `scripts/seed.ts` / `./seed.sh` u web slici):** jedna demo firma
(`niskogradnja-demo`), šef (`sef@demo.ba`), radnici s dodjelama na aktivan projekat (+ jedan
završen), druga firma (`vlasnik@druga.test`) za izolaciju. Podaci su izmišljeni; u repou nema
stvarnih ličnih podataka.

**Povrat na početno (vlasnik, Coolify terminal web ili lokalno s `DATABASE_ADMIN_URL`):**

```sh
cd /app && SEED_PASSWORD='…ista-kao-prije…' ./seed.sh
```

(ili `pnpm --filter @gradix/web exec tsx scripts/seed.ts` s `DATABASE_ADMIN_URL` + `SEED_PASSWORD`)

- Ponovni seed **ne pravi duplikate** (ON CONFLICT / update postojećih demo ID-jeva).
- **Razriješene sukobe ne vraća na OPEN** (guard nepromjenjivosti; seed samo `DO NOTHING` na
  postojeće conflict redove). Za *nove* vježbe sukoba: `demo-sukobi.ts` (COOLIFY §5.2) — ne
  dirati razriješene.
- Brisanje cijele demo firme: samo `remove-demo.ts` uz `REMOVE_DEMO_CONFIRM` (nije „reset
  ekipe“, to je uklanjanje).

Dokaz stanja poslije (ponovnog) seeda: integracijski test
`apps/web/src/server/seed-demo.integration.test.ts` (veze user↔worker, roster ekipe za šefa).

---

## 6. Ako pukne

| Simptom | Uzrok | Rješenje |
|---|---|---|
| „Project is incompatible with this version of Expo Go“ | Expo Go ≠ SDK 58 | [expo.dev/go](https://expo.dev/go) SDK 58 |
| Telefon ne vidi QR | druga mreža / firewall 8081 | isti Wi-Fi; ili `pnpm start -- --tunnel` |
| „Nema veze“ uz internet | krivi `EXPO_PUBLIC_API_URL` u bundleu | `.env` → `pnpm start -- --clear` |
| Grupa prazna / nema dugmeta | seed bez veze šef↔radnik ili nije šef | ponovi §5 seed; uloga SITE_SUPERVISOR |
| Bijel ekran | Metro keš | `pnpm start -- --clear` |
