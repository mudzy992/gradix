# Gradix v2 — upute agentu

Gradix je operativni sistem za firmu koja radi niskogradnju: projekti, radnici, mašine, sati,
rokovi, dokumenti i trošak na jednom mjestu. Podatak se unosi jednom, na terenu, i teče dalje.
Pilot firma ima 80 radnika, 40 mašina i 12 istovremenih projekata; njeni najveći problemi su
raspored radnika, praćenje mašina i gorivo. Mjerilo uspjeha je da stvarni korisnik radi brže,
ne broj testova ni količina dokumentacije. Sve odluke i granice opsega su u `MASTER_BRIEF.md`
(korijen repoa) i `docs/DECISIONS/`.

Ovaj direktorij (`v2/`) je **jedini** izvor koda. Ništa izvan `v2/` se ne čita ni ne pominje.

## Komande

```bash
pnpm install                  # zavisnosti (pnpm 9, Node 22+)
./infra/scripts/dev-up.sh     # baza + migracije + demo podaci (jednom komandom)
pnpm --filter @gradix/web dev # web + /api na 3000
pnpm test                     # vitest u svim paketima (db/web testovi traže DATABASE_URL)
pnpm test:a11y                # samo a11y + tastatura (axe, WCAG 2.1 AA) — korak u CI-ju
pnpm lint                     # eslint (uključuje jsx-a11y i zabranu sirovih elemenata)
pnpm typecheck                # tsc --noEmit u svim paketima
pnpm build                    # turbo build
pnpm check-tenant-sql         # nijedan upit ne smije ići mimo withCompany
pnpm check-matrix-parity      # privilegije u kodu = privilegije u bazi
pnpm db:types:check           # schema.generated.ts je ažuran prema migracijama
```

Baza: `infra/scripts/db-apply.sh` primjenjuje migracije iz `packages/db/migrations/` i
bootstrap rola. Aplikacija se konektuje kao `gradix_app`, **nikad** kao vlasnik šeme ni superuser
(ADR 0003). Preflight (`packages/db/preflight-checks/run.sh`) provjerava RLS **i** grant za svaku
tabelu; pada li, aplikacija se ne podiže. Pokretanje mobilnog u Expo Go: `docs/MOBILE-EXPO-GO.md`.

Mobilni: verzije `react-native`/`react`/`expo-*` **moraju** odgovarati tabeli SDK-a. Provjera je
`pnpm check-expo` (radi u CI, bez mreže). `expo export -p web` prolazi i kad native bundle puca —
native se provjerava sa `npx expo export -p android`.

Worker (pg-boss, bez Redisa) traži `DATABASE_ADMIN_URL` jer sam pravi `pgboss` šemu:
`pnpm --filter @gradix/worker dev`. Canarinac `ping.health` je dokaz da red radi; stanje reda
se gleda na `GET /api/health/queue`, a liveness `GET /api/health` **ne dira bazu** namjerno.

## Struktura

```
apps/web        Next.js 16 (App Router) — web panel i /api
apps/mobile     Expo 58 — offline-first teren
apps/worker     pg-boss poslovi (ping.health, notifications.deliver, …)
packages/db     migracije, tenant scope (withCompany), RLS, schema.generated.ts
packages/domain čista poslovna logika (Money, sesije, sync, datumi, matrice dozvola)
packages/contracts zod šeme + ROUTES → openapi.json (jedan izvor)
packages/design dizajn tokeni (TS) — web ih čita, hex živi samo u globals.css
packages/config tsconfig, eslint
infra/          Docker, Coolify, skripte, backup/restore
quality/        parity i application coverage registri (CI gate)
docs/           STATUS.md, DECISIONS/ (ADR), PRODUCT/, specs/, design/, IMPLEMENTATION_PLAN.md
```

## Pravila koja se ne krše

1. **Tenant:** svaki upit ide kroz `withCompany` iz `@gradix/db`. Nikad ručni `WHERE company_id`.
   RLS je uključen i forsiran; aplikacijska rola nije vlasnik tabela. Provjerava
   `pnpm check-tenant-sql`.
2. **Novac:** samo `Money` iz `@gradix/domain` (BigInt centi + valuta). Nikad `number` za novac.
   Na granicama decimalni string; zaokruživanje samo kroz `roundToCents`.
3. **Vrijeme:** UTC u bazi; poslovni datumi kao kalendarski datum uz zonu firme.
4. **API:** jedan tipizirani HTTP API za web i mobilni. Nova ruta i njen ulaz u `ROUTES` idu u
   **istom** commitu — `contract.test.ts` je dvosmjeran, `pnpm --filter @gradix/contracts check`
   provjerava da je `openapi.json` regenerisan.
5. **Tajne:** nikad u repou. Nova varijabla = unos u `.env.example` (ime + opis) i u Coolify.
6. **Zavisnost:** nova biblioteka traži ADR (problem, alternative, rizik).
7. **Dokumentacija:** `STATUS.md` ≤ 100 linija, ADR ≤ 1 stranica, ukupno `docs/` ≤ 30 stranica.
   Nema dnevnika, ledžera nalaza ni samoinicijativnih audita.
8. **Rez je gotov** kad ga vlasnik prođe uživo i odobri; zeleni CI nije dokaz. Rez nije
   gotov dok svaka rola ne može iz menija stići do svake funkcije koju smije i odjaviti se;
   E2E to dokazuje (Playwright u CI-ju, dio A).
9. **Nove tabele:** migracija + politika + grant u istoj izmjeni (preflight i
   `privilege-matrix.tsv` to traže), pa `pnpm db:types` u istom commitu.
10. **Paginacija:** cursor je zadana; offset samo za male administrativne tabele.
11. **Dizajn:** izvor istine je **samo** `docs/design/DESIGN.md` + `docs/design/reference.html`;
    referenca ima prednost. Paleta je zatvorena na šest boja — svaka druga nijansa je
    `color-mix`. Nijedna komponenta ne sadrži heks (`tokens.test.ts` pada na `#rrggbb`).
    Fontovi samo `next/font` (Manrope, IBM Plex Mono). Odstupanje od reference ili nova
    komponenta traži vlasnikovu riječ **i** dopunu `reference.html` u istom commitu.
    **UI sistem (U):** ekran se slaže od postojećih komponenti (`components/ui` web,
    `src/ui` mobile — katalog `/katalog`, mobilni ekran iza dev prekidača) i to **ne traži
    odobrenje**. Nova vrsta komponente ili novi vizuelni obrazac traži vlasnikovo odobrenje
    i dopunu kataloga i `reference.html` u istom commitu. Sirovi elementi po ekranima su
    zabranjeni lintom (U3); izuzeci žive u `docs/UI-EXCEPTIONS.md` i smiju se samo smanjivati.
    **Catalog-first:** nova stranica ili novi vizuelni obrazac → prvo `reference.html` +
    `/katalog`, pa vlasnikovo **„ovako“**, tek onda route/servis. Nova komponenta van
    kataloga → **STOP** (vidi `docs/design/DESIGN.md` §Catalog-first).
12. **Granica server/klijent:** serverska komponenta (bez `"use client"`) nikad ne
    prosljeđuje funkcije kao propove klijentskim komponentama (DataTable `cell`,
    handleri, `actions`) — React ih ne može serijalizovati i stranica pada tek u
    runtime-u. Funkcije žive u klijentskom omotaču uz tabelu. Provjerava
    `server-boundary.test.ts` i E2E smoke svih ruta.
13. **Obavještenja:** jedini ulaz je `notify()` u `apps/web/src/server/notification-service.ts`.
    `href` je obavezan i počinje s `/`; `dedupe_key` je unikatan po firmi, pa posao koji se
    ponavlja ne puni inbox. In-app kanal je obavezan i radi bez SMTP-a; email bez SMTP-a je
    `BLOCKED_NO_PROVIDER` i poruka ostaje u inboxu. Ne pisati u `notifications` direktno.
14. **Liveness ne dira bazu:** `/api/health` je čist procesni odgovor. Pad baze ne smije
    pokretati restart-loop kontejnera. Stanje reda i baze ide na `/api/health/queue`.
15. **Worker:** tenant se postavlja **po poslu** (`app.company_id`), nikad jednom za proces.
    Posao mora biti idempotentan — pg-boss ga ponavlja, a retry je pravilo, ne izuzetak.

## Dublje

`docs/STATUS.md` (trenutno stanje) · `docs/IMPLEMENTATION_PLAN.md` (redoslijed faza) ·
`docs/DECISIONS/` (0015: baza je izvor istine — nema Prisme, shema kroz SQL migracije) ·
`docs/specs/01…12` (zaključane specifikacije po modulima) ·
`docs/design/DESIGN.md` + `reference.html` (dizajn) · `MASTER_BRIEF.md` (korijen repoa).
