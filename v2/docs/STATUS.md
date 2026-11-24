# STATUS — Gradix v2

**Datum:** 2026-11-23 · **Grana:** `arena/44b867b0-gradix` · **Faza 0: završena** · **Faza 1: završena (checkpoint)** · **CI: zelen.**

Realizacija ide po `docs/IMPLEMENTATION_PLAN.md` (odobren u cjelosti, strogi redoslijed).
Moduli 1–12 zaključani u `docs/specs/`. Sljedeće: **Faza 2 — Obaveze s rokom** (Modul 2,
`docs/specs/02-obaveze-s-rokom.md`).

## Šta je gotovo

| Korak | Sadržaj | Stanje |
|---|---|---|
| 0 | Monorepo, TS strict, dvije DB role (`gradix_app` / vlasnik), FORCE RLS + `app.company_id`, `withCompany`, preflight, CI | ✅ |
| 0.1 | Prilozi objedinjeni u jednu `attachments` tabelu (entitet + vrsta), S3 potpisi, MIME provjera | ✅ |
| 0.2 | Stare attachment tabele uklonjene; matrix parity pokazuje na novu tabelu | ✅ |
| 0.3 | Matrica dozvola kao kod (`packages/domain`): akcija × rola × stanje reference; `SELF_APPROVAL_FORBIDDEN`; iznimke sa rokom i razlogom ≥10 znakova | ✅ |
| 0.4 | `apps/worker` na pg-boss-u + obavještenja (`notifications`, inbox, zvonce, `/ured/obavjestenja`), `/api/health` (bez baze) i `/api/health/queue` | ✅ |
| 0.5 | Higijena: OpenAPI iz `ROUTES` + CI provjera ažurnosti, preflight kao CI gate, `AGENTS.md` osvježen, `STATUS.md` | ✅ |
| 1.1 | Baza: zaglavlje firme, `company_holidays`, `user_sessions`/`user_devices`, `user_totp` + recovery kodovi, `platform_users`/`platform_sessions`, `report_jobs`, `daily_rollups`; audit klase i logovanje ČITANJA | ✅ |
| 1.2 | Domena: politika lozinki (10k crna lista, istorija 3, lock 10/15 min, rotacija 180 d za uredske role), TOTP (AES-256-GCM, replay zaštita), sesije, uređaji | ✅ |
| 1.3 | API: 2FA tok (obaveza za OWNER/ADMIN/ACCOUNTANT + uparivanje prije prve sesije), sesije i opoziv na daljinu, postavke firme i praznici, platforma (onboarding, suspend/activate, support pristup) | ✅ |
| 1.4 | UI: `/ured/postavke` (4 taba), `/ured/profil/sesije` (web) + `/uredjaji` (mobile), `/platform/firme` + onboarding čarobnjak | ✅ |

## Korak 0 — zašto je CI bio crven i šta je popravljeno

Dva nezavisna uzroka; oba su bila **prvi** pad u nizu, pa su krila sve naredne korake.

| # | Korak CI-ja | Uzrok | Popravka |
|---|---|---|---|
| 1 | „Nema stvarnih ličnih podataka" (`ci-v2.yml`) | `check-privacy.mjs` je IBAN tretirao kao lični podatak, iako spec 01 §3.2 traži IBAN **firme**; 4 test mejla su bila van rezervisanih domena | IBAN izuzet iz `PERSONAL_SQL`/`PERSONAL_TS` (+ 2 self-test slučaja koja to čuvaju); test mejlovi prebačeni na `*.test` / `example.com` |
| 3 | `E2E Playwright` — **istekao job-timeout (30 min)**, sve prije njega zeleno | F1 prijava ima **drugi korak**, a replay zaštita (`user_totp.last_used_step`) dozvoljava tri prijave istog naloga po 30-s periodu. E2E prijavljuje `vlasnik@`/`racunovodja@` desetinama puta → drugi login pada kao „pogrešan kod", `loginUi` čeka `**/pregled` do isteka testa, lanac od 7 shardova pojede cijeli budžet | Helper `loginUi` sada traži **svjež kod** (`freshTotpCode`: tekući korak → dozvoljeni prozor `+1` → novi period) i resetuje brojač sintetičkog naloga (`resetTotpReplayGuard`) kad je `E2E_RESET_TOTP_STEP=1`; seed resetuje `last_used_step`; timeout joba 30 → 45 min |
| 2 | `assembleRelease` (mobilni E2E) | `packages/domain/src/totp.ts` uvozi `node:crypto`, a barrel `@gradix/domain` ga je uvlačio u Android bundle preko `r4-outbox.ts`. Metro nema Node stdlib → bundling pada | Novi ulaz `@gradix/domain/server` za serverske module; barrel više ne izvozi TOTP; uvoznici prebačeni. Greška se vidi **samo** pri bundlovanju, ne u `vitest`/`tsc` |

### Usklađeni ugovori i dokumentacija (F1 je promijenio ponašanje, ne samo kod)

- **`LoginResponse` je sada unija dvije stvarne grane.** Ruta `POST /api/auth/login` od F1 ima dva
  uspjeha: punu sesiju (role bez 2FA) i **2FA vrata** (`preAuthToken` + `gate`, bez sesije).
  Ugovor je opisivao samo prvu, pa je mobilni klijent dobijao `undefined` tokene i padao na
  validaciji, a web ekran je oblik odgovora pogađao ručno napisanim tipom. Sada:
  `LoginSessionResponse | LoginTwoFactorRequiredResponse`, diskriminant `isTwoFactorRequired()`,
  `enrollmentRequired` u ugovoru, i test uzorak za **oba** oblika.
- **Mobilna prijava ne ostavlja poluspremnu sesiju.** Nalog sa obaveznom 2FA sada dobija jasnu
  `AUTH_2FA_REQUIRED` grešku („prijavite se na webu") umjesto praznog ekrana, i test provjerava
  da se tokeni **ne** upisuju.
- **E2E prijava je dvostepena i ponovljiva.** `loginUi` popunjava kod iz autentikatora kad se polje pojavi;
  demo seed daje sintetičku TOTP tajnu uredskim rolama. Bez toga bi svaki E2E shard stao na
  `/login` — a integracioni testovi bi i dalje bili zeleni (to je bila slijepa tačka).
  Novi integracioni test prolazi **istu** putanju kao čovjek: lozinka → pre-auth → kod → `gx_at`.
  Zaštita od replay-a se time **ne gasi** — testira je integracioni test protiv pravog servera; u
  E2E-u se resetuje samo brojač sintetičkog naloga, i to pod izričitom env zastavicom.
- **`@gradix/domain/server`** je dokumentovan kao jedini dozvoljeni ulaz za serverske module
  (TOTP). Mobilni ga nikad ne uvozi — pravilo stoji u zaglavlju barrella.
- **`STATUS.md` je tvrdio da je sljedeća „Faza 2 — projekti i mehanizacija"**, što je u suprotnosti
  sa `IMPLEMENTATION_PLAN.md` (Faza 2 = Obaveze s rokom). Ispravljeno.

## Brojevi (lokalna provjera, 2026-11-23)

```
migracije       38          tabele          59 (51 tenant)
OpenAPI         109 putanja
pnpm test       813 testa   (web 501 + domain 135 + mobile 81 + db 67 + contracts 21 + worker 8)
pnpm lint       6/6 · pnpm typecheck 6/6 · check-tenant-sql 508 upita ✓
check-matrix-parity 0 grešaka · check-application-coverage 0 grešaka · db:types:check ✓
```

Baza lokalno: embedded Postgres na portu 5433 (`v2/.pg/`, gitignorisano).

## Kako je Faza 1 provjerena

- **Integracioni test na živoj bazi** (`f1-access.integration.test.ts`, 20 testova): RLS izolacija
  svih novih tabela i FORCE RLS, 2FA šifrovanje (pogrešan ključ pada na GCM tagu), replay istog
  koda, jednokratnost recovery kodova, politika lozinki i istorija, lock poslije 10 promašaja,
  rotacija poslije 180 d **samo** uredskim rolama, opoziv pojedinačne/tuđe sesije i „svi ostali“,
  audit metadata `{before, after, changed}` i klase, onboarding u jednoj transakciji sa rollbackom
  i dvostrukim slugom, CHECK-ovi support pristupa.
- **Dvije greške koje su testovi našli, a ne oko:**
  1. `password_history` nije imala `DELETE` grant za `gradix_app` (bootstrap je imao, baza nije) —
     reset lozinke je vraćao 500. Otkrilo se jer test traži stvarni 200, ne mock.
  2. `gate: "ENROLL"` je izdavao **ništa** — uredska rola bez 2FA nije mogla ni da se prijavi ni
     da upari 2FA (kružni argument). Sada se izdaje sesija ograničena na uparivanje (`enr` u
     tokenu, `ENROLLMENT_ALLOWED` u guard-u), a `refresh` ponovo čita stanje iz baze — inače bi
     jedno osvježavanje tokena pretvorilo tu sesiju u punu i zaobišlo obaveznu 2FA.
- **Tačna lozinka više nije promašaj:** prije je svaki `AUTH_2FA_REQUIRED` ulazio u brojač, pa je
  pet ispravnih prijava zaključalo nalog. Sada brojač pune samo `AUTH_INVALID_CREDENTIALS`.
- **Statička provjera tenanta** je otkrila da lista tenant tabela ne pokriva F1 tabele
  (`company_holidays`, `report_jobs`, `daily_rollups`, `user_devices`, `notifications`, …) — lista
  dopunjena na 51.

## Kako je Faza 0 provjerena

- **Worker stvarno radi**, nije samo kompajliran: `ping.health` se izvršio dva puta sa
  `REMINDER_INTERVAL_MINUTES=1`, proces se ugasio uredno, `queueHealth()` je nad tom bazom
  vratio `available:true, completed:4, active:0, stuck:0, stale:false`.
- **Obavještenja protiv žive baze** (`notification.integration.test.ts`, 6 testova): dedupe po
  `dedupe_key`, validacija bez primaoca i bez `href`, tuđe se ne vidi ni ne označava, druga firma
  ne vidi ništa, email bez SMTP-a je `BLOCKED_NO_PROVIDER` i poruka ostaje u inboxu, retencija
  90 d / 1 g / 2 g.
- **Testovi su hvatali prave greške**, ne samo prolazili: `SafeText` je uhvatio `z.string()` u
  `NotificationReadInput` (NUL bi ušao u bazu), `tokens.test.ts` je uhvatio hardkodirani heks u
  `shell.css`, a worker test je uhvatio da `loadConfig(env)` čita `process.env` umjesto `env`.

## Odluke na snazi (iz modula 1–12)

2FA TOTP za OWNER/ADMIN/ACCOUNTANT · pg-boss, **bez Redisa** · jedan `cost_entries` sa 8
`source_type` · satnice samo OWNER/ADMIN/ACCOUNTANT · `SELF_APPROVAL_FORBIDDEN` · cisterna je
skladište `TANK` · situacije prema naručiocu van MVP-a (B15) · dashboard po roli ·
`notifications` sa obaveznim `href` i `dedupe_key` · audit retention 2/5/10 g · `Cmd/Ctrl+K` pod
RLS-om · **bez** AI/vektorske pretrage i **bez** kvalifikovanog e-potpisa u MVP-u.

## Namjerno još nema

- 4 od 6 worker poslova (`reminders.scan`, `budget.thresholds`, `attachments.purge`,
  `sync.purge`) — dolaze sa svojim modulima, jer traže tabele koje još ne postoje.
- Email/push provajder: isporuka je `BLOCKED_NO_PROVIDER`, in-app radi bez njega.
- `report_jobs`, `daily_rollups` — tabele i kostur postoje, poslovi dolaze sa izvještajima (Faza 6).

## Dugovi

- CI job traje ~9 min; kandidat za keširanje `pnpm` store-a.
- `check-matrix-parity` upozorava na jedan `NOT_IMPLEMENTED` (tenant lista do R2) — svjesno,
  zatvara se kad Faza 1 doda tabele R3–R7.
- Maestro tokovi pokrivaju samo R0 offline tokove; „Moji uređaji“ na mobilnom još nema tok.
- Platform sesija živi 8 h i nema refresh — operator se prijavljuje ponovo (namjerno: kraće od
  radnog dana, jer mijenja firme).
- Support pristup se **upisuje** u audit firme, ali još ne otvara ekrane firme kao operator —
  pravi „impersonation“ dolazi sa podrškom u Fazi 7.
