# Modul 1 — Firma, korisnici, role i audit: plan

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [02-DIZAJN.md](02-DIZAJN.md), [PRAVILA.md](../PRAVILA.md).

**Status:** redoslijed rada za odobrenje; nema odobrenja za implementaciju.

## Kapija

G0 je potvrđen i četiri dokumenta Modula 1 su predana kao radna sinteza. Nalazi nisu konačno ocijenjeni. Svaki poslovni kod, migracija, UI ili deployment promjena čeka izričitu vlasnikovu frazu **`KREĆEMO U KODIRANJE: 1`**. Ne ostavljati `DATABASE_ADMIN_URL` u web runtime-u kao prečicu. Nema izvršenih testova/typecheck/lint/build/preflight/deploy u ovoj sesiji.

## Redoslijed predloženog rada

### A. Zaključati sigurnosne i ugovorne odluke

Vlasnik potvrđuje platform DB principal, MFA operatora, passkey ekvivalenciju, višefirmski login, retencijski model, outbox vlasništvo i polja ličnih naspram firmnih postavki. Pošto su neka pitanja izvan koda, zabilježiti odluku prije mijenjanja specifikacije ili ACL-a. Odabrati tačan isporučivi obim i konačnu težinu F1-01–F1-09.

**Izlaz:** odobreni dizajn i testabilni acceptance kriteriji; bez koda dok nema fraze iz kapije.

### B. Učiniti platform tok bezbjednim i upotrebljivim

1. Zamijeniti nedostupnu/pretjerano privilegovanu runtime vezu zasebnim, recenziranim platform principalom/operacijama; dodati ga u ACL matricu i preflight. Migratorski kredencijali ostaju van Node procesa.
2. Uskladiti onboarding request/response između `PlatformCompanyCreateInput`, rute, servisa i ekrana; dovršiti specifikacijskih pet koraka, vlasničke podatke i seed zahtjeve; osigurati da se konflikt sluga vraća kao kontrolisan `CONFLICT`, uključujući konkurentni pokušaj.
3. Implementirati MFA operatora samo prema potvrđenoj politici. Dovršiti support tok tako da grant stvarno ograniči platformsku podršku i bude vidljiv firmi; ne otvarati opći tenant pristup.

**Prihvat:** API i UI e2e kreiraju firmu tačno jednom, pozivnica se prikazuje jednom, invalidan payload ne stvara podatke; runtime platform rola ne može čitati proizvoljne poslovne zapise; support pristup ističe i ostavlja provjerljiv trag.

### C. Zatvoriti identitetske i sesijske invarijante

1. Primijeniti odluku o 180-dnevnom isteku kroz centralnu prijavu/guard; testirati uredske i terenske role, promjenu lozinke i refresh.
2. U `changeMembership` izmjenu + opoziv sesija + audit izvršiti u istoj transakciji; test poziva servis/API, ne ručno SQL.
3. Uskladiti passkey i TOTP politiku; testirati i lozinku, passkey, recovery i obavezne role prema istoj odluci.
4. Ako se zadrži specifikacija sesija: osvježavati `last_seen_at`, prikazati IP hash i povezati administratorske sesije/reset 2FA u korisnički detalj; provjeriti da se ne vraćaju tokeni/sirovi UA.

**Prihvat:** promjena prava važi odmah i stare sesije su opozvane; istek lozinke vodi samo u dozvoljeni reset tok; UI prikazuje podatke iz servera uz auditiran admin opoziv.

### D. Završiti lifecycle pozivnica, reset i postavki

Dodati potvrđeni self-service reset i dostavu kroz zajednički notification ugovor; bez SMTP-a eksplicitno prikazati `BLOCKED_NO_PROVIDER`, nikad lažno „poslano“. Razgraničiti administrativni outbox/retry s Modulom 12. Dodati korisničke `locale`/`timezone` preferencije i firmne valutu/zonu samo ako ih vlasnik potvrdi u obimu; zadržati izmjene uz audit.

**Prihvat:** javni zahtjev za reset ne otkriva postojanje emaila; token je jednokratan i hashiran; pozivnica/reset ima status dostave; korisnički override i firmni default se ne miješaju.

### E. Završiti audit i matrice

Klasifikovati svaku audit akciju, uvesti izvršivu retenciju i odobriti purge/archive ponašanje; dodati audit događaje za obračun i osjetljive priloge. Standardizovati metadata i rekurzivnu zabranu tajni. Dodati oznake osjetljivosti u permission metadata/UI i pokriti ih testom.

**Prihvat:** finansijski i pristupni događaji imaju očekivane klase; osjetljiva čitanja su provjerljiva; purge je idempotentan, tenant-siguran i ostavlja sažeti dokaz.

## Predloženi dokazi nakon odobrenog koda

- **DB/RLS/ACL:** `packages/db/src/tenant.test.ts`, `packages/db/src/passkeys-rls.integration.test.ts`, F1 preflight i ACL parity.
- **Servisi/API:** `f1-access.integration.test.ts`, `access.integration.test.ts`, `rbac.integration.test.ts`, `two-factor-lifecycle.integration.test.ts`, `two-factor-app-role.integration.test.ts`, `passkeys.integration.test.ts`, `retention.integration.test.ts`; dodati end-to-end test za platform login/onboarding/support i `changeMembership` opoziv.
- **UI/ugovor:** `users-client.test.tsx`, `roles-client.test.tsx`, `postavke-client.test.tsx`, `sigurnost-tab.test.tsx`, `audit-client.test.tsx`; OpenAPI/contract provjera i test stvarnog onboarding request/response-a.
- **Operativno:** provjeriti Coolify env bez vlasničke runtime veze, uloge u bazi, migraciju i support banner na odobrenom okruženju. CI/test prolaz ne dokazuje deploy ni vlasnikov pregled uživo.

Ovo su budući dokazi, ne tvrdnja da su komande sada pokrenute. Nakon rada osvježiti quality registry samo stvarnim rezultatima, pa predati Modul 1 na vlasnički pregled. Sljedeći audit modul prati odobreni redoslijed programa; G1 tek nakon 12 modula i `00-UKRSTENO.md`.