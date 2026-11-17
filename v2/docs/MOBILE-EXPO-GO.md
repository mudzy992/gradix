# Mobilni u Expo Go — put za šefa (pilot oblik A)

**Cilj:** šef na Androidu vidi **Grupa** i **Moj dan**, API na `https://gradix.ba101.top`.

## Expo Go kompatibilnost

| Izvor | Vrijednost |
|---|---|
| `apps/mobile/package.json` → `expo` | `58.0.24` (SDK **58**) |
| Expo Go | build za **SDK 58** ([expo.dev/go](https://expo.dev/go)) |
| CI / lokalno | `pnpm --filter @gradix/mobile check-expo` (čita `expo/bundledNativeModules.json`, bez mreže) |

**Rezultat: radi (Expo Go).** Trenutni moduli (`expo-router`, `expo-sqlite`, `expo-secure-store`, …)
ulaze u Expo Go SDK 58. **Development build treba** tek kad uđe native modul kojeg Go nema
— to **ne radi još** kao zahtjev ovog pilota.

**Nije provjereno na fizičkom telefonu** (odluka: telefon za šefa **nema**). Emulator 2c/A1: DA.

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

### Samo `seed.sh` / `seed.ts` (bez flaga)

| Tabela / pojam | Poslije ponovnog seeda |
|---|---|
| Firme, users, memberships, workers, projects, mašine | **vraćeno** (upsert) |
| Dodjele (`pas_*`) | **vraćeno** ako nedostaju; **višak ostaje** |
| Seed sukobi `cnf_demo_*` | **ostaje** ako postoje (`DO NOTHING`); ne vraća RESOLVED→OPEN |
| Radni dani / unosi nastali u pilotu | **ostaje** (seed ih ne briše) |
| `sync_receipts` / `sync_change_log` | **ostaje** |
| Druga firma (`cmp_druga`) | **ostaje** (seed je ne briše) |

**Zaključak:** običan seed **nije** povrat na stanje prije pilota.

### Komanda `--reset-pilot` pa seed

```sh
DATABASE_ADMIN_URL=... SEED_PASSWORD=... \
  pnpm --filter @gradix/web exec tsx scripts/seed.ts --reset-pilot
```

(Coolify web terminal: ista skripta u slici ako je `seed` izbuildan s flagom; inače gornja naredba.)

| Tabela / pojam | Poslije `--reset-pilot` + seed |
|---|---|
| Otvoreni sukobi (`status=OPEN`) u `cmp_demo` | **briše se**, seed ponovo upisuje `cnf_demo_*` ako fale |
| Razriješeni sukobi (`RESOLVED`) | **ostaje** (guard se ne zaobilazi) |
| Pilot `work_entries` / `workdays` bez veze na RESOLVED | **briše se** |
| Unosi vezani uz RESOLVED | **ostaje** |
| `sync_receipts`, `sync_change_log`, `sync_cursor_slots` u `cmp_demo` | **briše se** |
| Dodjele van `pas_1..8` | **briše se**; seed drži `pas_*` |
| `cmp_druga` | **ostaje** (naredba je ne dira) |

Dokaz: `reset-pilot.integration.test.ts`.

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
