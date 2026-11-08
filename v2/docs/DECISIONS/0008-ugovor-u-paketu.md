# ADR 0008 — Ugovor u `packages/contracts`, ne generisan iz ruta

**Datum:** 2026-11-08 · **Status:** prihvaćeno

## Kontekst

Web i mobilni pričaju sa istim API-jem, ali su do sada svaki imali svoju kopiju oblika odgovora:
katalog kodova grešaka u `apps/web/src/server/api.ts`, ručno prepisani tipovi u
`apps/mobile/src/api/client.ts`. Dvije kopije istog ugovora se raziđu tiho — ruta vrati kod koji
klijent ne poznaje, ili polje koje klijent ne čita, i to se vidi tek na uređaju.

Tražena su dva pravca: (a) OpenAPI **generisan iz koda** (iz `route.ts`), (b) ugovor kao **izvor**
iz kojeg se generiše OpenAPI i iz kojeg klijent dobija tipove.

## Odluka

**(b).** `packages/contracts` sadrži:

1. `envelope.ts` — `ERROR_CODES` i `ERROR_STATUS` (jedini katalog; `server/api.ts` ih re-izvozi).
2. `schemas.ts` — Zod šeme zahtjeva i odgovora.
3. `routes.ts` — registar ruta (`method`, `path`, `auth`, `permission`, šeme, `meta`, `query`).
4. `types.ts` — `RouteResponse<"GET", "/api/me">` izveden iz registra.
5. `client.ts` — `createClient()`: envelope, `ApiError`, provjera šeme u oba smjera.
6. `openapi.ts` + `scripts/generate-openapi.ts` → `openapi.json`; `check-openapi.ts` u CI-ju.

## Zašto ne generisanje iz ruta

`route.ts` izvozi `Response`, pa tip odgovora **ne postoji u kodu**. Generisanje bi tražilo da
svaka ruta piše Zod šemu i vraća je kroz helper — to je veći rez od ovog paketa i mijenja svih 19
ruta. Uz to, OpenAPI iz ruta opisuje šta ruta **može** vratiti, ne šta klijent **smije** zvati;
registar je ujedno i spisak dozvola po ruti.

## Šta sprečava razilaženje

Test `src/contract.test.ts` čita `apps/web/src/app/api/**/route.ts` i pada ako:

- ruta u aplikaciji nema ulaz u ugovoru ili obratno,
- aplikacija drži svoju kopiju `ERROR_CODES` umjesto da koristi ugovor,
- `openapi.json` nije regenerisan (`scripts/check-openapi.ts` u CI-ju).

Provjera šeme u klijentu je uvijek uključena (jeftina): odgovor koji ne odgovara ugovoru daje
`ApiError` sa jasnom porukom, umjesto `undefined` na ekranu.

## Posljedice

- Nova ruta = ulaz u `routes.ts` + šema; bez toga CI pada. To je namjerno trenje.
- Promjena oblika odgovora mijenja tip u webu i mobilnom u istom commitu.
- `openapi.json` je generisan fajl u repou; ne uređuje se ručno.
- Ako se u R2 pokaže da ruta ima oblik koji Zod ne opisuje (npr. stream fajla), ruta se označi
  `raw: true` i izuzme iz envelope-a — kao `/api/health` i `/api/ready`.
