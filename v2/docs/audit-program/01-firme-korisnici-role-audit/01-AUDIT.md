# Modul 1 — Firma, korisnici, role i audit: audit

**Snimak:** 2026-11-27 · **Grana:** `arena/7b5ea9bf-gradix` · **Pregledani kodni commit:** `e7a37910a9c0a651d3d77a059592d755330b399c`

**Status:** vlasnik je potvrdio težinsku mapu i odluke o tenant MFA, platform DB granici i podjeli obavještenja; F1-04c je S1. Platform SQL površina je dodatno statički inventarisana, ali konačni ACL/RLS/preflight nisu definisani. Platform operator MFA i purge sign-off ostaju otvoreni; nema runtime/pilot verifikacije.

## Sažetak i granice dokaza

Izvorni kod sadrži značajan dio temelja Modula 1: `withCompany()` u `v2/apps/web/src/server/tenant-context.ts` uz PostgreSQL RLS i ACL u `v2/packages/db/preflight-checks/privilege-matrix.tsv`, prijavu i rotaciju sesija, RBAC, audit UI, TOTP i passkeys. To je **prisustvo koda**, ne dokaz izvršenih testova ili rada u deployu. Ovaj statički prolaz ne daje potvrdu sigurnosti ni ocjenu ozbiljnosti.

G0 je potvrđen. Pregledani su zaključana [specifikacija 01](../../specs/01-firme-korisnici-role-audit.md), ADR 0003/0005/0007/0013/0017, relevantni API/UI, servisi, migracije, ACL, testni ankeri i `identity.json`. U ovoj sesiji nisu pokretani testovi, typecheck, lint, build, DB preflight, deploy ni pilot. Kvalitetni registar ima 13 zapisa `COVERED`, od kojih se dio odnosi na R4; to su deklaracije registra, ne svježi rezultati.

Vlasnik je potvrdio mapu: S1 za F1-01/F1-02/F1-04c; S2 za F1-03a, F1-04a–b, F1-05–F1-07, F1-08 postavke i F1-09; S3 za raspored taba u F1-08. Posljedice u deployu ostaju neprovjerene.

## Kandidati za nalaz

### F1-01 · Platform runtime DB veza i granica privilegija · statički dokaz jak

`v2/apps/web/src/server/platform-service.ts#getPlatformPool()` traži `DATABASE_ADMIN_URL` za login i sve platform operacije. `v2/infra/docker/entrypoint-web.sh` tu varijablu uklanja prije `exec node`; `v2/infra/coolify/docker-compose.yml` je navodi kao opcionalnu, iako je potrebna za migracije kad su uključene. U web procesu pokrenutom tim entrypointom platform login, lista firmi, onboarding, suspend/activate i support endpointi zato nemaju potrebnu konekciju. Ovo je nalaz o putanji koda/deploy konfiguraciji, ne rezultat probe produkcije.

Ne preporučuje se „popravka“ ostavljanjem migratorske/vlasničke `DATABASE_ADMIN_URL` u Node procesu: to bi poništilo granicu iz ADR 0013 i suprotstavilo se ACL-u za `platform_users`/`platform_sessions` iz `v2/packages/db/preflight-checks/privilege-matrix.tsv` i `v2/packages/db/bootstrap/grants.sql`, gdje `gradix_app` nema te pristupe. Vlasnik je potvrdio zasebnu runtime rolu; tačan ACL, RLS politika i zasebni runtime preflight još nisu definisani.

#### Statički inventar SQL površine platform-servisa (nije grant odobrenje)

Pregled `v2/apps/web/src/server/platform-service.ts` upita daje sljedeći trenutni minimum operacija po tabeli. Ovo je inventar koda na baselineu, ne konačan ACL: stvarne column grants, RLS pravila i preflight treba provjeriti kao zasebnu granicu.

| Tabela | Trenutne platform-operacije pronađene u kodu |
|---|---|
| `platform_users` | `platformLogin()` čita `id/email/password_hash/display_name/is_active`; uspješan login ažurira `last_login_at`. Nije pronađen app put za kreiranje/brisanje operatora. |
| `platform_sessions` | `platformLogin()` upisuje sesiju; `authenticatePlatform()` je čita; `platformLogout()` ažurira `revoked_at`. Nema hard-delete puta. |
| `companies` | `listCompanies()`/slug lookup čitaju redove; `onboardCompany()` radi INSERT i UPDATE podataka/`seeded_at`; `setCompanyActive()` ažurira `is_active/updated_at`. Brisanje nije predviđeno. |
| `memberships`, `users` | `listCompanies()` računa aktivna članstva i zadnju prijavu; `onboardCompany()` traži postojećeg vlasnika po emailu i eventualno INSERT-a OWNER članstvo. Za `users` nema platform UPDATE-a. |
| `equipment_categories` | `onboardCompany()` broji seed kategorije za novoformiranu firmu; ne nalazi druge platform radnje nad tom tenant tabelom. |
| `invitations` | `onboardCompany()` INSERT-a jednokratnu OWNER pozivnicu za novog identiteta; nema platform čitanja/izmjene nakon upisa. |
| `audit_events` | `onboardCompany()`, `setCompanyActive()` i `grantSupportAccess()` samo INSERT-aju `platform.company_created`, `platform.company_activated`, `platform.company_suspended` i `platform.support_access_granted`; nema platform SELECT/UPDATE/DELETE. |
| `platform_support_sessions` | `grantSupportAccess()` INSERT-a grant; `activeSupportAccess()` radi SELECT, ali pretraga nije našla nijednog pozivaoca. Taj helper ne opravdava globalni SELECT platform role: firmni banner treba čitati kroz tenant RLS putanju. |

Nisu pronađeni platform upiti prema proizvoljnim operativnim poslovnim tabelama; jedini tenant seed lookup je brojanje `equipment_categories`. Nisu pronađene direktne sequence potrebe, niti platform korisničko provisioniranje iz web koda (osim fixture/test upisa). To ne dokazuje kako su operatori ručno provisionirani.

RLS je dodatni blocker koji se ne rješava samo GRANT-ovima: `platform_sessions` je FORCE RLS bez politike; `platform_support_sessions` ima samo tenant SELECT politiku; `memberships`, `invitations`, `equipment_categories` i `audit_events` imaju tenant pravila; `companies/users` imaju pre-login/tenant politike koje ne daju novi platform kontekst. Zato obična nova rola bez RLS zaobilaženja neće raditi s trenutnim SQL-om samo zato što dobije tabelne privilegije. Dizajn mora dati eksplicitne, ograničene platform politike/kontekst i zaseban preflight, a ne dodijeliti široki poslovni ACL. `privilege-matrix.tsv` i trenutni preflight opisuju `gradix_app`, ne novu platform rolu.

`platformPool()` u `platform-service.ts` trenutno čita `DATABASE_ADMIN_URL`; `entrypoint-web.sh` briše tu varijablu prije `exec node`, iako je može koristiti za migracije. Dakle trenutni poziv platform servisa iz web runtime-a nema predviđenu konekciju; stvarno okruženje nije testirano. ADR 0013 navodi da platform tokova tada nije bilo; sadašnji kod je kasniji dodatak i ne mijenja osnovno pravilo da `gradix_app` ne dobija platform ACL. I obrazloženje reda `platform_users` u `privilege-matrix.tsv` još kaže da nema trenutnog web puta; taj tekst je zastario, iako `needed = -` za `gradix_app` i dalje odgovara granici. Ažurirati obrazloženje tek uz zaseban, odobreni platform ACL/preflight rad.

### F1-02 · Onboarding API i ekran nisu usklađeni · statički dokaz jak

`v2/apps/web/src/app/platform/firme/nova/onboarding-client.tsx` šalje `ownerFullName`, dok `PlatformCompanyCreateInput` u `v2/packages/contracts/src/schemas.ts` zahtijeva `ownerFirstName` i `ownerLastName`; ruta `v2/apps/web/src/app/api/platform/companies/route.ts` vraća validacijsku grešku prije servisa. Ako bi se samo ulaz uskladio, odgovor i dalje ne odgovara klijentskom tipu: ruta vraća `{ company, invitationLink }`, a ekran očekuje `{ company, owner, inviteLink, seededCategories }` i čita `created.owner.mode`. Server u `company` stavlja `seededCategories`, ne na vrh odgovora.

Dodatno, ekran ima tri koraka naspram pet u §1.10/§4.2. Nema izbora PDV/adrese/valute/zone/radnog početka ni zadanih šifarnika; šalje `email`, `phone`, `note` koje ugovor ne prima, a servis ih ne upisuje. `v2/apps/web/src/server/platform-service.ts` inicijalizira samo kategorije mehanizacije kroz trigger; tipovi obaveza i jedinice nisu dio onboarding transakcije. `v2/apps/web/src/server/f1-access.integration.test.ts` pokriva servisnu transakciju, ne ovaj API–klijent tok.

### F1-03 · Platform MFA i support pristup nisu dovršeni kao operativni tokovi · odluka vlasnika potrebna

Migracija `v2/packages/db/migrations/20261124110000_f1_2_access_security/migration.sql` dodaje `platform_users.totp_enabled` uz komentar da je TOTP obavezan, a komentar uz `platformLogin()` u `v2/apps/web/src/server/platform-service.ts` tvrdi da svaka nova sesija zahtijeva 2FA. Ipak, login čita samo lozinku i zatim direktno kreira osmosatnu sesiju; u pregledanim platform API rutama nema 2FA izazova. Spec 01 §1.8 traži odvojenu prijavu, ali ne propisuje izričito platform TOTP, pa prvo treba potvrditi da li je komentar/migracija namjerna politika.

`grantSupportAccess()` u `v2/apps/web/src/server/platform-service.ts` upisuje razlog i rok i poziva se iz `v2/apps/web/src/app/api/platform/companies/[id]/support-access/route.ts`; `activeSupportAccess()` čita važeći zapis, ali nema pronađenog pozivaoca. Nije pronađen scoped support kontekst koji koristi grant za pristup podacima niti firmni banner koji prikazuje aktivan pristup. Evidentiran grant zato nije dokaz da je operativni support data-plane isporučen.

### F1-04 · Dva auth zahtjeva nisu ispunjena kroz stvarni servisni tok · statički dokaz jak

- **Rotacija nakon 180 dana:** migracija `v2/packages/db/migrations/20261124110000_f1_2_access_security/migration.sql` i `v2/apps/web/src/server/access-service.ts` upisuju `password_expires_at`; domena `v2/packages/domain/src/password-policy.ts#isPasswordExpired()` postoji. Pretraga pozivatelja nije našla primjenu te funkcije u prijavi ili `authenticate()`; `v2/apps/web/src/server/auth-lookup.ts` čita datum, ali `login()` u `v2/apps/web/src/server/auth-service.ts` ga ne koristi. `v2/apps/web/src/server/f1-access.integration.test.ts` potvrđuje datum, ne odbijanje pristupa/traženje promjene. Uredske role tako nemaju potvrđenu prisilnu rotaciju iz §1.4.20.
- **Promjena role/opsega:** `changeMembership()` u `v2/apps/web/src/server/rbac-service.ts` ažurira članstvo i audit, ali ne opoziva sesije kako traži §1.2.11. `authenticate()` u `v2/apps/web/src/server/tenant-context.ts` ponovo čita članstvo/role po zahtjevu, pa to ublažava zastarjela prava; ipak sesija ostaje aktivna. Anker u `v2/apps/web/src/server/f1-access.integration.test.ts` ručno radi SQL izmjenu i opoziv, ne poziva servis/rutu.
- **TOTP na passkey prijavi (vlasnička politika 2026-11-27):** vlasnik je potvrdio da passkey nije zamjena za obavezni TOTP. `passkeyLogin()` u `v2/apps/web/src/server/passkey-service.ts` provjerava WebAuthn user-verification, ali zatim izdaje sesiju bez `twoFactorGate()`. Prema potvrđenoj politici, ovo ne provodi TOTP za OWNER/ADMIN/ACCOUNTANT; nalaz je statički i ne dokazuje iskorištavanje u runtime-u.

### F1-05 · Retencija i dio audit čitanja nisu povezani u izvršiv lifecycle · statički dokaz jak

`audit_events` ima klase retencije i indeks. `v2/apps/web/scripts/retention-cleanup.ts` je ručna dry-run/`--primijeni` naredba koja dira samo `sessions`, `login_attempts`, `invitations`, `password_resets`; nije pronađen audit purge/arhivski posao ni poziv `audit.retention_purged`. Katalog akcija u `v2/apps/web/src/server/audit.ts` sadrži `payroll.viewed` i `attachment.sensitive_viewed`, ali nisu pronađeni njihovi pisci. Nasuprot tome, `worker.sensitive_viewed` ima pisce u `v2/apps/web/src/server/worker-service.ts` i klasu `ACCESS`.

`writeAudit()` u `v2/apps/web/src/server/audit.ts` prima slobodan `Record<string, unknown>`, podrazumijeva `STANDARD` i provjerava tajne samo među ključevima prvog nivoa; schema `{before, after, changed}` nije provedena. Primjer `changeMembership()` iz `v2/apps/web/src/server/rbac-service.ts` koristi `from`/`to`. Test koji provjerava oblik u `v2/apps/web/src/server/f1-access.integration.test.ts` direktno umeće JSON u bazu, ne dokazuje da helper odbija odstupanje. Potrebna je klasifikacija po akciji i odluka o arhiviranju/brisanjima uz očuvanje append-only zahtjeva.

### F1-06 · Pozivnica, zaboravljena lozinka i administratorski red obavještenja · djelimično

Pozivnica i reset su jednokratni linkovi koji se vrate pozivaocu, ali `users-client.tsx` izričito kaže da pozivaoc kopira i sam šalje link; ne vidi se poziv `notify()` iz pozivnice/onboardinga. Postoji samo potrošnja `/api/password-resets/{token}` i administratorsko izdavanje reset linka; login upućuje korisnika administratoru, bez javnog zahtjeva za vlastiti reset. To odstupa od §1.3.14/16. Inbox i worker dostave postoje, ali `notifications.manage` nema pronađenu rutu/UI za outbox, neuspjehe i retry kako traži §1.11/§3.7. Vlasništvo nad outboxom je zajedničko s Modulom 12 i treba ga razgraničiti.

### F1-07 · Sesije i korisničko upravljanje: API više je pokriven od UI-ja

Vlastite sesije, opoziv i „odjavi sve ostale“ postoje. Admin API za pregled/opoziv sesije i reset 2FA postoji, ali `users-client.tsx` u `v2/apps/web/src/app/ured/korisnici/users-client.tsx` ne poziva te rute niti prikazuje sesije/2FA status/reset u korisničkom detalju iz §4.4. `SessionRow` u `v2/apps/web/src/server/session-service.ts` i ekran ne vraćaju/prikazuju sačuvani `ip_hash`. `last_seen_at` se inicijalizira u `v2/apps/web/src/server/auth-service.ts` i čita u session serviceu; pretraženi kod ga ne osvježava na aktivnom zahtjevu, pa „Zadnja aktivnost“ može biti vrijeme prijave, ne posljednja aktivnost.

### F1-08 · Lične i firmine postavke imaju odstupanja od specifikacije

Spec §1.2.12 traži korisnički `locale` i `timezone`, naslijeđene od firme i promjenjive. Migracija `v2/packages/db/migrations/20261124110000_f1_2_access_security/migration.sql` dodaje `users.timezone`, ali ne `users.locale`; `/api/me` vraća ime/email/role, a profil pod `v2/apps/web/src/app/ured/profil` nema uređivanje tih preferencija. `v2/apps/web/src/server/company-service.ts` firmni PATCH allowlist i UI pod `v2/apps/web/src/app/ured/postavke` ne izlažu `currency`, `timezone` ili `locale`, iako ih spec §1.1/§4 stavlja u postavke rada; početna firma dobija ugovorne defaulte. UI ima „Sigurnost i 2FA“ umjesto specifikacijskog taba „Dokumenti“, dok je zaglavlje izvoza u „Podaci firme“.

### F1-09 · Matrica ne označava osjetljiva prava

`PERMISSION_INFO` u `v2/apps/web/src/server/permissions.ts`, `roleMatrix()` u `v2/apps/web/src/server/rbac-service.ts` i `roles-client.tsx` u `v2/apps/web/src/app/ured/role/roles-client.tsx` prikazuju ključ/naziv/opis i pripadnost roli, bez osjetljivog atributa ili oznake. To propušta eksplicitni zahtjev §1.7.32 za `payroll.*`, `users.manage` i `audit.view`; nije utvrđeno da sama autorizacija zbog toga popušta.

## Vlasnička trijaža — potvrđeno i otvoreno

Vlasnik je 2026-11-27 potvrdio mapu S1/S2/S3, tenant TOTP politiku, zasebnu runtime rolu i podjelu outboxa. Nakon potvrde težine F1-04c, navedene težine su vlasnički zaključene. Klasifikacija se zasniva na statičkim dokazima; nema runtime/pilot potvrde ni osnova za S0. S1 blokira prihvatanje Modula 1 dok se ne zatvori; S2 se planira, a S3 ide u `ODLOŽENO`.

| Stavka | Preporuka | Obrazloženje i predloženo postupanje |
|---|---|---|
| F1-01 — platform runtime veza | **S1** | Platform login, onboarding i upravljanje firmama ovise o vezi koju web entrypoint uklanja. Zatvoriti prije prihvatanja Modula 1; runtime potvrdu uraditi tek na odobrenom okruženju i bez migratorske veze u Node procesu. |
| F1-02 — onboarding ugovor | **S1** | Trenutni UI zahtjev pada na validaciji, a odgovor se ne poklapa s klijentskim oblikom. Zatvoriti API–UI ugovor i dodati e2e dokaz onboarding toka. |
| F1-03a — support data-plane | **S2** | Spec traži ograničen, obrazložen i firmi vidljiv pristup; trenutno je potvrđen zapis/grant, ne potrošač konteksta. Do zatvaranja ostati deny-by-default; ne stvarati tihi pristup podacima. |
| F1-03b — platform MFA | **ODLUKA; bez težine** | Spec §1.8 traži odvojenu prijavu, ali ne definiše operatorov faktor; migracija/komentar sugerišu TOTP. Vlasnik treba zaključati politiku prije ocjene ili koda. |
| F1-04a — istek lozinke | **S2** | Zahtjev od 180 dana postoji, ali nije primijenjen u prijavi; nema dokaza o kompromitaciji. Ipak, zatvoriti eksplicitni sigurnosni zahtjev i testirati uredske/terenske role. |
| F1-04b — opoziv nakon promjene role | **S2** | Spec traži opoziv svih sesija. Ponovna provjera članstva po zahtjevu ublažava zastarjele dozvole, pa statički pregled ne pokazuje role-bypass; dodati atomski opoziv i servisni test. |
| F1-04c — TOTP gate u passkey prijavi | **S1 potvrđen 2026-11-27** | Vlasnik je potvrdio da passkey nije zamjena za TOTP i odredio S1. `passkeyLogin()` ipak izdaje sesiju bez `twoFactorGate()`; zatvoriti prije prihvatanja Modula 1. |
| F1-05a — audit retencija/purge | **S2** | Brisanje/arhiviranje po rokovima nije izvršeno u workeru; rizik je lifecycle/usklađenost, ne potvrđen gubitak zapisa. Prije destruktivnog posla tražiti pravnu/računovodstvenu potvrdu. |
| F1-05b — audit osjetljivih čitanja | **S2** | Nedostaju pisci za navedene read akcije; to slabi trag pristupa, ali samo po sebi ne dokazuje neautorizovan pristup. Dodati ACCESS događaje i pokriti čitanje u testu. |
| F1-05c — metadata ugovor | **S2** | Helper prihvata slobodan oblik i plitko provjerava tajne; rizik je neujednačen/nepotpun audit, bez dokaza da je zapis izmijenjen. Uvesti tipizirani ugovor i rekurzivnu zaštitu. |
| F1-06 — pozivnice/reset/outbox | **S2** | Ručno kopiranje linka i administratorski reset su workaroundi; self-service i pouzdana dostava iz specifikacije nedostaju. Razgraničiti emitovanje događaja Modula 1 od zajedničkog outboxa/retryja. |
| F1-07 — sesijski/admin UI | **S2** | API postoji, ali administrativni detalj i vjerodostojan `last_seen_at`/IP prikaz nisu dovršeni; ne utvrđuje se zaobilaženje autorizacije. Povezati postojeće API-je i testirati prikaz/opoziv. |
| F1-08 — postavke | **S2** za locale/timezone/currency; **S3** za raspored taba | Nedostaju specifikacijske postavke; drugačiji raspored „Dokumenti“ je UI nedosljednost bez utvrđenog gubitka funkcije. Funkcionalna polja planirati, raspored taba može biti `ODLOŽENO`. |
| F1-09 — oznake osjetljivih prava | **S2** | UI ne ističe osjetljiva prava kako specifikacija traži; pregled nije našao popuštanje server-side autorizacije. Dodati metapodatak/oznaku i test matrice. |

## Vlasničke odluke zabilježene

- **Težine:** potvrđeni su S1 za F1-01/F1-02/F1-04c; S2 za F1-03a, F1-04a–b, F1-05–F1-07, F1-08 postavke i F1-09; S3 za položaj taba u F1-08.
- **Tenant MFA:** TOTP ostaje obavezan za OWNER/ADMIN/ACCOUNTANT; passkey nije zamjena. F1-04c je zato potvrđen kao S1.
- **Platform DB:** izabrana je zasebna runtime rola s tačnim grantovima; `DATABASE_ADMIN_URL` ne ostaje u web runtime-u.
- **Podjela:** Modul 1 emituje invite/reset događaje i zadržava scoped, vidljiv support pristup; Modul 12 vodi outbox, dostavu i retry UI. Audit purge čeka pravnu/računovodstvenu potvrdu.

## Preostalo prije zatvaranja trijaže

1. Platform operator MFA ostaje otvoreno i bez težine; odluka o tenant TOTP-u ne proširuje se prešutno na platform naloge.
2. Zasebna platform runtime rola je potvrđena, ali tačan grant set, ograničene RLS politike i poseban preflight nisu odobreni ni runtime-provjereni. Statički SQL inventar iznad je osnova za taj prijedlog, ne primijenjeni ACL.
3. Pravna/računovodstvena potvrda pravila i dokaznog traga prije arhiviranja/brisanja audita.
4. Lokalizacijski obim treba ostati unutar zaključane spec 01 (firmni `currency/timezone/locale`, korisnički `locale/timezone` uz firmne defaulte), osim ako vlasnik odobri širenje.
5. Višefirmski izbor ostaje `ODLOŽENO` prema MVP specifikaciji; „Modul 1 od 11“ naspram programa od 12 modula je dokumentacijsko pitanje, ne kodni blocker.

Prihvaćena težina ne odobrava implementaciju. Za svaki poslovni kod/migraciju/UI i dalje je potrebna fraza **`KREĆEMO U KODIRANJE: 1`**.
