# Modul 1 — Firma, korisnici, role i audit: audit

**Snimak:** 2026-11-27 · **Grana:** `arena/7b5ea9bf-gradix` · **Pregledani kodni commit:** `e7a37910a9c0a651d3d77a059592d755330b399c`

**Status:** radna sinteza nakon G0; nalazi čekaju vlasničku trijažu. Nijednom nije dodijeljen S-nivo.

## Sažetak i granice dokaza

Izvorni kod sadrži značajan dio temelja Modula 1: `withCompany()` u `v2/apps/web/src/server/tenant-context.ts` uz PostgreSQL RLS i ACL u `v2/packages/db/preflight-checks/privilege-matrix.tsv`, prijavu i rotaciju sesija, RBAC, audit UI, TOTP i passkeys. To je **prisustvo koda**, ne dokaz izvršenih testova ili rada u deployu. Ovaj statički prolaz ne daje potvrdu sigurnosti ni ocjenu ozbiljnosti.

G0 je potvrđen. Pregledani su zaključana [specifikacija 01](../../specs/01-firme-korisnici-role-audit.md), ADR 0003/0005/0007/0013/0017, relevantni API/UI, servisi, migracije, ACL, testni ankeri i `identity.json`. U ovoj sesiji nisu pokretani testovi, typecheck, lint, build, DB preflight, deploy ni pilot. Kvalitetni registar ima 13 zapisa `COVERED`, od kojih se dio odnosi na R4; to su deklaracije registra, ne svježi rezultati.

Konačna težina i potvrđivanje posljedica u stvarnom okruženju ostaju otvoreni; vlasnik ih određuje u trijaži prema [PRAVILA.md](../PRAVILA.md) §3.

## Kandidati za nalaz

### F1-01 · Platform runtime DB veza i granica privilegija · statički dokaz jak

`v2/apps/web/src/server/platform-service.ts#getPlatformPool()` traži `DATABASE_ADMIN_URL` za login i sve platform operacije. `v2/infra/docker/entrypoint-web.sh` tu varijablu uklanja prije `exec node`; `v2/infra/coolify/docker-compose.yml` je navodi kao opcionalnu, iako je potrebna za migracije kad su uključene. U web procesu pokrenutom tim entrypointom platform login, lista firmi, onboarding, suspend/activate i support endpointi zato nemaju potrebnu konekciju. Ovo je nalaz o putanji koda/deploy konfiguraciji, ne rezultat probe produkcije.

Ne preporučuje se „popravka“ ostavljanjem migratorske/vlasničke `DATABASE_ADMIN_URL` u Node procesu: to bi poništilo granicu iz ADR 0013 i suprotstavilo se ACL-u za `platform_users`/`platform_sessions` iz `v2/packages/db/preflight-checks/privilege-matrix.tsv` i `v2/packages/db/bootstrap/grants.sql`, gdje `gradix_app` nema te pristupe. Potrebna je zasebna, najmanje privilegovana platform granica ili usko recenzirane DB operacije; vlasnik treba potvrditi dizajn prije koda.

### F1-02 · Onboarding API i ekran nisu usklađeni · statički dokaz jak

`v2/apps/web/src/app/platform/firme/nova/onboarding-client.tsx` šalje `ownerFullName`, dok `PlatformCompanyCreateInput` u `v2/packages/contracts/src/schemas.ts` zahtijeva `ownerFirstName` i `ownerLastName`; ruta `v2/apps/web/src/app/api/platform/companies/route.ts` vraća validacijsku grešku prije servisa. Ako bi se samo ulaz uskladio, odgovor i dalje ne odgovara klijentskom tipu: ruta vraća `{ company, invitationLink }`, a ekran očekuje `{ company, owner, inviteLink, seededCategories }` i čita `created.owner.mode`. Server u `company` stavlja `seededCategories`, ne na vrh odgovora.

Dodatno, ekran ima tri koraka naspram pet u §1.10/§4.2. Nema izbora PDV/adrese/valute/zone/radnog početka ni zadanih šifarnika; šalje `email`, `phone`, `note` koje ugovor ne prima, a servis ih ne upisuje. `v2/apps/web/src/server/platform-service.ts` inicijalizira samo kategorije mehanizacije kroz trigger; tipovi obaveza i jedinice nisu dio onboarding transakcije. `v2/apps/web/src/server/f1-access.integration.test.ts` pokriva servisnu transakciju, ne ovaj API–klijent tok.

### F1-03 · Platform MFA i support pristup nisu dovršeni kao operativni tokovi · odluka vlasnika potrebna

Migracija `v2/packages/db/migrations/20261124110000_f1_2_access_security/migration.sql` dodaje `platform_users.totp_enabled` uz komentar da je TOTP obavezan, a komentar uz `platformLogin()` u `v2/apps/web/src/server/platform-service.ts` tvrdi da svaka nova sesija zahtijeva 2FA. Ipak, login čita samo lozinku i zatim direktno kreira osmosatnu sesiju; u pregledanim platform API rutama nema 2FA izazova. Spec 01 §1.8 traži odvojenu prijavu, ali ne propisuje izričito platform TOTP, pa prvo treba potvrditi da li je komentar/migracija namjerna politika.

`grantSupportAccess()` u `v2/apps/web/src/server/platform-service.ts` upisuje razlog i rok i poziva se iz `v2/apps/web/src/app/api/platform/companies/[id]/support-access/route.ts`; `activeSupportAccess()` čita važeći zapis, ali nema pronađenog pozivaoca. Pregledani tok ne izdaje scoped support kontekst niti koristi grant da ograniči pristup podacima; `activeSupportAccess()` nema pozivaoca u pretraženom web kodu. Platform UI prikazuje rok operatoru, ali nije pronađen prikaz aktivnog support pristupa u firmnom zaglavlju. Dakle, evidentiran grant nije dokaz da je stvarni support data-plane i vidljivost firmi isporučena.

### F1-04 · Dva auth zahtjeva nisu ispunjena kroz stvarni servisni tok · statički dokaz jak

- **Rotacija nakon 180 dana:** migracija `v2/packages/db/migrations/20261124110000_f1_2_access_security/migration.sql` i `v2/apps/web/src/server/access-service.ts` upisuju `password_expires_at`; domena `v2/packages/domain/src/password-policy.ts#isPasswordExpired()` postoji. Pretraga pozivatelja nije našla primjenu te funkcije u prijavi ili `authenticate()`; `v2/apps/web/src/server/auth-lookup.ts` čita datum, ali `login()` u `v2/apps/web/src/server/auth-service.ts` ga ne koristi. `v2/apps/web/src/server/f1-access.integration.test.ts` potvrđuje datum, ne odbijanje pristupa/traženje promjene. Uredske role tako nemaju potvrđenu prisilnu rotaciju iz §1.4.20.
- **Promjena role/opsega:** `changeMembership()` u `v2/apps/web/src/server/rbac-service.ts` ažurira članstvo i audit, ali ne opoziva sesije kako traži §1.2.11. `authenticate()` u `v2/apps/web/src/server/tenant-context.ts` ponovo čita članstvo/role po zahtjevu, pa to ublažava zastarjela prava; ipak sesija ostaje aktivna. Anker u `v2/apps/web/src/server/f1-access.integration.test.ts` ručno radi SQL izmjenu i opoziv, ne poziva servis/rutu.

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

## Odluke/hipoteze za trijažu

1. Da li passkey s obaveznom WebAuthn user-verification zamjenjuje TOTP za obavezne role? `passkeyLogin()` u `v2/apps/web/src/server/passkey-service.ts` izdaje standardnu sesiju bez `twoFactorGate()`; ADR 0017 uređuje biblioteku/origin, ne ovu politiku.
2. Da li MVP treba izbor firme za korisnika s više aktivnih članstava? `login()` u `v2/apps/web/src/server/auth-service.ts` uzima prvo aktivno članstvo; specifikacija kaže da model više firmi ne smije biti pokvaren, ali UI ne izlaže izbor.
3. Specifikacija 01 naslovom kaže „Modul 1 od 11“, dok inventar programa ima 12 modula. Razriješiti brojanje bez tihog prepisivanja specifikacije.

Sljedeći korak: vlasnik potvrđuje obim/težine i otvorene odluke. Ovaj audit ne odobrava kodiranje, deploy ni produkcijsku spremnost.