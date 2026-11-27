# Modul 1 — Firma, korisnici, role i audit: ciljni dizajn

**Snimak:** 2026-11-27 · **Osnova:** [01-AUDIT.md](01-AUDIT.md), spec 01, ADR 0003/0005/0013/0017.

**Status:** prijedlog za vlasničku odluku; nije odobren dizajn za kodiranje.

## 1. Granice i pravila

Modul 1 je vertikalni temelj za tenant, identitet, prijavu, članstva, RBAC, firmine postavke, sesije, audit i platform operacije. Poslovni podaci svakog tenant toka ostaju iza `withCompany()` + RLS, a privilegije baze provjerava jedinstvena `privilege-matrix.tsv`. Korisnički UI ne zamjenjuje server-side provjeru. Mobilnu aplikaciju ne dizajniramo; zajedničke ugovore ne mijenjamo bez provjere njihove kompatibilnosti.

Obavještenja su zajednička osnova, ne paralelna implementacija. Modul 1 proizvodi ulazne događaje (pozivnica/reset), dok Modul 12 treba biti vlasnik zajedničkog outboxa, dostave, statusa i administrativnog retry UI-ja. Granica i isporučivi dio po modulu traže potvrdu.

## 2. Platforma: odvojena operativna granica

**Ne koristiti migratorski `DATABASE_ADMIN_URL` kao runtime prečicu.** Predloženi princip je odvojeni platform principal ili skup uskih, recenziranih DB operacija koji:

- ne može izvršavati proizvoljne tenant upite, čitati poslovne tabele ili mijenjati ACL/šemu;
- može obavljati samo eksplicitne platform radnje (login/session, pregled registra, onboarding, suspend/activate i kontrolu support pristupa);
- bilježi svaku platformsku izmjenu u audit firme/platforme u istoj transakciji gdje je moguće;
- ulazi u ACL matricu i preflight bez širokog `GRANT ALL`.

Vlasnik treba izabrati konkretnu DB granicu — zasebna runtime rola s tačnim grantovima ili uske DB funkcije. Obje opcije su sigurnosno drugačije od vlasničke veze i ne smiju se implementirati bez pregleda ACL-a.

Politika operatora je otvorena odluka: da li platform nalog mora koristiti TOTP, WebAuthn user-verification ili oboje? Ako MFA ostaje obavezna kao što tvrde kodni komentari, login mora imati isti dvostepeni princip kao tenant prijava: lozinka → pre-auth izazov → provjeren faktor → tek onda sesija. Support grant mora stvoriti stvarni, vremenski ograničen i minimalno dozvoljen kontekst; samo red u `platform_support_sessions` nije pristup podacima. Firma mora moći vidjeti operatora, razlog i rok u auditu i zaglavlju dok traje.

## 3. Identitet, prijava i sesije

- Jedan server-side auth tok provjerava aktivnost korisnika/firme, članstvo i trenutno važeće role/opseg. Uspješna provjera faktora izdaje sesiju; prije toga postoji samo kratkotrajni pre-auth dokaz.
- `password_expires_at` mora biti primijenjen u centralnom auth guardu/toku prijave za uredske role, uz jasnu jedinu dozvoljenu akciju (promjena lozinke). Ako vlasnik želi drugačiju politiku od §1.4.20, prvo mijenja specifikaciju.
- Promjena role ili opsega treba u istoj transakciji ažurirati članstvo, opozvati sve sesije tog korisnika za firmu i zapisati audit. Trenutno ponovno čitanje članstva po zahtjevu ostaje dodatna zaštita, ne zamjena za eksplicitni opoziv iz specifikacije.
- Definisati kako više aktivnih članstava bira tenant. Ako je izbor izvan MVP-a, zabilježiti operativno ograničenje umjesto da se „prvo aktivno“ smatra namjernim UX-om.
- Politika passkey-a mora izričito reći da li WebAuthn user-verification zadovoljava obaveznu MFA za OWNER/ADMIN/ACCOUNTANT. Ne zaključivati samo iz tehnike ili komentara. Sesijski prikaz treba prikazati pouzdane `last_seen_at` i IP hash; ažurirati aktivnost uz kontrolu frekvencije, ne na svaki SQL upit bez potrebe.

## 4. Onboarding i firmine postavke

Onboarding ostaje jedna transakcija: podaci firme + vlasnik (postojeći identitet/članstvo ili pozivnica) + traženi zadani šifarnici + audit. UI, Zod ugovor, API ruta i tip odgovora moraju dijeliti jedan model. Predloženi tok je pet koraka iz §1.10/§4.2: identitet/slug; poreski i kontakt podaci uz valuta/zona/radna sedmica; vlasnik; zadani šifarnici; potvrda. Sirovi invite link prikazuje se jednom. Ugovor odgovora treba eksplicitno označiti postojeći/pozvani vlasnik i smjestiti invite link na jedno dogovoreno polje.

Firmine `currency`, `timezone` i `locale` ostaju firmine postavke s auditom; lični `locale`/`timezone` su odvojeni, imaju firmine defaulte i mogu se nadjačati korisnikom prema §1.2.12. UI grupiše sadržaj po korisničkom zadatku i pokriva specifikacijske odjeljke (uključujući dokumente) prije vizuelnih izmjena. Slug ostaje neizmjenjiv.

## 5. Audit, retencija i osjetljiva čitanja

Audit ostaje append-only tokom važenja zapisa, upisuje se atomski s promjenom i ne prima tajne. Predloženi ugovor metadata-e je tipiziran i validira `{before, after, changed}` za izmjene; akcije čitanja nose samo neosjetljiv identitet subjekta i razlog/obim koji ne otkriva payload. Provjera zabranjenih ključeva mora prolaziti rekurzivno kroz ugniježđene objekte.

Uvesti centralnu mapu `action → retention_class`; ne oslanjati se na implicitni `STANDARD` za osjetljivi ili finansijski događaj. Potrebni su pisci za pregled obračuna i osjetljivih priloga, uz `ACCESS`, kao i dnevni posao za STANDARD/ACCESS/FINANCIAL rokove iz §1.9.41. Prije fizičkog brisanja/arhiviranja vlasnik i pravni/računovodstveni savjetnik potvrđuju pravila, dokazni trag i sadržaj purge zapisa. `audit.retention_purged` treba evidentirati broj/klasu/raspon bez kopiranja obrisanih podataka.

## 6. UX i upravljačka matrica

Matrica ostaje kodom definisana i read-only: jedna lista prava hrani rute, meni i UI. Za svako pravo prikazati oznaku osjetljivosti prema katalogu koji vlasnik potvrdi; ta oznaka je objašnjenje i upozorenje, ne autorizacioni mehanizam. Korisnički administrativni detalj treba povezati postojeće rute za sesije i reset 2FA, a ograničiti radnje prema OWNER/self pravilima. Postojeći UI katalog se koristi; novi vizuelni obrazac čeka `UI-ODOBRENJE`.

## 7. Odluke prije koda

1. Platform DB principal/operativni model i obavezni faktor operatora.
2. Passkey naspram TOTP za obavezne role; višečlanska/višefirmska prijava.
3. Retencijski pravni osnov i arhiva naspram brisanja.
4. Vlasništvo nad outboxom, retryjem i slanjem pozivnica/reset linkova (Modul 1 ili Modul 12).
5. Korisnički/firmni locale, timezone i currency, te razlika u odnosu na naslov „Modul 1 od 11“.

Do tih odluka ovo ostaje dizajnerski prijedlog; ne mijenjati kod, bazu, UI ni deployment.