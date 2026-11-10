# Gradix v2 — upute agentu

Gradix je operativni sistem za firmu koja radi niskogradnju: projekti, radnici, mašine, sati,
rokovi, dokumenti i trošak na jednom mjestu. Podatak se unosi jednom, na terenu, i teče dalje.
Pilot firma ima 80 radnika, 40 mašina i 12 istovremenih projekata; njeni najveći problemi su
raspored radnika, praćenje mašina i gorivo. Mjerilo uspjeha je da stvarni korisnik radi brže,
ne broj testova ni količina dokumentacije. Sve odluke i granice opsega su u `MASTER_BRIEF.md`
(korijen repoa) i `docs/DECISIONS/`.

## Komande

```bash
pnpm install                  # zavisnosti (pnpm 9, Node 22+)
./infra/scripts/dev-up.sh     # baza + migracije + demo podaci (jednom komandom)
pnpm --filter @gradix/web dev # web + /api na 3000
pnpm test                     # vitest u svim paketima (db/web testovi traže DATABASE_URL)
pnpm test:a11y                # samo a11y + tastatura (axe, WCAG 2.1 AA) — korak u CI-ju
pnpm lint                     # eslint
pnpm typecheck                # tsc --noEmit u svim paketima
pnpm build                    # turbo build
```

Baza: `infra/scripts/db-apply.sh` primjenjuje migracije iz `packages/db/prisma/migrations/` i
bootstrap rola. Aplikacija se konektuje kao `gradix_app`, **nikad** kao vlasnik šeme ni superuser
(ADR 0003). Demo tok i prijavne podatke vidi `docs/DEMO-G1.md`, pokretanje mobilnog u Expo Go
`docs/MOBILE-EXPO-GO.md`.

Mobilni: verzije `react-native`/`react`/`expo-*` **moraju** odgovarati tabeli SDK-a. Provjera je
`pnpm check-expo` (radi u CI, bez mreže). `expo export -p web` prolazi i kad native bundle puca —
native se provjerava sa `npx expo export -p android`.

## Struktura

```
apps/web        Next.js 16 (App Router) — web panel i /api          [R0 ✅]
apps/mobile     Expo 58 — offline-first teren, jedan ekran           [R0 ✅]
apps/worker     pozadinski poslovi                                  [kad bude 2. posao]
packages/db     migracije, tenant scope (withCompany), RLS          [R0 ✅]
packages/domain čista poslovna logika (Money, sesije, sync, datumi)  [R0 ✅]
packages/contracts zod + OpenAPI generisan iz koda                  [DUG: nije urađeno]
packages/ui     dizajn sistem i komponente                          [Faza 2]
packages/config tsconfig, eslint
infra/          Docker, Coolify, skripte, redis ACL
docs/           STATUS.md, DECISIONS/ (ADR), PRODUCT/, PLAN.md
```

## Pravila koja se ne krše

1. **Tenant:** svaki upit ide kroz `withCompany` iz `@gradix/db`. Nikad ručni `WHERE company_id`.
   RLS je uključen i forsiran; aplikacijska rola nije vlasnik tabela.
2. **Novac:** samo `Money` iz `@gradix/domain` (BigInt centi + valuta). Nikad `number` za novac.
   Na granicama decimalni string; zaokruživanje samo kroz `roundToCents`.
3. **Vrijeme:** UTC u bazi; poslovni datumi kao kalendarski datum uz zonu firme.
4. **API:** jedan tipizirani HTTP API za web i mobilni; OpenAPI se generiše iz koda.
5. **Tajne:** nikad u repou. Nova varijabla = unos u `.env.example` (ime + opis) i u Coolify.
6. **Zavisnost:** nova biblioteka traži ADR (problem, alternative, rizik).
7. **Dokumentacija:** `STATUS.md` ≤ 100 linija, ADR ≤ 1 stranica, ukupno `docs/` ≤ 30 stranica.
   Nema dnevnika, ledžera nalaza ni samoinicijativnih audita.
8. **Rez je gotov** kad ga vlasnik prođe uživo i odobri; zeleni CI nije dokaz. Rez nije
   gotov dok svaka rola ne može iz menija stići do svake funkcije koju smije i odjaviti
   se; E2E to dokazuje (Playwright u CI-ju, dio A).
9. **v1 se ne dira.** Samo čitanje radi domena i infrastrukture. Preuzeto se označava
   `Izvor: v1/<putanja>`.
10. **Paginacija:** cursor je zadana; offset samo za male administrativne tabele.
11. **Dizajn:** izvor istine je **samo** `docs/design/DESIGN.md` + `docs/design/reference.html`;
    referenca ima prednost. Paleta je zatvorena na šest boja — svaka druga nijansa je
    `color-mix`. Nijedna komponenta ne sadrži heks. Fontovi samo `next/font` (Manrope, IBM Plex
    Mono). Odstupanje od reference ili nova komponenta traži vlasnikovu riječ **i** dopunu
    `reference.html` u istom commitu.

## Dublje

`docs/STATUS.md` (trenutno stanje) · `docs/DECISIONS/` (0001 G0 odluke, 0002 Prisma blokada,
0003 tenant/RLS, 0004 novac, 0005 sesije, 0006 MinIO bucket) · `docs/DEMO-G1.md` (kako pokazati)
· `docs/design/DESIGN.md` + `reference.html` (dizajn) · `docs/DEMO-DIZAJN.md` (snimci i
odobrena odstupanja od reference) · `docs/GH-SECRETS.md` (koje varijable trebaju) ·
`MASTER_BRIEF.md`.
