# ADR 0003 — Tenant izolacija: aplikacijski scope + PostgreSQL RLS (dokazano)

**Datum:** 2026-11-07 · **Status:** odobreno (spike u Fazi 1, mini-kapija)

## Kontekst

A3.3.1 traži da je svaki upit tenant-scopovan na jednom mjestu, a RLS se razmatra kao dubinska zaštita. v1 je imao samo aplikacijski scope i **nije imao** ni `SET LOCAL` ni RLS (provjereno grep-om). Cilj spike-a: dokazati da RLS radi uz connection pool, prije nego se na tome sagradi cijeli sistem.

## Odluka

1. **Jedno mjesto za scope:** `withCompany(pool, companyId, fn)` u `@gradix/db` otvara transakciju, izvršava `SELECT set_config('app.company_id', $1, true)` i tek onda posao. Varijabla je `LOCAL` — nestaje sa transakcijom, pa je nemoguće da zahtjev naslijedi tuđu firmu iz pool-a.
2. **RLS kao dubinska zaštita:** `ENABLE` + **`FORCE ROW LEVEL SECURITY`** na `memberships`, `sessions`, `machines`, `audit_events`; politika `USING`/`WITH CHECK` poredi `company_id` sa `current_setting('app.company_id', true)`.
3. **Aplikacija nikad ne radi kao vlasnik šeme ni kao superuser.** Nova rola `gradix_app` (`NOSUPERUSER NOBYPASSRLS`), prava kroz `GRANT` i `ALTER DEFAULT PRIVILEGES` (`packages/db/bootstrap/roles.sql`). Migracije rade vlasničkom rolom.
4. **Bez postavljene varijable politika ne propušta ništa** (fail-closed) — što je i sigurnosno i dijagnostički dobro: zaboravljen scope daje prazan rezultat, ne tuđe podatke.

## Dokaz (8/8 testova, pravi PostgreSQL 16.2)

`packages/db/src/tenant.test.ts`: firma A vidi samo svoje; firma B samo svoje; scope preživljava 20 uzastopnih poziva uz pool `max=2`; bez varijable nema redova; upis u tuđu firmu pada na `WITH CHECK`; `count(*)` bez `WHERE` ne procuri; 10 paralelnih transakcija dvije firme se ne miješaju; greška u transakciji ne lijepi stanje na sljedeći zahtjev.

**Nalaz koji je promijenio implementaciju:** prvi prolaz testova je pao **svih 8** jer sam se konektovao kao `postgres`. PostgreSQL zaobilazi RLS za superusera i (bez `FORCE`) za vlasnika tabele. Bez odvojene `gradix_app` role cijela „dubinska zaštita“ bi bila dekoracija. To je sada tvrdo pravilo i za Coolify.

## Alternative

1. **Samo aplikacijski scope (kao v1)** — jedan zaboravljen `WHERE` curi podatke druge firme. Odbačeno.
2. **Samo RLS, bez aplikacijskog scope-a** — svaki upit mora biti u transakciji; jednostavnije greške su tihe, a debugging teži. Odbačeno kao *jedini* mehanizam.
3. **Odvojena šema/baza po firmi** — najjača izolacija, ali migracije × N firmi i teži SaaS. Odbačeno za ovu fazu.

## Posljedice

- Generisani test izolacije po resursu (A3.3.1) sada ima čvrst temelj; piše se u Fazi 2 kao šablon `new-resource`.
- **Cijena:** svaki poslovni upit ide u transakciju. Prihvatljivo (p95 budžet 300 ms), ali mjeri se.
- **Rizik:** `SET LOCAL` + connection pooling kroz PgBouncer u transaction mode — radi (varijabla je u transakciji), ali to treba potvrditi prije uvođenja PgBouncera.
- Postgres role i GRANT-ovi su dio deploya, ne aplikacije: Coolify mora imati `gradix_app` rolu prije prve migracije.
