# Modul 1 — Firma, korisnici, role i audit: ciljni dizajn

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), spec 01, ADR 0003/0005/0013/0017.

**Status:** ažuriran nakon vlasničke trijaže 2026-11-27; odabrane granice su zabilježene, ali kodiranje i dalje nije odobreno.

## 1. Granice i pravila

Modul 1 je vertikalni temelj za tenant, identitet, prijavu, članstva, RBAC, firmine postavke, sesije, audit i platform operacije. Poslovni podaci svakog tenant toka ostaju iza `withCompany()` + RLS, a privilegije baze provjerava jedinstvena `privilege-matrix.tsv`. Korisnički UI ne zamjenjuje server-side provjeru. Mobilnu aplikaciju ne dizajniramo; zajedničke ugovore ne mijenjamo bez provjere njihove kompatibilnosti.

Vlasnik je potvrdio podjelu: Modul 1 emituje invite/reset događaje; Modul 12 vlasnički vodi zajednički outbox, dostavu, status i administrativni retry UI. Ne implementirati paralelni outbox u Modulu 1.

## 2. Platforma: odvojena operativna granica

**Ne koristiti migratorski `DATABASE_ADMIN_URL` kao runtime prečicu.** Predloženi princip je odvojeni platform principal ili skup uskih, recenziranih DB operacija koji:

- ne može izvršavati proizvoljne tenant upite, čitati poslovne tabele ili mijenjati ACL/šemu;
- može obavljati samo eksplicitne platform radnje (login/session, pregled registra, onboarding, suspend/activate i kontrolu support pristupa);
- bilježi svaku platformsku izmjenu u audit firme/platforme u istoj transakciji gdje je moguće;
- ulazi u ACL matricu i preflight bez širokog `GRANT ALL`.

Vlasnik je izabrao zasebnu, najmanje privilegovanu platform runtime rolu s tačnim grantovima. Uske DB funkcije više nisu primarna opcija bez nove odluke. Grantovi moraju proći ACL matricu, preflight i sigurnosni pregled; migratorska/vlasnička veza ne ulazi u Node proces.

Vlasnik je potvrdio da tenant TOTP ostaje obavezan za OWNER/ADMIN/ACCOUNTANT i da passkey nije zamjena. Zasebno, 2026-11-27 je odlučio da TOTP bude obavezan i za sve platform operatore; nijedna platform sesija ne smije nastati prije provjere valjanog TOTP koda. Ovo je izričita vlasnička odluka, unesena datiranim dodatkom u spec 01 §1.8; ne zaključujemo je iz komentara/migracije. Za tenant passkey prijavu, `twoFactorGate()` mora potvrditi TOTP prije sesije za obavezne role. Vlasnički odabrani platform MFA lifecycle je opisan u §2.2; tehnički kandidati za schema/endpoint/pre-auth nalaze se u §2.2–2.4, ali nisu finalizovani niti odobreni za implementaciju. Support pristup ostaje dio Modula 1: mora stvoriti stvarni, vremenski ograničen i minimalno dozvoljen kontekst; samo red u `platform_support_sessions` nije pristup podacima. Firma mora vidjeti operatora, razlog i rok u auditu i zaglavlju dok pristup traje.

### 2.1 Platform runtime ACL — smjer vlasnički potvrđen; grantovi su kandidatski

Vlasnik je 2026-11-27 potvrdio zaseban runtime principal bez superusera, `BYPASSRLS`, vlasništva nad tabelama ili `CREATE`, sa uskim grantovima, eksplicitnim RLS politikama i zasebnim preflightom. Radni nazivi su `gradix_platform` i `PLATFORM_DATABASE_URL`; `DATABASE_ADMIN_URL` ostaje za migracije/seed, nikad u Node procesu. Preporučene dodatne zaštite su `NOCREATEDB NOCREATEROLE`, bez membership/`SET ROLE` prema `gradix_app` ili migratoru, bez podrazumijevanih grants. Nazivi i detaljna konfiguracija role još nisu deployani/testirani.

Ovo je izvod kolona iz trenutnih upita u `01-AUDIT.md`, ne izvršiva/odobrena SQL matrica. `totp_enabled` je uključen zbog nove potvrđene politike; TOTP secret tabela još ne postoji.

| Tabela | Kandidatski `SELECT` | Kandidatski `INSERT` | Kandidatski `UPDATE` |
|---|---|---|---|
| `platform_users` | `id,email,password_hash,display_name,is_active,totp_enabled` | — | `last_login_at`; `totp_enabled` (MFA candidate) |
| `platform_sessions` | `platform_user_id,token_hash,revoked_at,expires_at` | `id,platform_user_id,token_hash,expires_at` | `revoked_at` |
| `companies` | `id,name,slug,is_active,created_at` | `id,name,slug,currency,timezone,week_start` | `tax_id,city,address,seeded_at,is_active,updated_at` |
| `memberships` | `company_id,is_active,user_id` | `id,user_id,company_id,roles,scope` | — |
| `users` | `id,email,last_login_at` | — | — |
| `equipment_categories` | `company_id` samo za broj seed redova | — | — |
| `invitations` | — | `id,company_id,email,roles,scope,token_hash,expires_at` | — |
| `audit_events` | — | `id,company_id,actor_id,actor_email,action,entity_type,entity_id,metadata,retention_class` | — |
| `platform_support_sessions` | — | `id,platform_user_id,company_id,reason,expires_at` | — |

Nema hard-delete ni sequence prava. `activeSupportAccess()` nije pozvan nigdje; njegov SELECT ne ulazi u platform allowlist. Firmni banner treba koristiti SELECT pod `gradix_app` + tenant RLS. `listCompanies()` ipak traži globalni agregat članstava/zadnje prijave; taj pregled mora ostati ograničen na navedene kolone, bez čitanja drugih user/tenant podataka.

I uz ove kolonske GRANT-ove potrebne su RLS politike, jer `gradix_platform` neće zaobilaziti RLS. `platform_users` trenutno nema pronađenu RLS politiku; `platform_sessions` je FORCE RLS bez politike; `platform_support_sessions` dopušta samo tenant SELECT; `companies/users` imaju login/tenant politike; `memberships`, `invitations`, `equipment_categories` i `audit_events` su tenant-scopovani. Posebno, `companies_seed_equipment_categories` je `SECURITY DEFINER` trigger koji upisuje u FORCE RLS `equipment_categories` bez postavljanja `app.company_id`; atribute function ownera treba provjeriti i create+seed testirati pod ciljanim setupom. Onboardingov count nad `equipment_categories` bi bez dozvoljenog platform konteksta tiho vratio nulu. Vlasnik je odabrao isti trust boundary kao tenant ADR 0003/0013: custom GUC koji postavlja aplikacija i RLS služe kao zaštita od grešaka/neopreznih upita, ne od kompromitovanog web procesa ili ukradenih runtime kredencijala, jer principal može sam postaviti GUC. To ograničenje treba izričito navesti u preflight/operativnom prihvatu; nema tvrdnje da no-BYPASS RLS sam izoluje bazu od kompromitovane aplikacije.

**Kandidatski transaction-local kontekst (nije SQL odobrenje):** zamijeniti direktne `pool.query`/`client.query` platform pozive wrapperom tipa `withPlatform()`: svaki poziv `BEGIN`, postavi samo dozvoljene GUC-ove kroz `set_config(..., true)`, izvrši jednu namjensku operaciju i `COMMIT/ROLLBACK`. Trenutni login/session/list helperi rade direktne pool upite, pa ih nije moguće sigurno ograničiti transaction-local kontekstom bez takve izmjene.

| Akcija | Minimalni redovi/polja koje postojeći tok traži | Kandidatski RLS uslov |
|---|---|---|
| LOGIN / MFA_VERIFY | `platform_users` po tačnom emailu; vlastiti challenge/TOTP zapisi; sesija tek poslije valjanog koda | action + login email/operator/challenge ID; nema session INSERT na LOGIN |
| SESSION_LOOKUP / LOGOUT | sesija po token hash-u; operatorov ID/email/display name; vlastiti `revoked_at` UPDATE | session hash za lookup, zatim operator ID za self-only čitanje/opoziv |
| COMPANY_LIST | sažetak `companies`; agregat `memberships`; `users.last_login_at` | samo `COMPANY_LIST` kontekst; ne proširiti na operativne tabele |
| COMPANY_CREATE | nova firma i seed broj; postojeći vlasnik po emailu ili membership/invitation; audit INSERT | `COMPANY_CREATE` + target company; exact-email lookup; `app.company_id=target` prije triggera |
| COMPANY_SET_ACTIVE | jedna ciljana firma (`is_active`,`updated_at`) i audit INSERT | akcija + tačan target company |
| SUPPORT_GRANT | postojanje ciljne firme; support-session INSERT; audit INSERT | samo `SUPPORT_GRANT` + target; bez platform SELECT nad support historijom |

Kandidatska imena su `app.platform_action`, `app.platform_user_id`, `app.platform_login_email`, `app.platform_session_hash`, `app.target_company_id` uz postojeći tenant `app.company_id`; sva moraju biti transaction-local. CREATE/seed test mora potvrditi da `app.company_id` prije triggera dopušta samo kategorije ciljne firme i da stvarni function owner/RLS atributi ne zaobilaze očekivanu politiku. Ne dati platform roli opći pristup poslovnim tabelama.

Posebna platform matrica i preflight moraju provjeriti atribute/vlasništvo role, exact column/table/function ACL bez viška, RLS FORCE/politike i odsustvo membership/`SET ROLE`. Svaku kolonu i politiku potvrditi PostgreSQL testom; kandidatska tabela nije znak da je ACL primijenjen.

### 2.2 Platform TOTP — politika/lifecycle-smjer potvrđeni; tehnički ugovor otvoren

Obavezni TOTP za sve platform operatore normiran je u spec 01 §1.8 dodatkom od 2026-11-27. Statički pregled nalazi samo `platform_users.totp_enabled`; nema platform tajne, enrollment/bootstrap, pre-auth challenge ili recovery toka. `platformAuthSecret()` vraća `AUTH_SECRET`, ali nema pozivaoca.

**Vlasnik je 2026-11-27 izabrao sljedeće dizajn-smjerove (to nije odobrenje koda):**
- first/last-operator enrollment koristi out-of-band bootstrap token od 32 bajta, vezan za operatora/purpose; važi 15 minuta, pohranjuje se samo hash, jedna upotreba; re-issue opoziva prethodni token; izdaje ga kontrolisani provisioning postupak, ne javni web login;
- recovery kod + password otvara samo auditirani ograničeni reset/re-enrollment; drugi aktivni MFA operator odobrava reset uz razlog, postojeće platform sesije/recovery kodovi se opozivaju, a novi TOTP je obavezan prije sesije; za posljednjeg operatora koristi se offline break-glass postupak vlasnika/operacija;
- koristi se TOTP profil iz §1.5 (RFC 6238, 6 cifara, 30 s, ±1 korak) i postojeći AES-256-GCM ključ izveden iz `AUTH_SECRET`; rotacija ključa zahtijeva ponovno uparivanje;
- transaction-local custom GUC + RLS prihvaćen je kao zaštita od slučajnih/neopreznih upita, ne kao granica protiv kompromitovanog web procesa ili ukradenih runtime kredencijala (vidi §2.1).

**Predloženi tehnički redoslijed (detalji još nisu odobreni):**
1. Lozinka se provjerava uz isti generički neuspjeh. Uspješna provjera izdaje samo vlasnički izabrani jednokratni 5-minutni, operatoru vezani opaque pre-auth challenge, odvojen od `gx_plat`; ne stvara `platform_sessions` niti vraća platform cookie.
2. Uparenom operatoru pre-auth dokaz dopušta samo TOTP provjeru. Valjan kod se provjerava bez ponovne upotrebe; u jednoj transakciji se challenge troši, evidentira iskorišteni TOTP korak i kreira platform sesija. `gx_plat` se vraća tek nakon commit-a.
3. Neupareni operator ne može sam ući u enrollment samo na osnovu lozinke. Odvojeni bootstrap token otvara ograničeni enrollment; prva sesija nastaje tek nakon potvrde prvog TOTP koda.
4. Reset počinje validnom lozinkom i jednokratnim recovery kodom; drugi aktivni MFA operator odobrava uz razlog i pri odobrenju ponovo unosi svoju lozinku i svježi TOTP. Nakon odobrenja opozivaju se stare platform sesije i recovery kodovi; novi TOTP mora biti potvrđen prije prve naredne sesije. Za posljednjeg operatora važi dvoosobni offline owner/ops break-glass postupak, ne javna web ruta; ostaje finalizovati tačan runbook i rok/transport čekajućeg zahtjeva.

Platform TOTP tajna i recovery zapisi su odvojeni od tenant `user_totp`; secret se šifrira postojećim AES-GCM helperom, tokeni i kodovi su hash-only. Vlasnik je izabrao 10 jednokratnih recovery kodova u tenant formatu 5-5, prikazanih jednom; hash se čuva u DB. Reset-request TTL/transport je 15 min uz operator-bound 32B token u Strict HttpOnly cookie-ju.

**Kandidat za storage (radni nazivi, nije SQL odobrenje):** `platform_totp` s `secret_enc/confirmed_at/last_used_step`; `platform_recovery_codes` s hash-only kodom i `used_at`; `platform_auth_challenges` s hash-only tokenom, operatorom, `purpose`, expiry/consumption i pokušajima; te append-only `platform_audit_events` za bootstrap/enrollment/reset/recovery actor/target/reason bez tajni. Tenant `audit_events` ima obavezni `company_id`, pa nije prirodno mjesto za platform-only MFA radnju bez firme. Schema/kolone ostaju za dizajn.

**Platform rate-limit — vlasnički izabrana politika i semantika 2026-11-27:** 5 neuspjeha/operator/purpose/60 s; 10 auth-faktora ukupno u rolling 15 min → fiksni 15-min lock; IP hash se bilježi, bez IP bucketa. `gradix_platform` dobija EXECUTE samo na SECURITY DEFINER wrapperima sa fiksnim namespace-om/zatvorenim purpose setom, ne na generičkim `login_attempt_*`, i nema direktan DML. Tenant `login_attempts` čuva samo `email_hash/ip_hash/at`, a generički helper EXECUTE pripada `gradix_app`; `users.failed_login_count` nema vremenski prozor i resetuje se nakon ispravne lozinke prije TOTP-a. Ne reuse-ati te semantike za platform zbir ili tvrditi da su tenant 10/15 zahtjevi ispunjeni (vidi audit §1.4.19). **Storage:** vlasnik je odobrio odvojeni platform failure-ledger i per-operator `locked_until`; tačni naziv/tabele/kolone ostaju tehnički detalj. Odabrano je da rolling greške ne brišu na uspjehu; lock počinje na 10. neuspjehu i traje fiksnih 15 min; zahtjevi tokom locka ne provjeravaju faktor, ne broje se i ne produžuju lock; zapisi prirodno ističu. Wrapper treba atomarno serijalizovati provjeru/brojanje/upis, koristiti zatvoren purpose set i fiksne pragove, bez env override. SQL/ACL/preflight ostaju otvoreni.

Pre-auth, reset, recovery set i lockout semantika su vlasnički izabrani; prije koda finalizovati tačnu schema/API, wrapper SQL, grants/RLS i test-oracle. Testovi moraju dokazati da password-only, replay/istek i recovery bez odobrenja ne izdaju sesiju; bootstrap/reset su jednokratni, a sesija nastaje tek nakon novog TOTP-a.

### 2.3 Pre-auth, endpointi i dokazni ugovor — tehnički kandidati

Tenant referenca `pre-auth.ts` koristi potpisani 5-min token u `x-gx-2fa`; WebAuthn `passkey-store.ts` koristi 32-bajtni opaque token, hash-only, 5 minuta i jednokratni claim. Vlasnik je izabrao DB challenge za browser-only platform tok.

| Površina kandidata | Invarijanta |
|---|---|
| postojeći `POST /api/platform/login` | generički neuspjeh; tačna lozinka daje samo pre-auth, nikad `platform_sessions` ni `gx_plat` |
| novi `POST /api/platform/2fa/verify` | challenge je operator/purpose-bound, jednokratan; sesija tek poslije valjanog TOTP-a |
| novi bootstrap/enroll/verify tok | kontrolisani 32B/15-min bootstrap; tajna prikazana jednom; potvrda prvog koda prije sesije |
| novi recovery/reset-request/approve tok | password + jednokratni recovery kod, drugi MFA operator i razlog; novi TOTP prije sesije |

**Transport — vlasnik je 2026-11-27 izabrao smjer:** opaque 32B token, SHA-256 hash-only, vezan za operatora i `LOGIN_TOTP`, jednokratan, 5 minuta; browser ga nosi u `HttpOnly; SameSite=Strict; Secure` produkcijskom cookie-ju za `/api/platform/`, ne u JSON-u. Provjeriti Origin/CSRF. `gx_plat` se izdaje tek nakon TOTP-a i DB commit-a; postojeći 8h sesijski rok nije ponovo odlučen.

**Atomic TOTP:** `withPlatform()` transakcija provjerava challenge/purpose/operator/rok/attempts, zaključava challenge i TOTP red, provjerava §1.5 kod, atomski upisuje `last_used_step`, troši challenge, kreira jednu platform sesiju, ažurira login i audit. Cookie tek poslije COMMIT; isti konkurentni challenge/kod ne može dati dvije sesije. Neupareni `totp_enabled=false` operator nema password-only fallback.

**Reset:** password + jednokratni recovery kod pokreću zahtjev; drugi aktivni MFA operator odobrava uz razlog i svježu vlastitu lozinku+TOTP. Odobrenje opoziva stare sesije/kodove; nova sesija tek nakon novog TOTP-a. Vlasnik je izabrao 15-min operator-bound opaque 32B/hash-only request token u `HttpOnly; SameSite=Strict; Secure` cookie-ju; istek poništava zahtjev, bez sesije. Posljednji operator koristi dvoosobni offline break-glass, ne web rutu.

**Rate-limit prihvat:** testirati 5/60 po operator/purpose, zbir 10/15→fiksni 15-min lock, bez resetovanja na uspjeh ili produženja blokiranim zahtjevima; IP hash se čuva, bez IP odbijanja. Wrapper ACL/runtime nisu testirani.

**Audit/test — vlasnički izabrano:** MFA u append-only `platform_audit_events`; onboarding/suspend/support ostaje u tenant auditu. Katalog: bootstrap issue/reissue/use, TOTP enroll, recovery, reset request/approve/deny, lockout, session issue/revoke i break-glass reconciliation; samo actor/target/purpose/outcome/reason/IP hash, bez tajni, raw tokena ili OTP/emaila. Retencija `ACCESS`/5 g. je potvrđena. Dvoosobni offline incident-zapis i sažeti audit nakon obnove također su izabrani; read/action ACL i tačna schema ostaju otvoreni. Runtime testovi password-only/replay, single-use, 5/60, 10/15 lock, no-IP-reject i cookie poslije commit-a nisu izvršeni.

**Otvoreno prije koda:** finalizovati fizičke tabele/kolone/indekse/ograničenja; request/response i cookie/CSRF ugovor; tačne SECURITY DEFINER funkcije, vlasnik/search_path i ACL; audit read/action RLS; no-BYPASS preflight i testni oracles. Vlasničke politike su zabilježene, ali ne odobravaju kod/migraciju/deployment.

### 2.4 Platform ACL/preflight prihvatni ugovor — statički prijedlog

Odvojena matrica mora navesti svaki public objekt i tačne table/column/function grantove; `login_attempts` nema direktan ACL. Ciljni preflight provjerava efektivna prava preko `PUBLIC`/članstva i odbija `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, `CREATE`, vlasništvo i membership/`SET ROLE` prema app/migratoru. Sve platform-operativne tabele dobijaju ENABLE+FORCE RLS i provjerene operation/target politike; bez default grants. Test pod runtime kredencijalom provjerava GUC lokalnost/pool reuse, cross-tenant deny i onboarding seed trigger uz `app.company_id=target` prije INSERT-a, uključujući stvarnog function ownera i RLS atribute. GUC/RLS ne štiti od kompromitovanog web procesa — vlasnik je tu granicu prihvatio. Preflight i runtime test nisu pokrenuti.

## 3. Identitet, prijava i sesije

- Jedan server-side auth tok provjerava aktivnost korisnika/firme, članstvo i trenutno važeće role/opseg. Uspješna provjera faktora izdaje sesiju; prije toga postoji samo kratkotrajni pre-auth dokaz.
- `password_expires_at` mora biti primijenjen u centralnom auth guardu/toku prijave za uredske role, uz jasnu jedinu dozvoljenu akciju (promjena lozinke). Specifikacija §1.4.20 ostaje mjerodavna dok vlasnik ne odobri izmjenu.
- Promjena role ili opsega treba u istoj transakciji ažurirati članstvo, opozvati sve sesije tog korisnika za firmu i zapisati audit. Trenutno ponovno čitanje članstva po zahtjevu ostaje dodatna zaštita, ne zamjena za eksplicitni opoziv iz specifikacije.
- Definisati kako više aktivnih članstava bira tenant. Ako je izbor izvan MVP-a, zabilježiti operativno ograničenje umjesto da se „prvo aktivno“ smatra namjernim UX-om.
- Prema odluci vlasnika, WebAuthn user-verification ne zamjenjuje obavezni TOTP za OWNER/ADMIN/ACCOUNTANT. Passkey putanja mora proći TOTP gate prije sesije; session UI istovremeno treba prikazati pouzdane `last_seen_at` i IP hash uz kontrolisano osvježavanje aktivnosti.

## 4. Onboarding i firmine postavke

Onboarding ostaje jedna transakcija: podaci firme + vlasnik (postojeći identitet/članstvo ili pozivnica) + traženi zadani šifarnici + audit. UI, Zod ugovor, API ruta i tip odgovora moraju dijeliti jedan model. Predloženi tok je pet koraka iz §1.10/§4.2: identitet/slug; poreski i kontakt podaci uz valuta/zona/radna sedmica; vlasnik; zadani šifarnici; potvrda. Sirovi invitation link prikazuje se jednom. Ugovor odgovora treba eksplicitno označiti postojeći/pozvani vlasnik i smjestiti link na jedno dogovoreno polje.

### 4.1 F1-02 — statički ugovorni nesklad i predloženo poravnanje

Statički pregled potvrđuje: `PlatformCompanyCreateInput` traži `ownerFirstName/ownerLastName`, a `onboarding-client.tsx` šalje `ownerFullName`, pa API ruta pada na Zod validaciji. Ekran šalje i `email/phone/note` koje ugovor ne prima/servis ne upisuje; ne šalje adresu, valutu, zonu, `weekStart` ni izbor šifarnika. API/response schema koriste `{company, invitationLink}`, ekran očekuje `owner`, `inviteLink` i `seededCategories` na drugom nivou; servis stavlja `seededCategories` unutar company, a schema ga ne opisuje. Servis ignoriše owner ime; §1.10 traži owner email, a novopozvani unosi ime/prezime kroz postojeći `/api/invitations/[token]` prihvat.

**Ugovorni kandidat:** jedan Zod request/response iz `packages/contracts` za route i UI; request nosi §1.10 firmu/PIB/PDV/adresu, valutu/zonu/radni početak, owner email i izbor seed kataloga. Response jasno nosi firmu, owner email/status `EXISTING|INVITED`, jedan nullable `invitationLink` i seed sažetak. Tačan JSON ostaje otvoren; bez `email/phone/note` mimo speca i DB upisa.

Danas trigger seed-a samo kategorije; onboarding ne prima izbor niti seed-a tipove obaveza/jedinice. Izabrati jedan seed izvor. Slug konflikt, uključujući konkurentni INSERT, vraća `CONFLICT`; rollback pokriva firmu, vlasnika, seed i audit. E2E/contract/DB race testovi nisu pokrenuti.

## 5. Audit, retencija i osjetljiva čitanja

Audit ostaje append-only tokom važenja zapisa, upisuje se atomski s promjenom i ne prima tajne. Predloženi ugovor metadata-e je tipiziran i validira `{before, after, changed}` za izmjene; akcije čitanja nose samo neosjetljiv identitet subjekta i razlog/obim koji ne otkriva payload. Provjera zabranjenih ključeva mora prolaziti rekurzivno kroz ugniježđene objekte.

Uvesti centralnu mapu `action → retention_class`; ne oslanjati se na implicitni `STANDARD` za osjetljivi ili finansijski događaj. Potrebni su pisci za pregled obračuna i osjetljivih priloga, uz `ACCESS`, kao i dnevni posao za STANDARD/ACCESS/FINANCIAL rokove iz §1.9.41. Vlasnik je 2026-11-27 potvrdio pravnu/računovodstvenu saglasnost za spec rokove STANDARD 2 g., ACCESS 5 g., FINANCIAL 10 g. i agregatni purge trag; underlying dokument saglasnosti nije nezavisno pregledan. `audit.retention_purged` treba evidentirati broj/klasu/raspon bez kopiranja obrisanih podataka. Nema implementacije niti fizičkog purgea bez zasebne kodne kapije.

## 6. UX i upravljačka matrica

Matrica ostaje kodom definisana i read-only: jedna lista prava hrani rute, meni i UI. Za svako pravo prikazati oznaku osjetljivosti prema katalogu koji vlasnik potvrdi; ta oznaka je objašnjenje i upozorenje, ne autorizacioni mehanizam. Korisnički administrativni detalj treba povezati postojeće rute za sesije i reset 2FA, a ograničiti radnje prema OWNER/self pravilima. Postojeći UI katalog se koristi; novi vizuelni obrazac čeka `UI-ODOBRENJE`.

## 7. Odluke i preostali dizajn prije koda

1. F1-03b/S1; izabrani su 5/60 + 10/15→fiksni 15-min lock bez IP bucketa, 15-min reset cookie/10 recovery kodova, svježa approver password+TOTP, dvoosobni OOB i platform audit `ACCESS`/5 g. Prije koda ostaju fizička schema/API, wrapper ACL/read-action RLS i runtime dokazi.
2. Purge sign-off je vlasnik potvrdio po rokovima iz speca; detalji izvršivog, idempotentnog lifecycle-a i audit dokaza i dalje se dizajniraju. Višefirmski login ostaje izvan MVP UI-ja.
3. Vlasnik je odobrio non-BYPASSRLS principal i GUC/RLS kao zaštitu od grešaka, uz izričito isključenje kompromitovanog runtime-a iz te garancije. Tačni column grants, operation-scoped RLS politike, zaseban preflight i no-BYPASS seed test još su otvoreni. Lokalizacija ostaje samo prema specu 01.
4. Dokumentacijska razlika „Modul 1 od 11“ naspram programa od 12; nije kodni blocker.

Ovo ostaje dizajnerski prijedlog za preostale tehničke detalje; ne mijenjati kod, bazu, UI ni deployment bez **`KREĆEMO U KODIRANJE: 1`**.