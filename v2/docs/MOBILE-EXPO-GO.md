# Mobilni u Expo Go — put za šefa (pilot oblik A)

**Cilj:** šef na Androidu vidi **Grupa** i **Moj dan**, API na `https://gradix.ba101.top`.

## Expo Go kompatibilnost

| Izvor | Vrijednost |
|---|---|
| `apps/mobile/package.json` → `expo` | `58.0.24` (SDK **58**) |
| Expo Go | build za **SDK 58** ([expo.dev/go](https://expo.dev/go)) |
| CI / lokalno | `pnpm --filter @gradix/mobile check-expo` (čita `expo/bundledNativeModules.json`, bez mreže) |

**Rezultat (izvor: `package.json` + `check-expo` + lista modula u Expo Go SDK 58): očekivano radi u Expo Go.**
Development build treba tek kad uđe modul kojeg Go nema — **ne** za ovaj pilot.

**Expo Go nije provjeren na fizičkom uređaju** (telefon za šefa: NEMA). Emulator 2c/A1: PRIHVAĆEN.

---

## Šta seed daje (izvor: `apps/web/scripts/seed.ts`)

Brojevi iz nizova u `seed.ts` (ne iz memorije). Dokaz veza/rostera: test
`seed-demo.integration.test.ts` („demo seed: veze korisnik-radnik i šefova ekipa”).

| Stavka | Broj | Izvor u `seed.ts` |
|---|---|---|
| Firme | **2** | `companies` |
| Šefova s aktivnom dodjelom | **1** | `usr_sef` / `wrk_demo_mario` + `pas_2` na `prj_dionica` (ACTIVE) |
| Radnika povezanih s nalogom | **3** | `workers` s `userId` (amar, mario, kenan) |
| Projekata | **2** | `projects` (1 ACTIVE, 1 FINISHED) |
| Projekata s ≥1 dodjelom | **1** | samo `prj_dionica` u `assignments` |
| Dodjela | **8** | `assignments` |
| Otvorenih sukoba (svjež seed) | **3** | `demoConflicts` (`cnf_demo_1..3`), `ON CONFLICT DO NOTHING` |
| Radnika na aktivnom projektu (bez šefa) | **5** | amar, nedim, selmir, haris, kenan — zadovoljava 3–5 |

### Prijavne uloge za pilot (samo `.test`, bez lozinki)

| Email | Uloga |
|---|---|
| `vlasnik@demo.test` | OWNER |
| `ured@demo.test` | ADMIN |
| `sef@demo.test` | SITE_SUPERVISOR |
| `radnik@demo.test` | WORKER |
| `voditelj@demo.test` | PROJECT_MANAGER |
| `vlasnik@druga.test` | OWNER (druga firma, izolacija) |

Lozinka = `SEED_PASSWORD` s kojim je seedan staging — **ne upisuj vrijednost u repo/chat**.

---

## Semantika reseta

| Entitet | Samo `seed.ts` / `seed.sh` | `--reset-pilot` pa seed |
|---|---|---|
| Radni dani (`workdays`) | **ostaje** (pilot dani se ne brišu) | **briše se** ako nema preostalih unosa; seed može ponovo upisati `wd_demo_*` |
| Unosi (`work_entries`) | **ostaje** | **briše se** osim onih vezanih uz RESOLVED; seed upsert `we_demo_*` |
| Sinhronizacijski događaji (`sync_change_log`, `sync_receipts`, slotovi) | **ostaje** | **briše se** (samo `cmp_demo`) |
| Sukobi OPEN | **ostaje** (`DO NOTHING`) | **briše se**; seed ponovo upisuje `cnf_demo_*` ako fale |
| Sukobi RESOLVED | **ostaje** (ne vraća na OPEN) | **ostaje** (guard se ne zaobilazi) |
| Dodjele | seed `pas_*` **vraćeno** ako fale; **višak ostaje** | višak van `pas_1..8` **briše se**; `pas_*` **vraćeno** |

Običan seed **nije** povrat prije pilota. Komanda:

```sh
DATABASE_ADMIN_URL=... SEED_PASSWORD=... \
  pnpm --filter @gradix/web exec tsx scripts/seed.ts --reset-pilot
```

Dokaz: `reset-pilot.integration.test.ts`. `cmp_druga` se ne dira.

### Preimenovanje `@demo.ba` → `@demo.test`

Razlog: kriterij sintetičkih adresa (`.test`); vlasnik **ODOBRIO**. Seed upsert-a `email` na istim
user ID-jevima — nema paralelnih `@demo.ba` seed naloga. **Coolify env** (katalog):
`PLATFORM_ADMIN_EMAILS` mora biti nova adresa, npr. `ured@demo.test` ili `vlasnik@demo.test`
(zarezom više). Mehanizam se ne mijenja.

---

## Numerisani koraci (šef / laik)

| # | Šta uradiš | Očekivani ekran |
|---|---|---|
| 1 | `cd v2 && pnpm install && cd apps/mobile` | terminal OK |
| 2 | `cp .env.example .env` — `EXPO_PUBLIC_API_URL=https://gradix.ba101.top` | fajl postoji |
| 3 | `pnpm start` (poslije `.env`: `-- --clear`) | QR / `exp://…` |
| 4 | Expo Go SDK 58 → Scan QR | `gradix-teren` |
| 5 | Prijava `sef@demo.test` | početni: firma + ime |
| 6 | Vidi **Grupa** i **Moj dan** | oba dugmeta |
| 7 | Grupa → aktivan projekat → ekipa | lista nije prazna |

**Offline:** prva prijava online; zatim unos → „Čeka slanje”; „Pošalji sada” s mrežom.

## Šta je / nije provjereno

| Provjereno | Kako |
|---|---|
| Meni Grupa/Moj dan | `mobile-nav` testovi |
| Expo verzije | `check-expo` |
| Seed roster | `seed-demo.integration.test.ts` |
| `--reset-pilot` | `reset-pilot.integration.test.ts` |

| Nije | Zašto |
|---|---|
| Fizički telefon | **nema** |
| Mobilni E2E u CI | ne traži se |
