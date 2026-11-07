# ADR 0007 — Jedna rola `gradix_app` kao vlasnik šeme (Coolify realnost)

**Datum:** 2026-11-07 · **Status:** prihvaćeno · **Mijenja:** dio ADR 0003 (pretpostavku o dvije role)

## Kontekst

ADR 0003 je pretpostavio dvije role: `postgres` (vlasnik šeme, radi migracije) i
`gradix_app` (NOSUPERUSER, samo DML). Realnost na serveru: u Coolifyju postoji **jedan**
korisnik, `gradix_app`, i on posjeduje bazu `gradix` i tabele. Vlasnik nema lokalni Docker
niti lokalnu bazu — sve se provjerava na `https://gradix.ba101.top`.

Prije ove odluke aplikacija je u tom setupu **padala** na prijavi (403/500), a razlog nije
bio očigledan.

## Odluka

Aplikacija radi ispravno i sa **jednom** rolom koja posjeduje šemu, pod tri uslova:

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

* **Pozitivno:** jedan korisnik baze je dovoljan; nema razlike između modela A i B —
  testovi (db 10/10, web 8/8) prolaze u oba, i na svježoj bazi.
* **Pozitivno:** `DATABASE_ADMIN_URL` je u Coolifyju opcion — entrypoint koristi
  `DATABASE_URL` za migracije.
* **Negativno:** dvije dodatne politike na dvije tabele; svaka nova „lookup prije tenanta“
  operacija mora dobiti svoju usku politiku, ne smije se proširiti postojeća.
* **Čuvar:** `tenant.test.ts` ima test koji dokazuje da bez ključa nema redova, da ključ
  za korisnika A ne otvara članstva korisnika B i da se ključ ne lijepi na sljedeću
  transakciju na istoj konekciji.
