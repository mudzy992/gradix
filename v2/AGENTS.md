# Gradix v2 — upute agentu

Gradix je operativni sistem za firmu koja radi niskogradnju: projekti, radnici, mašine, sati,
rokovi, dokumenti i trošak na jednom mjestu. Podatak se unosi jednom, na terenu, i teče dalje.
Pilot firma ima 80 radnika, 40 mašina i 12 istovremenih projekata; njeni najveći problemi su
raspored radnika, praćenje mašina i gorivo. Mjerilo uspjeha je da stvarni korisnik radi brže,
ne broj testova ni količina dokumentacije. Sve odluke i granice opsega su u `MASTER_BRIEF.md`
(korijen repoa) i `docs/DECISIONS/`.

## Komande

```bash
pnpm install          # zavisnosti (pnpm 9, Node 22+)
pnpm test             # vitest u svim paketima (db testovi traže DATABASE_URL)
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit u svim paketima
pnpm build            # turbo build
```

Baza (lokalno): `psql -f packages/db/prisma/migrations/<migracija>/migration.sql`, pa
`psql -f packages/db/bootstrap/roles.sql`. Aplikacija se konektuje kao `gradix_app`, **nikad** kao
vlasnik šeme ni superuser (ADR 0003).

## Struktura

```
apps/web        Next.js (App Router) — web panel i /api            [korak 6]
apps/mobile     Expo — offline-first teren                          [korak 7]
apps/worker     pozadinski poslovi                                  [kad bude 2. posao]
packages/db     migracije, tenant scope (withCompany), RLS
packages/domain čista poslovna logika (Money, datumi, pravila)
packages/contracts zod + OpenAPI generisan iz koda                  [korak 8]
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
8. **Rez je gotov** kad ga vlasnik prođe uživo i odobri; zeleni CI nije dokaz.
9. **v1 se ne dira.** Samo čitanje radi domena i infrastrukture. Preuzeto se označava
   `Izvor: v1/<putanja>`.
10. **Paginacija:** cursor je zadana; offset samo za male administrativne tabele.

## Dublje

`docs/STATUS.md` (trenutno stanje) · `docs/DECISIONS/` (ADR 0001 G0 odluke, 0002 Prisma blokada,
0003 tenant/RLS, 0004 novac) · `docs/PRODUCT/00-razumijevanje-i-pitanja.md` · `MASTER_BRIEF.md`.
