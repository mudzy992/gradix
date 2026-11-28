# Modul 1 — Firma, korisnici, role i audit: plan

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), [02-DIZAJN.md](02-DIZAJN.md), [PRAVILA.md](../PRAVILA.md).

**Status:** redoslijed rada za odobrenje; nema odobrenja za implementaciju.

## Kapija

Vlasnik je potvrdio S1/S2/S3 mapu, uključujući F1-03b i F1-04c kao S1, te obavezni platform TOTP lifecycle, purge sign-off, non-BYPASSRLS ACL/GUC granicu i lokalizaciju po specu. U `02-DIZAJN.md` uneseni su vlasnički odabrani opaque/hash-only 5-min pre-auth cookie, platform rate-limit wrapper s 5/60 po operator/purpose i 10/15→15-min lockout bez IP bucketa, svježa password+TOTP approval i dvoosobni OOB/break-glass s audit-smjerom `ACCESS`/5 g. Otvoreni su fizička lockout/TOTP schema, wrapper SQL, endpoint/API, audit read/action ACL i grants/RLS/preflight. Reset 15m/10 kodova, platform lockout semantika i audit katalog `ACCESS`/5g su vlasnički izabrani. Novi tenant §1.4.19 mismatch je S2 i čeka ispravku. S1 F1-01/F1-02/F1-03b/F1-04c blokiraju prihvatanje; kod čeka zasebnu frazu.

## Redoslijed predloženog rada

### A. Zatvoriti preostale sigurnosne i ugovorne odluke

Vlasnik je potvrdio S1 za F1-01/F1-02/F1-03b/F1-04c; S2 za F1-03a, F1-04a–b, F1-05–F1-07, F1-08 postavke i F1-09; te S3 za položaj taba u F1-08. Tenant §1.4.19 statički mismatch zasebno je ocijenjen S2. Tenant/platform TOTP, bootstrap/recovery/key smjer, non-BYPASSRLS principal uz GUC+RLS zaštitu od grešaka, M1/M12 outbox podjela, purge sign-off i lokalizacija po specu su potvrđeni. Izabrani su i opaque/hash-only 5-min pre-auth cookie, platform wrapper s 5/60 i 10/15→15-min lockout bez IP bucketa, svježi approver password+TOTP te dvoosobni OOB evidencijski smjer. Ostaju fizička lockout/TOTP schema, endpoint/wrapper SQL, audit read/action ACL, grants/RLS i no-BYPASS seed dokaz. Kod nije odobren.

**Izlaz:** odobreni dizajn i testabilni acceptance kriteriji; bez koda dok nema fraze iz kapije.

### B. Učiniti platform tok bezbjednim i upotrebljivim

1. Nakon odobrenja dizajna, implementirati zasebnu platform runtime rolu (ne `DATABASE_ADMIN_URL`) sa tačnim, po mogućnosti column-level grantovima prema inventaru u `01-AUDIT.md`; bez vlasništva, `BYPASSRLS`, članstva u app/migrator roli, `CREATE` ili podrazumijevanih grants. Dodati zasebnu platform ACL matricu i preflight za efektivni ACL/RLS; `gradix_app` matrica sama nije dovoljna. Zabilježiti da transaction-local GUC+RLS štiti od grešaka, ne kompromitovanog runtime-a (vlasnički prihvaćena granica); sve upite omotati u `withPlatform` transakciju i dokazati da se GUC kontekst ne prelijeva kroz pool. PostgreSQL test mora kreirati firmu i seed kategorije pod ciljnom no-BYPASS konfiguracijom, posebno provjeriti `companies_seed_equipment_categories` trigger. Migratorski kredencijali ostaju van Node procesa.
2. Uskladiti onboarding request/response između `PlatformCompanyCreateInput`, rute, servisa i ekrana; dovršiti specifikacijskih pet koraka, vlasničke podatke i seed zahtjeve; osigurati da se konflikt sluga vraća kao kontrolisan `CONFLICT`, uključujući konkurentni pokušaj.
3. Implementirati platform TOTP tek nakon finalizacije schema/API, lockout state, wrapper i audit/test ugovora. Vlasnik je izabrao out-of-band 32B/hash-only/15-min bootstrap s re-issue opozivom; pre-auth 32B/hash-only/5-min cookie; 5 neuspjeha/60 s po operatoru/purpose, 10 ukupno/15 min → lock 15 min bez IP limita; reset request 15-min hash-only Strict cookie; 10 jednokratnih 5-5 recovery kodova uz password i svježu approver password+TOTP; opoziv starih sesija/kodova, novi TOTP prije sesije; dvoosobni offline break-glass, audit katalog `ACCESS`/5 g. i sažetak po povratku. `gradix_platform` dobija samo uske wrapper EXECUTE grantove; treba dizajnirati trajni `locked_until`. F1-03b ostaje S1; nikad `gx_plat`/`platform_sessions` nakon same lozinke. Testirati password-only, invalid/expired/replay i paralelne izazove; 5/60 po purpose i 10/15 lock uz atomiku, uspjeh bez brisanja rolling grešaka i bez produženja locka na blokiranim zahtjevima; bilježiti IP hash bez IP odbijanja. Dokazati bootstrap/recovery single-use, reset odobrenje, novi TOTP prije sesije i cookie tek poslije commit-a pod ciljnim runtime principalom. §1.5/`AUTH_SECRET` profil. Support data-plane ostaje scoped, ≤60 min, razlog + tenant banner; bez općeg tenant pristupa.

**Prihvat:** API i UI e2e kreiraju firmu tačno jednom, pozivnica se prikazuje jednom, invalidan payload ne stvara podatke; onboarding seed trigger radi pod ciljanom no-BYPASS rolom; runtime platform rola ne može čitati proizvoljne poslovne zapise; support pristup ističe i ostavlja provjerljiv trag.

### C. Zatvoriti identitetske i sesijske invarijante

1. Zatvoriti TOTP gate u passkey putanji prije sesije za OWNER/ADMIN/ACCOUNTANT; passkey nije zamjena, dok recovery ostaje prema §1.5. Izvor `passkeys.integration.test.ts` upari OWNER-a s potvrđenim TOTP-om pa očekuje punu passkey sesiju bez koda — nije pokrenut i treba ga zamijeniti dokazom bez session/cookie-ja dok TOTP (ili dopušteni recovery faktor) nije potvrđen.
2. Primijeniti 180-dnevni istek kroz centralnu prijavu/guard; testirati uredske/terenske role, promjenu lozinke i refresh.
3. U `changeMembership` izmjenu + opoziv sesija + audit izvršiti u istoj transakciji; test poziva servis/API, ne ručno SQL.
4. Osvježavati `last_seen_at`, prikazati IP hash i povezati administratorske sesije/reset 2FA u korisnički detalj; ne vraćati tokene/sirovi UA.
5. Implementirati S2 ispravku §1.4.19 prema potvrđenom 10/15 rolling lockout; testirati uspješan faktor, expiry i konkurentne pokušaje na kontrolisanom satu.

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
