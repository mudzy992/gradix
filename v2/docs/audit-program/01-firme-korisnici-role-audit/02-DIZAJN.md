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

Vlasnik je potvrdio da tenant TOTP ostaje obavezan za OWNER/ADMIN/ACCOUNTANT i da passkey nije zamjena; ova odluka ne definiše MFA operatora platforme, koja ostaje otvorena. Kodni komentar/migracija sami po sebi nisu vlasnička politika. Za tenant passkey prijavu, `twoFactorGate()` mora potvrditi TOTP prije sesije za obavezne role. Support pristup ostaje dio Modula 1: mora stvoriti stvarni, vremenski ograničen i minimalno dozvoljen kontekst; samo red u `platform_support_sessions` nije pristup podacima. Firma mora vidjeti operatora, razlog i rok u auditu i zaglavlju dok pristup traje.

### 2.1 Platform runtime ACL — tehnički prijedlog, nije odobren

Statički inventar SQL poziva nalazi se u `01-AUDIT.md`. Predlaže se zasebni runtime principal (radni naziv `gradix_platform`) i `PLATFORM_DATABASE_URL`; `DATABASE_ADMIN_URL` ostaje samo za migracije/seed i nikad se ne izlaže Node procesu. Kandidatske osobine role su `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, bez vlasništva nad tabelama, bez `CREATE` i bez članstva/`SET ROLE` prema `gradix_app` ili migratoru. Ne kreirati podrazumijevane grants.

Po trenutnom SQL-u treba izvesti poseban, column-aware allowlist za `platform_users` (login i `last_login_at`), `platform_sessions` (create/read/revoke), `companies` (read/create/update), `memberships` (read/create OWNER), `users` (samo lookup/pregledani `last_login_at`), `equipment_categories` (brojanje seed redova), `invitations` (create) i `audit_events` (INSERT platform događaja). `platform_support_sessions` traži INSERT za grant; `activeSupportAccess()` nema pozivaoca i ne opravdava globalni SELECT na toj tabeli. SELECT firme na banneru treba ostati tenant-scopovan pod `gradix_app`. Nema hard-delete prava ni pristupa drugim poslovnim tabelama.

Sami GRANT-ovi nisu dovoljni: novi principal bez `BYPASSRLS` traži eksplicitne platform RLS politike za odobrene redove/radnje. Trenutni `platform_sessions` je FORCE RLS bez politike, a `platform_support_sessions` ima samo tenant SELECT; onboarding takođe dodiruje tenant RLS tabele. Treba definisati transakcijski platform kontekst i ograničiti child-row/audit upise; ne širiti platform role na proizvoljan tenant `SELECT`. Odvojena platform ACL matrica i preflight moraju provjeriti atribute role, efektivna prava bez viška, RLS politike i odsustvo članstva/vlasništva. Tačne kolone/politike još nisu potvrđene i moraju proći PostgreSQL preflight/integracijski test prije prihvatanja.

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

Uvesti centralnu mapu `action → retention_class`; ne oslanjati se na implicitni `STANDARD` za osjetljivi ili finansijski događaj. Potrebni su pisci za pregled obračuna i osjetljivih priloga, uz `ACCESS`, kao i dnevni posao za STANDARD/ACCESS/FINANCIAL rokove iz §1.9.41. Vlasnik je potvrdio da fizičko brisanje/arhiviranje čeka pravnu/računovodstvenu potvrdu pravila, dokaznog traga i sadržaja purge zapisa. `audit.retention_purged` treba evidentirati broj/klasu/raspon bez kopiranja obrisanih podataka.

## 6. UX i upravljačka matrica

Matrica ostaje kodom definisana i read-only: jedna lista prava hrani rute, meni i UI. Za svako pravo prikazati oznaku osjetljivosti prema katalogu koji vlasnik potvrdi; ta oznaka je objašnjenje i upozorenje, ne autorizacioni mehanizam. Korisnički administrativni detalj treba povezati postojeće rute za sesije i reset 2FA, a ograničiti radnje prema OWNER/self pravilima. Postojeći UI katalog se koristi; novi vizuelni obrazac čeka `UI-ODOBRENJE`.

## 7. Odluke prije koda

1. MFA politika za platform operatore (tenant TOTP obaveznost i passkey kao ne-zamjena već su odlučeni).
2. Pravna/računovodstvena potvrda prije purge/archive; višefirmski login ostaje izvan MVP UI-ja prema specu.
3. Tačan grant set/preflight za izabranu runtime rolu, te obim korisničkih i firmnih lokalizacijskih postavki.
4. Dokumentacijska razlika „Modul 1 od 11“ naspram programa od 12; nije kodni blocker.

Do tih odluka ovo ostaje dizajnerski prijedlog; ne mijenjati kod, bazu, UI ni deployment.