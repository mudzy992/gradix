# STATUS — Gradix v2

**Datum:** 2026-11-07 · **Grana:** `arena/37e610e9-gradix` · **Step 7 POTVRĐEN** (telefon + staging log).

## Radi (dokazano u CI-ju i/ili uživo)

- **Pristup i role (R1):** prijava, pozivnice, reset, obavezna promjena lozinke, deaktivacija,
  rate limit u bazi; matrica dozvola (`permissions.ts`) je jedini izvor za meni i stranice.
- **Navigacija i sesija (A/A2):** svaka stranica je u meniju role koja je smije (test
  dosegljivosti) ili na listi izuzetaka; meni po roli == matrica (test); zabranjen URL daje
  403 stranicu; odjava vodi na prijavu; drugi tab pri 401 ide na prijavu (E2E Playwright).
  Opsezi: PM/šef vide Radne dane samo iz svog R3 opsega, ACCOUNTANT cijelu firmu.
- **Evidencija (R2/R3):** radnici, mašine/kategorije, uvoz iz Excela, rokovi s verzijama i
  prilozima (SELF opseg za radnika), projekti i dodjele s blokadom/iznimkom; dodjele se ne brišu.
- **Teren (R4 + Step 7):** mobilni Moj dan (povezani radnik) i Grupa (šef s dodjelama),
  SQLite outbox, push/pull sync s cursorom bez rupa, idempotentni retry, sukob = „Za provjeru“,
  van opsega = „Van opsega“ (ostaje na telefonu); uredski pregled Radni dani po opsegu.
- **Sync baza:** cursor alokator/slotovi/change log, receipts, konflikti; migracije idu naprijed
  samo — popravke idu kao NOVE migracije (lekcija `r4_sync_pull_floor_fix`).
- **Demo:** SEED_DEMO (firma `niskogradnja-demo`, šef/radnik povezani s radnicima, ekipa 5);
  uklanjanje samo `remove-demo.ts` uz `REMOVE_DEMO_CONFIRM=niskogradnja-demo`.
- **CI:** lint, typecheck, unit + integracije na pravoj bazi (REQUIRE_DB_TESTS=1, bez skipova),
  Android bundle (Metro), migracije na praznoj i popunjenoj bazi, Playwright E2E, axe a11y.

## Ne radi / namjerno još nema

- **R4a-2 razrješenje sukoba:** samo odobren plan (`docs/R4A2-PLAN.md`) — ekran i odluke ureda
  nisu implementirani; sukob zasad stoji kao „Za provjeru“.
- **R4b (potvrda/zaključavanje sedmice):** nije započet; čeka završetak R4a-2.
- **Mobilni E2E na uređaju:** Maestro scenariji postoje kao fajlovi (`apps/mobile/maestro/`),
  ne izvršavaju se u CI-ju; telefonski prolaz radi vlasnik po `docs/DEMO-STEP7.md`.
- **Redis se ne koristi** u aplikaciji (samo dijagnostika); rate limit prijave je u bazi.
- **Javna MinIO konzola** je uključena odlukom vlasnika; gasi je vlasnik prije produkcije.

## Otvoreno

1. **Dio U (UI sistem):** zajedničke komponente web+mobilni, lint zabrane sirovih elemenata,
   katalog; kapija: snimci Radnici + Moj dan/prijava prije/poslije čekaju odobrenje vlasnika.
2. **C.1 dizajn R4a-2** u referenci (poslije U) — čeka odobrenje prije implementacije.
3. **Pilot:** `docs/PILOT.md` (dokument) — Excel primjeri od vlasnika, pa priprema korisnika;
   SEED_DEMO ostaje do priprema pilota, onda se uklanja eksplicitnom naredbom.
4. **Produkcija:** gradix.ba101.top služi v2 preko HTTPS; prije pilota potvrditi backup baze
   i gašenje javne MinIO konzole.
