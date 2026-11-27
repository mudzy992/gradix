# Modul 1 — Firma, korisnici, role i audit: matrica pokrivenosti

**Snimak:** 2026-11-27 · **Pregledani kodni commit:** `e7a37910a9c0a651d3d77a059592d755330b399c` · **Status:** statička triangulacija, nije testni izvještaj.

## Oznake

- **Djelimično** — relevantan kod postoji, ali postoji odstupanje ili nedovršena veza.
- **Gap** — zahtjev nije pronađen u isporučenom UI/API/servisu ili ugovor nije usklađen.
- **Odluka** — politika/obim mora biti potvrđen prije ocjene.
- **Anker** znači samo postojeći testni fajl; nijedan ovdje naveden test nije pokrenut u ovom auditu.

| Spec | Pokrivenost u pregledanom kodu | Dokaz / razlika | Testni anker (nije pokrenut) |
|---|---|---|---|
| §1.1, 2.1 — firma/tenant | Djelimično | Firmni profil, RLS i `withCompany`; slug se ne mijenja. Valuta/zona/locale nisu dostupni kroz firmni PATCH/UI kako traži postavka; firmni TZ koristi se u više servisa. | `tenant.test.ts`, `f1-access.integration.test.ts`, `postavke-client.test.tsx` |
| §1.2 — korisnik/članstvo | Djelimično | Globalni users, članstvo, deaktivacija/OWNER zaštita i trenutni auth kontekst postoje. Promjena role/opsega ne opoziva sesije kroz `changeMembership`; korisnički locale nedostaje; više aktivnih članstava bira prvo. | `access.integration.test.ts`, `rbac.integration.test.ts`, `f1-access.integration.test.ts` |
| §1.3 — pozivnice/reset | Djelimično | Jednokratni hashirani tokeni i potrošnja postoje; admin dobija link za ručno slanje. Nema javnog zahtjeva za reset niti slanja/`BLOCKED_NO_PROVIDER` događaja iz pozivnice. | `access.integration.test.ts`; UI `users-client.test.tsx` |
| §1.4 — lozinke | Djelimično | Argon2id, blacklist, istorija, rate-limit i 10/15 zaključavanje su u kodu. `password_expires_at` se postavlja, ali `isPasswordExpired()` nema auth pozivaoca. | `password-policy.test.ts`, `f1-access.integration.test.ts`, `access.integration.test.ts` |
| §1.5 / §1.8 — 2FA | Djelimično | Tenant TOTP i da passkey nije zamjena potvrđeni su; `passkeyLogin()` ipak izdaje sesiju bez TOTP gatea (F1-04c, S1). Vlasnik je potvrdio obavezni platform TOTP i F1-03b kao S1; `platformLogin()` ipak izdaje sesiju bez koda. | `two-factor-lifecycle.integration.test.ts`, `two-factor-app-role.integration.test.ts`, `passkeys.integration.test.ts` — nisu pokrenuti |
| §1.6 — sesije | Djelimično | Refresh/rotacija, korisnički opoziv i admin API postoje. Admin rute nisu povezane u korisnički UI; `ip_hash` se ne vraća; `last_seen_at` se ne osvježava nakon prijave/rotacije; promjena role ne opoziva sesije. | `f1-access.integration.test.ts`, `access.integration.test.ts`, `passkeys.integration.test.ts` |
| §1.7 — matrica rola | Djelimično | `PERMISSIONS` je izvor za guard/meni/matricu; UI je read-only. Nedostaje eksplicitna oznaka osjetljivih prava iz §1.7.32. | `rbac.integration.test.ts`, `roles-client.test.tsx`, `nav.test.ts` |
| §1.8 — platforma/support | Gap/djelimično | Platform servisi/rute koriste `DATABASE_ADMIN_URL`, koji web entrypoint uklanja prije Node-a. Statički SQL inventar obuhvata 9 platform/registry tabela; odvojena role ACL/RLS matrica i preflight ne postoje. `platform_users` app-matrix rationale je zastario, iako `needed = -` za `gradix_app` ostaje ispravno. `platform_sessions` je FORCE RLS bez politike; support tabela ima tenant SELECT, ne platform putanju. Seed trigger `companies_seed_equipment_categories` upisuje u FORCE RLS bez `app.company_id`; function-owner ponašanje pod no-BYPASS rolom nije provjereno. Vlasnik je potvrdio obavezni operator TOTP i F1-03b S1, ali `platformLogin()` ostaje password-only; secret/enrollment/recovery tok nije pronađen. Support grant/audit postoji bez scoped data-plane i banner pozivaoca. | `f1-access.integration.test.ts` pokriva DB/service anker, ne deploy/UI tok; platform rute uključene su u `nul-guard.integration.test.ts` |
| §1.9 — audit | Djelimično | Audit ACL je append-only za app, transakcijski writer i klase retencije postoje. Nema purge/archive posla za audit; nema pisaca za `payroll.viewed`/`attachment.sensitive_viewed`; worker osjetljivi profil ipak bilježi `worker.sensitive_viewed`. Metadata ugovor nije nametnut helperom. | `rbac.integration.test.ts`, `f1-access.integration.test.ts`, `retention.integration.test.ts` |
| §1.10 — onboarding | Gap end-to-end | UI zahtjev ne zadovoljava Zod input (ime vlasnika); uspješni response ne zadovoljava shape koji UI dereferencira; tri koraka umjesto pet i samo oprema se automatski seed-a. | `f1-access.integration.test.ts` testira servisnu transakciju, ne UI/API ugovor |
| §1.11 — obavještenja | Djelimično / presjek M12 | In-app inbox, dedupe i worker delivery postoje. `notifications.manage` nema pronađeni outbox/retry UI/API; pozivnice/reset nisu vezane u dostavu. Razgraničiti s Modulom 12. | `notification.integration.test.ts`, worker `jobs.test.ts`; nisu pokrenuti |
| §2, §3 — DB/API ugovori | Djelimično | Migracije/ACL/RLS i route schemas postoje. Platform runtime principal se sukobljava s entrypointom; onboarding input/output klijent–API drift je direktan. | `f1-access.integration.test.ts`, `contract.test.ts`, `privilege-matrix.tsv` (fajl nije rezultat izvršenja) |
| §4 — UI | Djelimično | Postavke, korisnici, role, audit, sesije i TOTP ekrani postoje. Fale onboarding koraci, admin detalji korisnika, sesijski IP/aktivnost; tab „Dokumenti“ nije zaseban tab. | `users-client.test.tsx`, `roles-client.test.tsx`, `postavke-client.test.tsx`, `sigurnost-tab.test.tsx`, `audit-client.test.tsx` |
| §5 — testna obaveza | Nije verifikovano u ovoj sesiji | Ankeri postoje. `identity.json` sadrži 13 `COVERED` zapisa, uključujući R4; to nije svježi prolaz niti dokaz deploya. | Server/UI/DB fajlovi navedeni iznad; svi **nisu pokrenuti** |

## Vodeći nalazi

- **Vlasnik potvrdio:** S1 za F1-01/F1-02/F1-03b/F1-04c; S2 za F1-03a, F1-04a–b, F1-05–F1-07, F1-08 postavke i F1-09; S3 za položaj taba u F1-08.
- **Otvoreno:** tačni platform column grants, RLS politike i zaseban preflight; TOTP enrollment/recovery/provisioning lifecycle.
- **Odluke potvrđene:** tenant i platform TOTP obavezni (passkey ne mijenja tenant TOTP); zaseban platform principal bez `BYPASSRLS`/vlasništva/`CREATE`; purge sign-off po spec rokovima potvrđen od vlasnika; lokalizacija ostaje u granicama spec 01; Modul 1 emituje invite/reset, Modul 12 vodi outbox/dostavu/retry.

Matrica pokazuje gdje kod postoji ili odstupa;
