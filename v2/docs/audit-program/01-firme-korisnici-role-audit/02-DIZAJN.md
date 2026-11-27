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

Vlasnik je potvrdio da tenant TOTP ostaje obavezan za OWNER/ADMIN/ACCOUNTANT i da passkey nije zamjena. Zasebno, 2026-11-27 je odlučio da TOTP bude obavezan i za sve platform operatore; nijedna platform sesija ne smije nastati prije provjere valjanog TOTP koda. Ovo je izričita vlasnička odluka koja dopunjava §1.8; ne zaključujemo je iz komentara/migracije. Za tenant passkey prijavu, `twoFactorGate()` mora potvrditi TOTP prije sesije za obavezne role. Platform MFA secret, enrollment, recovery i bootstrap još nemaju dizajn. Support pristup ostaje dio Modula 1: mora stvoriti stvarni, vremenski ograničen i minimalno dozvoljen kontekst; samo red u `platform_support_sessions` nije pristup podacima. Firma mora vidjeti operatora, razlog i rok u auditu i zaglavlju dok pristup traje.

### 2.1 Platform runtime ACL — smjer vlasnički potvrđen; grantovi su kandidatski

Vlasnik je 2026-11-27 potvrdio zaseban runtime principal bez superusera, `BYPASSRLS`, vlasništva nad tabelama ili `CREATE`, sa uskim grantovima, eksplicitnim RLS politikama i zasebnim preflightom. Radni nazivi su `gradix_platform` i `PLATFORM_DATABASE_URL`; `DATABASE_ADMIN_URL` ostaje za migracije/seed, nikad u Node procesu. Preporučene dodatne zaštite su `NOCREATEDB NOCREATEROLE`, bez membership/`SET ROLE` prema `gradix_app` ili migratoru, bez podrazumijevanih grants. Nazivi i detaljna konfiguracija role još nisu deployani/testirani.

Ovo je izvod kolona iz trenutnih upita u `01-AUDIT.md`, ne izvršiva/odobrena SQL matrica. `totp_enabled` je uključen zbog nove potvrđene politike; TOTP secret tabela još ne postoji.

| Tabela | Kandidatski `SELECT` | Kandidatski `INSERT` | Kandidatski `UPDATE` |
|---|---|---|---|
| `platform_users` | `id,email,password_hash,display_name,is_active,totp_enabled` | — | `last_login_at` |
| `platform_sessions` | `platform_user_id,token_hash,revoked_at,expires_at` | `id,platform_user_id,token_hash,expires_at` | `revoked_at` |
| `companies` | `id,name,slug,is_active,created_at` | `id,name,slug,currency,timezone,week_start` | `tax_id,city,address,seeded_at,is_active,updated_at` |
| `memberships` | `company_id,is_active,user_id` | `id,user_id,company_id,roles,scope` | — |
| `users` | `id,email,last_login_at` | — | — |
| `equipment_categories` | `company_id` samo za broj seed redova | — | — |
| `invitations` | — | `id,company_id,email,roles,scope,token_hash,expires_at` | — |
| `audit_events` | — | `id,company_id,actor_id,actor_email,action,entity_type,entity_id,metadata,retention_class` | — |
| `platform_support_sessions` | — | `id,platform_user_id,company_id,reason,expires_at` | — |

Nema hard-delete ni sequence prava. `activeSupportAccess()` nije pozvan nigdje; njegov SELECT ne ulazi u platform allowlist. Firmni banner treba koristiti SELECT pod `gradix_app` + tenant RLS. `listCompanies()` ipak traži globalni agregat članstava/zadnje prijave; taj pregled mora ostati ograničen na navedene kolone, bez čitanja drugih user/tenant podataka.

I uz ove kolonske GRANT-ove potrebne su RLS politike, jer `gradix_platform` neće zaobilaziti RLS. `platform_sessions` je FORCE RLS bez politike; `platform_support_sessions` dopušta samo tenant SELECT; `companies/users` imaju login/tenant politike; `memberships`, `invitations`, `equipment_categories` i `audit_events` su tenant-scopovani. Posebno, `companies_seed_equipment_categories` je `SECURITY DEFINER` trigger koji upisuje u FORCE RLS `equipment_categories` bez postavljanja `app.company_id`; atribute function ownera treba provjeriti i create+seed testirati pod ciljanim setupom. Onboardingov count nad `equipment_categories` bi bez dozvoljenog platform konteksta tiho vratio nulu. Definisati transaction-local platform/operator/target-company kontekst i politike za samo ove radnje: login i vlastita sesija, globalni registrarski sažetak, kreiranje firme/vlasnika/pozivnice, suspend/activate, audit INSERT i support grant INSERT. Ne dati platform roli opći pristup poslovnim tabelama.

Posebna platform matrica i preflight moraju provjeriti atribute/vlasništvo role, exact column/table/function ACL bez viška, RLS FORCE/politike i odsustvo membership/`SET ROLE`. Svaku kolonu i politiku potvrditi PostgreSQL testom; kandidatska tabela nije znak da je ACL primijenjen.

### 2.2 Platform TOTP — politika potvrđena, lifecycle otvoren

Obavezni TOTP za sve platform operatore je vlasnički potvrđen. Trenutno postoji samo `platform_users.totp_enabled` boolean; nema pronađene platform tajne, enrollment/bootstrap, pre-auth challenge ili recovery toka. Preporuka je odvojeno šifrovano platform-secret pohraniti od tenant `user_totp`, ne izdavati platform sesiju dok password + TOTP nisu potvrđeni i koristiti jednokratni pre-auth dokaz. Prije implementacije treba dizajnirati first-operator provisioning, oporavak/reset s auditom, rate-limit i kratki challenge TTL. Ovo je prijedlog za naredni dizajnerski korak, ne već odobren schema/lifecycle.

## 3. Identitet, prijava i sesije

- Jedan server-side auth tok provjerava aktivnost korisnika/firme, članstvo i trenutno važeće role/opseg. Uspješna provjera faktora izdaje sesiju; prije toga postoji samo kratkotrajni pre-auth dokaz.
- `password_expires_at` mora biti primijenjen u centralnom auth guardu/toku prijave za uredske role, uz jasnu jedinu dozvoljenu akciju (promjena lozinke). Specifikacija §1.4.20 ostaje mjerodavna dok vlasnik ne odobri izmjenu.
- Promjena role ili opsega treba u istoj transakciji ažurirati članstvo, opozvati sve sesije tog korisnika za firmu i zapisati audit. Trenutno ponovno čitanje članstva po zahtjevu ostaje dodatna zaštita, ne zamjena za eksplicitni opoziv iz specifikacije.
- Definisati kako više aktivnih članstava bira tenant. Ako je izbor izvan MVP-a, zabilježiti operativno ograničenje umjesto da se „prvo aktivno“ smatra namjernim UX-om.
- Prema odluci vlasnika, WebAuthn user-verification ne zamjenjuje obavezni TOTP za OWNER/ADMIN/ACCOUNTANT. Passkey putanja mora proći TOTP gate prije sesije; session UI istovremeno treba prikazati pouzdane `last_seen_at` i IP hash uz kontrolisano osvježavanje aktivnosti.

## 4. Onboarding i firmine postavke

Onboarding ostaje jedna transakcija: podaci firme + vlasnik (postojeći identitet/članstvo ili pozivnica) + traženi zadani šifarnici + audit. UI, Zod ugovor, API ruta i tip odgovora moraju dijeliti jedan model. Predloženi tok je pet koraka iz §1.10/§4.2: identitet/slug; poreski i kontakt podaci uz valuta/zona/radna sedmica; vlasnik; zadani šifarnici; potvrda. Sirovi invite link prikazuje se jednom. Ugovor odgovora treba eksplicitno označiti postojeći/pozvani vlasnik i smjestiti invite link na jedno dogovoreno polje.

Firmine `currency`, `timezone` i `locale` ostaju firmine postavke s auditom; lični `locale`/`timezone` su odvojeni, imaju firmine defaulte i mogu se nadjačati korisnikom prema §1.2.12. UI grupiše sadržaj po korisničkom zadatku i pokriva specifikacijske odjeljke (uključujući dokumente) prije vizuelnih izmjena. Slug ostaje neizmjenjiv.

## 5. Audit, retencija i osjetljiva čitanja

Audit ostaje append-only tokom važenja zapisa, upisuje se atomski s promjenom i ne prima tajne. Predloženi ugovor metadata-e je tipiziran i validira `{before, after, changed}` za izmjene; akcije čitanja nose samo neosjetljiv identitet subjekta i razlog/obim koji ne otkriva payload. Provjera zabranjenih ključeva mora prolaziti rekurzivno kroz ugniježđene objekte.

Uvesti centralnu mapu `action → retention_class`; ne oslanjati se na implicitni `STANDARD` za osjetljivi ili finansijski događaj. Potrebni su pisci za pregled obračuna i osjetljivih priloga, uz `ACCESS`, kao i dnevni posao za STANDARD/ACCESS/FINANCIAL rokove iz §1.9.41. Vlasnik je 2026-11-27 potvrdio pravnu/računovodstvenu saglasnost za spec rokove STANDARD 2 g., ACCESS 5 g., FINANCIAL 10 g. i agregatni purge trag; underlying dokument saglasnosti nije nezavisno pregledan. `audit.retention_purged` treba evidentirati broj/klasu/raspon bez kopiranja obrisanih podataka. Nema implementacije niti fizičkog purgea bez zasebne kodne kapije.

## 6. UX i upravljačka matrica

Matrica ostaje kodom definisana i read-only: jedna lista prava hrani rute, meni i UI. Za svako pravo prikazati oznaku osjetljivosti prema katalogu koji vlasnik potvrdi; ta oznaka je objašnjenje i upozorenje, ne autorizacioni mehanizam. Korisnički administrativni detalj treba povezati postojeće rute za sesije i reset 2FA, a ograničiti radnje prema OWNER/self pravilima. Postojeći UI katalog se koristi; novi vizuelni obrazac čeka `UI-ODOBRENJE`.

## 7. Odluke i preostali dizajn prije koda

1. F1-03b obavezni TOTP i S1 težina potvrđeni su od vlasnika; normativni spec 01 §1.8 treba sinhronizovati prije koda. Secret store, enrollment/bootstrap prvog operatora, pre-auth TTL i recovery/reset ostaju za dizajn/odobrenje.
2. Purge sign-off je vlasnik potvrdio po rokovima iz speca; detalji izvršivog, idempotentnog lifecycle-a i audit dokaza i dalje se dizajniraju. Višefirmski login ostaje izvan MVP UI-ja.
3. Vlasnik je odobrio non-BYPASSRLS platform role smjer; tačan column grant set, RLS politika i zaseban preflight još treba izvesti i provjeriti. Lokalizacijski obim je potvrđen samo prema spec 01.
4. Dokumentacijska razlika „Modul 1 od 11“ naspram programa od 12; nije kodni blocker.

Ovo ostaje dizajnerski prijedlog za preostale tehničke detalje; ne mijenjati kod, bazu, UI ni deployment bez **`KREĆEMO U KODIRANJE: 1`**.