# Mobilni u Expo Go — put za pilota

**Cilj:** vlasnik na Expo Go / emulatoru testira role; API = `https://gradix.ba101.top`.

## Expo Go kompatibilnost

| Izvor | Vrijednost |
|---|---|
| `apps/mobile/package.json` → `expo` | `58.0.24` (SDK **58**) |
| Expo Go | build za **SDK 58** ([expo.dev/go](https://expo.dev/go)) |
| CI | `pnpm --filter @gradix/mobile check-expo`; Metro/Android bundle u CI |

**Expo Go radi na računaru vlasnika** (Metro + QR / emulator); javni API je
`https://gradix.ba101.top`. **Provjereno u CI-ju:** `check-expo`, Android bundle.
**Nije provjereno na fizičkom uređaju** kao uslov ovog dokumenta (pilot ide Expo Go/emulator).

---

## Android build (zahtjev vlasnika)

**Samo Android 15+, jedna arhitektura (`arm64-v8a`), cilj do ~100 MB; ne uključuje starije verzije.**

Oznaka: **nije implementirano, zahtjev vlasnika.** (Bez nove zavisnosti / EAS dok ADR i
odobrenje ne postoje.) Trenutni put pilota ostaje **Expo Go**.

---

## Šta seed daje (izvor: `apps/web/scripts/seed.ts`)

| Stavka | Broj | Izvor |
|---|---|---|
| Firme | **2** | `companies` |
| Šefova s aktivnom dodjelom | **1** | `pas_2` + `prj_dionica` |
| Radnika s nalogom | **3** | `workers` s `userId` |
| Projekata | **2** | `projects` |
| Dodjela | **8** | `assignments` |
| Otvorenih sukoba (svjež seed) | **3** | `cnf_demo_*` |

Dokaz: `seed-demo.integration.test.ts`.

### Prijavne uloge (samo `.test`, bez lozinki)

| Email | Uloga |
|---|---|
| `vlasnik@demo.test` | OWNER |
| `ured@demo.test` | ADMIN |
| `sef@demo.test` | SITE_SUPERVISOR |
| `radnik@demo.test` | WORKER |
| `voditelj@demo.test` | PROJECT_MANAGER |
| `vlasnik@druga.test` | OWNER (druga firma) |

---

## Semantika reseta

| Entitet | Samo seed | `--reset-pilot` pa seed |
|---|---|---|
| Radni dani / unosi | **ostaje** | **briše se** (osim vezanih uz RESOLVED) |
| Sync događaji / receipts | **ostaje** | **briše se** (`cmp_demo`) |
| Sukobi OPEN | **ostaje** | **briše se** |
| Sukobi RESOLVED | **ostaje** | **ostaje** |
| Dodjele | `pas_*` upsert; višak **ostaje** | višak **briše se** |

```sh
DATABASE_ADMIN_URL=... SEED_PASSWORD=... \
  pnpm --filter @gradix/web exec tsx scripts/seed.ts --reset-pilot
```

---

## Numerisani koraci (laik)

| # | Šta uradiš | Očekivani ekran |
|---|---|---|
| 1 | `cd v2 && pnpm install && cd apps/mobile` | terminal OK |
| 2 | `cp .env.example .env` — `EXPO_PUBLIC_API_URL=https://gradix.ba101.top` | fajl postoji |
| 3 | `pnpm start` (poslije `.env`: `-- --clear`) | QR / `exp://…` |
| 4 | Expo Go SDK 58 → Scan QR **ili** emulator | `gradix-teren` |
| 5 | Prijava npr. `sef@demo.test` (lozinka = seed `SEED_PASSWORD`, ne u chat) | početni: firma + ime |
| 6 | Šef: **Grupa** + **Moj dan**; ured: web `https://gradix.ba101.top` | po matrici / PILOT.md |

**Offline:** prva prijava online; zatim „Čeka slanje” → „Pošalji sada”.
