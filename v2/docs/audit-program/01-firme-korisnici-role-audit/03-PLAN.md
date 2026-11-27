# Modul 1 — Firma, korisnici, role i audit: plan

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [02-DIZAJN.md](02-DIZAJN.md), [PRAVILA.md](../PRAVILA.md).

**Status:** redoslijed rada za odobrenje; nema odobrenja za implementaciju.

## Kapija

Vlasnik je potvrdio S1/S2/S3 mapu, uključujući F1-03b i F1-04c kao S1, te obavezni platform TOTP, purge sign-off po spec rokovima, non-BYPASSRLS ACL smjer i lokalizaciju samo po specu. F1-03b platform policy još treba prenijeti u normativni spec 01 §1.8; TOTP lifecycle i konačni column ACL, RLS politike i zasebni preflight ostaju otvoreni. Kod i dalje čeka zasebnu frazu.

## Redoslijed predloženog rada

### A. Zatvoriti preostale sigurnosne i ugovorne odluke

Vlasnik je potvrdio S1 za F1-01/F1-02/F1-03b/F1-04c; S2 za F1-03a, F1-04a–b, F1-05–F1-07, F1-08 postavke i F1-09; te S3 za položaj taba u F1-08. Tenant i platform TOTP, zaseban non-BYPASSRLS principal, podjela obavještenja (M1 emituje, M12 vodi outbox/dostavu/retry), purge sign-off po spec rokovima i lokalizacijski obim samo po specu su potvrđeni. Statički SQL inventar je urađen; prije koda treba sinhronizovati novu TOTP odluku u spec 01 §1.8 i dovršiti TOTP lifecycle te tačan column ACL + RLS/preflight model. Kod nije odobren.

**Izlaz:** odobreni dizajn i testabilni acceptance kriteriji; bez koda dok nema fraze iz kapije.

### B. Učiniti platform tok bezbjednim i upotrebljivim

1. Nakon odobrenja dizajna, implementirati zasebnu platform runtime rolu (ne `DATABASE_ADMIN_URL`) sa tačnim, po mogućnosti column-level grantovima prema inventaru u `01-AUDIT.md`; bez vlasništva, `BYPASSRLS`, članstva u app/migrator roli, `CREATE` ili podrazumijevanih grants. Dodati zasebnu platform ACL matricu i preflight koji provjerava efektivni ACL i RLS politike; `gradix_app` matrica sama nije dovoljna. PostgreSQL test mora kreirati firmu i seed kategorije pod ciljnom no-BYPASS konfiguracijom, posebno provjeriti `companies_seed_equipment_categories` trigger. Migratorski kredencijali ostaju van Node procesa.
2. Uskladiti onboarding request/response između `PlatformCompanyCreateInput`, rute, servisa i ekrana; dovršiti specifikacijskih pet koraka, vlasničke podatke i seed zahtjeve; osigurati da se konflikt sluga vraća kao kontrolisan `CONFLICT`, uključujući konkurentni pokušaj.
3. Provesti vlasnički potvrđeni obavezni TOTP za svaki platform login tek nakon što su odobreni secret storage, enrollment/first-operator bootstrap, pre-auth challenge i recovery/reset tok; sesija ne smije nastati prije TOTP-a. F1-03b je S1 i blokira prihvatanje do zatvaranja. Dovršiti support tok prema specu: scoped pristup, obavezan razlog, rok ≤60 min i vidljivi tenant banner; ne otvarati opći tenant pristup.

**Prihvat:** API i UI e2e kreiraju firmu tačno jednom, pozivnica se prikazuje jednom, invalidan payload ne stvara podatke; onboarding seed trigger radi pod ciljanom no-BYPASS rolom; runtime platform rola ne može čitati proizvoljne poslovne zapise; support pristup ističe i ostavlja provjerljiv trag.

### C. Zatvoriti identitetske i sesijske invarijante

1. Zatvoriti TOTP gate u passkey putanji prije sesije za OWNER/ADMIN/ACCOUNTANT; passkey nije zamjena prema potvrđenoj politici. Dodati test koji pokušava passkey prijavu bez TOTP.
2. Primijeniti 180-dnevni istek kroz centralnu prijavu/guard; testirati uredske/terenske role, promjenu lozinke i refresh.
3. U `changeMembership` izmjenu + opoziv sesija + audit izvršiti u istoj transakciji; test poziva servis/API, ne ručno SQL.
4. Osvježavati `last_seen_at`, prikazati IP hash i povezati administratorske sesije/reset 2FA u korisnički detalj; ne vraćati tokene/sirovi UA.

**Prihvat:** promjena prava važi odmah i stare sesije su opozvane; istek lozinke vodi samo u dozvoljeni reset tok; UI prikazuje podatke iz servera uz auditiran admin opoziv.

### D. Završiti lifecycle pozivnica, reset i postavki

Modul 1 emituje invite/reset događaje; Modul 12 isporučuje ih kroz zajednički outbox i vodi status/retry UI. Dodati self-service reset; bez SMTP-a prikazati `BLOCKED_NO_PROVIDER`, nikad lažno „poslano“. Ne praviti paralelni outbox. Korisničke i firmine lokalizacijske postavke implementirati u potvrđenom obimu uz audit.

**Prihvat:** javni zahtjev za reset ne otkriva postojanje emaila; token je jednokratan i hashiran; pozivnica/reset ima status dostave; korisnički override i firmni default se ne miješaju.

### E. Završiti audit i matrice

Klasifikovati svaku audit akciju i dodati izvršivu retenciju/read writers. Vlasnik je potvrdio pravnu/računovodstvenu saglasnost za rokove iz speca; implementacija mora biti idempotentna i bilježiti samo klasu/broj/raspon u `audit.retention_purged`. Dodati audit događaje za obračun i osjetljive priloge. Standardizovati metadata i rekurzivnu zabranu tajni; dodati oznake osjetljivosti i test matrice. Bez destruktivnog izvršavanja prije zasebne kodne kapije i DB testa.

**Prihvat:** finansijski i pristupni događaji imaju očekivane klase; osjetljiva čitanja su provjerljiva; purge je idempotentan, tenant-siguran i ostavlja sažeti dokaz.

## Predloženi dokazi nakon odobrenog koda

- **DB/RLS/ACL:** `packages/db/src/tenant.test.ts`, `packages/db/src/passkeys-rls.integration.test.ts`, F1 preflight i ACL parity.
- **Servisi/API:** `f1-access.integration.test.ts`, `access.integration.test.ts`, `rbac.integration.test.ts`, `two-factor-lifecycle.integration.test.ts`, `two-factor-app-role.integration.test.ts`, `passkeys.integration.test.ts`, `retention.integration.test.ts`; dodati end-to-end test za platform login/onboarding/support i `changeMembership` opoziv.
- **UI/ugovor:** `users-client.test.tsx`, `roles-client.test.tsx`, `postavke-client.test.tsx`, `sigurnost-tab.test.tsx`, `audit-client.test.tsx`; OpenAPI/contract provjera i test stvarnog onboarding request/response-a.
- **Operativno:** provjeriti Coolify env bez vlasničke runtime veze, uloge u bazi, migraciju i support banner na odobrenom okruženju. CI/test prolaz ne dokazuje deploy ni vlasnikov pregled uživo.

Ovo su budući dokazi, ne tvrdnja da su komande sada pokrenute. Nakon rada osvježiti quality registry samo stvarnim rezultatima, pa predati Modul 1 na vlasnički pregled. Sljedeći audit modul prati odobreni redoslijed programa; G1 tek nakon 12 modula i `00-UKRSTENO.md`.
