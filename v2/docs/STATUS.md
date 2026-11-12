# STATUS — Gradix v2

**Datum:** 2026-11-07 · **Grana:** `arena/37e610e9-gradix` · UI migracija prihvaćena (katalog, CI zelen).

## Radi (dokazano testovima u CI-ju)

- **Pristup (R1):** prijava, pozivnice, reset i obavezna promjena lozinke, deaktivacija, rate
  limit u bazi. Matrica `permissions.ts` je jedini izvor za meni i za provjeru na stranici.
- **Navigacija i sesija (A/A2):** svaka stranica je u meniju role koja je smije (test
  dosegljivosti `nav.test.ts`) ili na listi izuzetaka s razlogom; zabranjen URL daje stranicu
  „Nemate pristup" (HTTP 403, link na pregled), bez tihog redirecta; odjava vodi na prijavu;
  čuvar sesije odjavljuje **samo na 401**, nikad na grešku mreže/timeout
  (`session-watch.test.ts`, E2E drugi tab).
- **Radni dani (workdays.view):** OWNER/ADMIN i ACCOUNTANT vide cijelu firmu (računovođa samo
  čitanje), PM i šef samo radnike/projekte iz svog R3 opsega, bez povezanog radnika — prazno
  (`workday-review.integration.test.ts`).
- **Opsezi (R3):** WORKER i DRIVER vide samo projekte svojih dodjela i samo svoje rokove;
  ACCOUNTANT sve u firmi (`scope-roles.integration.test.ts`). SELF/PROJECTS računaju se na
  serveru, nikad u meniju.
- **Evidencija (R2/R3):** radnici, mašine/kategorije i brojila, uvoz iz Excela, rokovi s
  verzijama i prilozima, projekti i dodjele s blokadom i iznimkom (odobrenje samo
  OWNER/ADMIN); dodjele se ne brišu, samo završavaju/poništavaju uz razlog.
- **Teren (R4 + Step 7):** Moj dan (samo nalog povezan s radnikom), Grupa (šef + veza +
  aktivna dodjela) — `mobile-nav.test.ts`; SQLite outbox, push/pull bez rupa u cursoru,
  idempotentan retry, sukob = „Za provjeru", van opsega ostaje na telefonu. Simulator
  (`r4-simulator.test.ts`) pokriva gubitak odgovora, pending rupe i server floor
  (regresija `r4_sync_pull_floor_fix`, i DB strana u `sync-cursor.integration.test.ts`).
- **UI (U):** svi web i mobilni ekrani na katalogu komponenti; lista izuzetaka u
  `eslint.config.js` je **prazna**; vrijeme svuda 24 h; CI stražari: ESLint zabrane,
  check-ui (bez hardkodiranih boja/fontova), check-contrast (WCAG AA, obje teme), axe.
- **CI:** lint, typecheck, unit + integracije na pravoj bazi bez skipova, migracije na praznoj
  i popunjenoj bazi, Android bundle (Metro), Playwright E2E navigacije i sesije.

## Role — ko šta vidi

| Rola | Web (meni) | Mobilni | Ne vidi |
|---|---|---|---|
| OWNER | sve, uklj. Korisnici i Radni dani (cijela firma) | Moj dan ako je povezan s radnikom; Grupa ako je šef s dodjelom | tuđe firme (RLS) |
| ADMIN | kao vlasnik, bez radnji nad vlasnikom | isto pravilo veze s radnikom | vlasnika (ne upravlja njim) |
| PROJECT_MANAGER | Projekti, Rokovi, Mašine, Radnici, Radni dani (samo svoj opseg) | Moj dan/Grupa po vezi i dodjeli | Korisnici, Uvoz, tuđi opseg |
| SITE_SUPERVISOR | Radnici, Mašine, Projekti, Rokovi, Radni dani (svoj opseg) | Grupa (šef s dodjelama), Moj dan | Korisnici, Uvoz, tuđi opseg |
| WORKER | Pregled, Projekti, Rokovi, Mašine (samo svoje, SELF) | Moj dan, Moji rokovi/projekti | Radnici, Korisnici, Radni dani, tuđe rokove |
| DRIVER | Pregled, Projekti, Rokovi, Mašine (SELF) | Moj dan (ako je povezan), Moji rokovi/projekti | sve uredsko izvan svog opsega |
| MACHINE_OPERATOR | Pregled, Mašine, Projekti, Rokovi (SELF/opseg) | Moj dan, Moji rokovi/projekti | Radnici, Korisnici, Radni dani |
| MECHANIC | Pregled, Mašine, Projekti, Rokovi | Moj dan (ako je povezan), Moji rokovi/projekti | Radnici, Korisnici, Radni dani |
| ACCOUNTANT | Pregled, Projekti, Rokovi, Mašine, Radni dani (cijela firma, čitanje) | Moji rokovi/projekti | Korisnici, Uvoz, izmjene evidencije |

## Ne radi / namjerno još nema

- **R4a-2 razrješenje sukoba:** završeno — 2a (dozvola/opseg/strana u sukobu),
  2b (server), 2d (uredski web ekrani `/ured/sukobi`, bedž samo za
  nerazriješene, Pregled kartica, E2E razrješenja) i 2c (ishod razrješenja
  stiže na telefon pull-om: Odbačeno + razlog / Ispravljeno + stara-nova
  vremena / Prihvaćeno; interna napomena nikad na uređaj).
  **Provjerena staging/produkcijska adresa (2026-11-07):**
  `https://gradix.ba101.top/ured/sukobi` (jedan domen; API je na istom
  originu pod `/api`). Stranicu i API (`workdays.resolve`) vide tačno:
  **OWNER, ADMIN, PROJECT_MANAGER, SITE_SUPERVISOR** — PM i šef samo svoj
  R3 opseg; ACCOUNTANT ima samo `workdays.view` (Radni dani, čitanje) i
  Sukobe ne vidi (navigacija skrivena, stranica preusmjerava na
  `/nemate-pristup`, API 403). Ostale role (WORKER, DRIVER,
  MACHINE_OPERATOR, MECHANIC) nemaju ni `workdays.view` ni
  `workdays.resolve`. Izvor: `src/server/permissions.ts` + `nav.ts`
  (`permission: "workdays.resolve"`), ne pretpostavka.
- **R4b (potvrda/zaključavanje sedmice):** nije započet; čeka R4a-2.
- **Mobilni E2E na uređaju:** Maestro fajlovi postoje, ne izvršavaju se u CI-ju; telefonski
  prolaz radi vlasnik po `docs/DEMO-STEP7.md`.
- **Redis se ne koristi** u aplikaciji (samo dijagnostika); rate limit je u bazi.
- **Katalog** (`/katalog`, mobilni katalog ekran) nije javan: razvoj ili platformski
  administrator, ostalima 404; u produkcijskoj mobilnoj gradnji se ne uključuje.

- **E2E stabilnost (izmjereno, R4a-2/A):** ručni mod CI workflowa
  (`workflow_dispatch`, `e2e_stabilnost=true`, matrica 5×4, bez retryja —
  retry je uklonjen i iz redovnog `playwright.config.ts`). Prvo mjerenje:
  **15/20**, svaki pad 4. pokretanje u jobu, isti test
  (`resolve.spec.ts`, `locator.click` timeout). Uzrok nije preglednik ni
  rate limit: test razrješenja troši demo sukobe (3 u seedu) pa 4.
  pokretanje na istoj bazi nema šta otvoriti. Ispravka: mjerenje prije
  svakog pokretanja resetuje testnu bazu (drop schema + migracije + seed);
  produkcijski seed i guard nepromjenjivosti razriješenih sukoba nisu
  dirani (pokušaj reset-a kroz seed je guard ispravno odbio). Drugo
  mjerenje: **20/20**. Preglednik u CI-ju ide iz cachea (ključ = zaključana
  verzija `@playwright/test` 1.57.0 u lockfileu).

## Dugovi (ne blokiraju)

- **PLATFORM_ADMIN_EMAILS:** privremeni mehanizam platformskih administratora
  (u env-u je `ured@demo.ba`); zamijeniti pravim platform korisnicima, ne širiti
  na druge rute.

## Otvoreno

1. **Staging:** vlasnik deploya zadnji zeleni commit s ove grane i prolazi ekrane po rolama
   u obje teme (lista u izvještaju uz ovaj STATUS).
2. **Pilot:** `docs/PILOT.md` — Excel primjeri od vlasnika, priprema korisnika; SEED_DEMO se
   uklanja samo eksplicitnom naredbom `remove-demo.ts`.
3. **Produkcija:** prije pilota potvrditi backup baze i ugasiti javnu MinIO konzolu
   (odluka vlasnika).
