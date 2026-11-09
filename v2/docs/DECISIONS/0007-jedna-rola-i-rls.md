# ADR 0007 — Istorijski Coolify model s jednom vlasničkom rolom `gradix_app`

**Datum:** 2026-11-07 · **Status:** superseded za deploy modelom u ADR 0012 (2026-11-09); tehnički nalaz o RLS lookup politikama ostaje · **Historijski zapis:** dokumentuje raniju Coolify konfiguraciju sa jednom rolom.

## Kontekst

ADR 0003 je pretpostavio dvije role: `postgres` (vlasnik šeme, radi migracije) i
`gradix_app` (NOSUPERUSER, samo DML). U vrijeme ove odluke vlasnik je prijavio Coolify
konfiguraciju sa **jednom** rolom, `gradix_app`, koja je posjedovala bazu `gradix` i tabele.
To je istorijski izvještaj, ne nezavisna potvrda današnjeg staginga; staging role i vlasništvo
ostaju otvoreni za provjeru. Tada se sve provjeravalo na `https://gradix.ba101.top`.

Prije ove odluke aplikacija je u tom setupu **padala** na prijavi (403/500), a razlog nije
bio očigledan.

## Ranija odluka (više nije podržani deploy model)

U trenutku pisanja zaključeno je da aplikacija radi i sa **jednom** rolom koja posjeduje šemu,
pod tri uslova. To ostaje istorijski nalaz/testni slučaj, ali ADR 0012 je kasnije postavio
ne-vlasničku aplikacijsku rolu kao obavezan uslov deploya; runtime preflight sada odbija
`DATABASE_URL` koji je vlasnik tabela.

1. `FORCE ROW LEVEL SECURITY` na svakoj tenant tabeli (već postoji od migracije `init`).
2. Rola je `NOSUPERUSER NOBYPASSRLS` (provjerava `assertRlsEnforceable` pri prvom upitu).
3. Upiti za prijavu/refresh idu kroz **namjenske RLS politike vezane na tačan ključ**,
   ne kroz `SECURITY DEFINER`.

## Zašto `SECURITY DEFINER` nije rješenje

`SECURITY DEFINER` izvršava funkciju kao vlasnik funkcije. U modelu sa jednom rolom to je
`gradix_app` — a `FORCE RLS` važi **i za vlasnika tabela**. Zato je `auth_memberships()`
vraćala nula redova, a `auth_session_by_hash()` nije nalazila sesiju. U modelu sa dvije
role ista funkcija je „radila“ samo zato što je vlasnik bio superuser, a superuser uvijek
zaobilazi RLS — dakle iz pogrešnog razloga.

`SET row_security = off` ne pomaže: PostgreSQL ga odbija uz `FORCE RLS`
(`query would be affected by row-level security policy`).

## Šta je urađeno umjesto toga

| Tabela | Politika | Uslov | Dozvoljeno |
|---|---|---|---|
| `memberships` | `auth_lookup_membership` | `user_id = current_setting('app.auth_lookup_user')` | samo `SELECT` |
| `sessions` | `auth_lookup_session` | `token_hash = current_setting('app.auth_lookup_token')` | samo `SELECT` |

Ključ postavlja isključivo server (`apps/web/src/server/auth-lookup.ts`), kroz `SET LOCAL`
u transakciji, tek nakon provjerene lozinke odnosno posjedovanja refresh tokena. Bez ključa
politika ne propušta ništa (fail-closed). Opseg čitanja nije veći od onoga što funkcija
ionako vraća za proslijeđeni parametar.

## Posljedice

* **Istorijski test:** db 10/10 i web 8/8 prolazili su uz jednu vlasničku rolu i uz dvije role;
  to dokazuje ponašanje tadašnje testne konfiguracije, ne podržanost vlasničke aplikacijske role.
* **Superseded:** `DATABASE_ADMIN_URL` nekad bio opcion, a entrypoint koristio `DATABASE_URL`
  za migracije. ADR 0012 i runtime entrypoint sada traže odvojeni `DATABASE_ADMIN_URL`
  kad `RUN_MIGRATIONS=true`.
* **Negativno:** dvije dodatne politike na dvije tabele; svaka nova „lookup prije tenanta“
  operacija mora dobiti svoju usku politiku, ne smije se proširiti postojeća.
* **Čuvar:** `tenant.test.ts` ima test koji dokazuje da bez ključa nema redova, da ključ
  za korisnika A ne otvara članstva korisnika B i da se ključ ne lijepi na sljedeću
  transakciju na istoj konekciji.
