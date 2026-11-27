# 01 — Firme, korisnici, role i audit

**Status:** ZAKLJUČANO (vlasnik, 2026-11-23) · **Brief:** B5.1, B3.2, B7, B15.19/22/23 · **Modul:** 1 od 11

Postojeće stanje: matrica dozvola je kod (`apps/web/src/server/permissions.ts`), audit je u transakciji izmjene, RLS + `withCompany` rade, pozivnice/reset postoje kao jednokratni linkovi. Ovaj dokument dodaje ono što fali; ništa postojeće ne ukida bez napomene.

---

## 1. Poslovna pravila

### 1.1 Firma (tenant)
1. Firma je tenant. Sve poslovne tabele nose `company_id`; izolacija je dvostruka (aplikacijski `withCompany` + RLS `FORCE`).
2. `slug` se ne mijenja nakon kreiranja (identitet tenanta). Promjena naziva ne mijenja `slug`.
3. Valuta i zona su **po firmi**, ali se mijenjaju samo kroz Postavke i uz audit; promjena ne prepisuje historijske zapise (iznosi nose svoju valutu, datumi svoju zonu).
4. Deaktivacija firme (`is_active=false`) blokira **prijavu svih korisnika** (`AUTH_COMPANY_INACTIVE`), ne briše podatke. Reaktivacija vraća pristup.
5. Brisanje firme nije predviđeno u MVP-u. Postoji izvoz svih podataka firme (B15.21) — van ovog modula, ali se model ne smije tome suprotstaviti.
6. Radna sedmica (`week_start`), dnevni prag prekovremenog i noćni interval su **podaci firme**, ne kod — jer obračun sati (Modul 6) iz njih računa.

### 1.2 Korisnik i članstvo
7. Korisnik (`users`) je globalan po emailu; firma i role žive na `memberships`. Model već podržava više firmi po korisniku (vanjski računovođa) — MVP to ne izlaže u UI, ali ne smije pokvariti.
8. Korisnik se **nikad ne briše** ako ima historiju. Deaktivacija: `users.is_active=false` + `memberships.is_active=false`; sve sesije se opozivaju u istoj transakciji.
9. Email je jedinstven globalno (već je). Novo: email se normalizuje (`trim` + `toLowerCase`) prije svake provjere.
10. ADMIN ne dira OWNER-a i ne dira sebe (postojeće pravilo ostaje). **Novo:** niko ne može ukinuti zadnjem aktivnom OWNER-u rolu OWNER (`USERS_TARGET_PROTECTED`) — zaštita od zaključavanja firme.
11. Role i opseg mijenja samo `users.manage`. Promjena role opoziva **sve sesije tog korisnika** (dozvole u sesiji ne smiju preživjeti izmjenu).
12. Svaki korisnik ima `locale` i `timezone` (naslijeđeno od firme, promjenjivo); prikaz datuma/valute ide kroz njih.

### 1.3 Pozivnice i reset lozinke
13. Pozivnica: jednokratna, TTL 48 h, u bazi samo SHA-256 hash, sirovi link u odgovoru **tačno jednom** (postojeće).
14. **Novo:** pozivnica se šalje i emailom kroz worker (kanal iz §1.6). Ako provajder nije konfigurisan, link se i dalje vraća pozivaocu, a poruka nosi `BLOCKED_NO_PROVIDER` — nikad lažni „poslano“.
15. Nova pozivnica za isti email opoziva prethodnu (postojeće).
16. Reset lozinke pokreće admin ili sam korisnik („zaboravljena lozinka“). U oba slučaja: token 48 h, jednokratan, sve sesije se opozivaju pri uspješnom postavljanju.

### 1.4 Lozinke i zaključavanje
17. Hash: Argon2id, parametri u kodu (postojeće: 19 MiB, t=2, p=1).
18. Politika: ≥ 10 znakova, slovo + broj (postojeće) **+ novo:**
    - provjera protiv lokalne liste 10.000 najčešćih lozinki (`packages/domain/src/password-blacklist.ts`, normalizovano na lowercase, bez mrežnog poziva);
    - zabrana ponovne upotrebe zadnje 3 lozinke (`password_history`, hash-evi, max 3 po korisniku);
    - zabrana lozinke koja sadrži email ili ime korisnika.
19. Zaključavanje: 10 neuspjelih prijava za isti **nalog** u 15 min → nalog zaključan 15 min (`users.locked_until`), uz poruku koja ne otkriva postoji li email. Postojeći rate-limit po email-hash + IP ostaje kao prva linija.
20. Prisilni reset lozinke poslije **180 dana** — **samo uredske role** (`OWNER`, `ADMIN`, `PROJECT_MANAGER`, `ACCOUNTANT`). Terenske role (`SITE_SUPERVISOR`, `WORKER`, `DRIVER`, `MACHINE_OPERATOR`, `MECHANIC`) su izuzete trajno, jer je to realnost terena.

### 1.5 Dvofaktorska autentikacija (2FA)
21. **Obavezna** za `OWNER`, `ADMIN`, `ACCOUNTANT`. Opciona (korisnik uključuje sam) za ostale role.
22. Metod: TOTP (RFC 6238, 6 cifara, 30 s, tolerancija ±1 korak) + 10 jednokratnih recovery kodova (prikaz jednom, u bazi hash).
23. Tajna (`totp_secret`) se čuva **šifrovana** ključem izvedenim iz `AUTH_SECRET` (AES-256-GCM); nikad u audit, nikad u log.
24. Tok prijave: email+lozinka → ako `totp_enabled` traži kod (`AUTH_2FA_REQUIRED`, kratkotrajni „pre-auth“ token 5 min) → sesija. Recovery kod troši se jednokratno i upisuje `audit` (`user.2fa_recovery_used`).
25. Obavezna rola bez 2FA: prijava prolazi, ali korisnik ide pravo na ekran za uparivanje i **nema pristup ničemu drugom** (izuzetak: odjava). Isto kao `mustChangePassword`.
26. Reset 2FA (izgubljen telefon) radi drugi OWNER/ADMIN uz audit i obavezan razlog.

### 1.6 Sesije
27. Cookie sesija: `httpOnly`, `sameSite=lax`, `secure` u produkciji, kratak access + refresh u bazi (postojeće).
28. **Novo:** ekran „Moje sesije“ — uređaj (UA skraćeno), IP hash, zadnja aktivnost, „ovo je ovaj uređaj“ oznaka, opoziv pojedinačne i „odjavi sve ostale“.
29. **Novo:** admin vidi sesije korisnika i može ih opozvati (`session.revoked_admin`, obavezan razlog).
30. Pri ponovnoj prijavi sa istog uređaja stara sesija se opoziva (jedna aktivna sesija po uređaju, ne po korisniku).

### 1.7 Matrica rola (odluka: ostaje kod u MVP-u)
31. Dozvole su **kod** (`permissions.ts`), jedan izvor za `guard()`, meni, matricu u UI i generisani test. Firma ih ne mijenja u MVP-u.
32. Matrica u UI-u je **pregled**, ne editor: kod dozvole, naziv, opis, koje role je imaju, i eksplicitna oznaka osjetljivih (`payroll.*`, `users.manage`, `audit.view`).
33. Nova dozvola se dodaje isključivo zajedno sa rutom koja je provjerava (test pada ako dozvola nema ni jednu rutu).
34. Editabilnost po firmi (v1.1): `role_permissions` sa `company_id` nullable = platformski default. Model to ne smije blokirati, ali se u MVP-u **ne gradi**.

### 1.8 Operator platforme
35. `platform_users` se oživljava: odvojena prijava (`/platform/login`), odvojena sesija, **bez** pristupa poslovnim podacima firme po defaultu.
36. Operacije operatora: lista firmi (naziv, slug, status, broj korisnika, zadnja aktivnost), suspend/aktivacija firme, kreiranje firme (čarobnjak, §1.10), **support pristup**.
37. Support pristup: vremenski ograničen (max 60 min), veže se za **obavezan razlog** i firmu, upisuje u audit firme (`platform.support_access_granted`), a firma ga vidi u svom audit tragu i u zaglavlju UI-a dok traje. Nikad „tihi“ pristup.
38. Operator ne vidi šifrovane tajne, ne mijenja lozinke korisnika, ne može obrisati firmu.

#### Vlasnički dodatak — F1-03b (2026-11-27)

Svi operatori platforme (`platform_users`) moraju uspješno potvrditi TOTP prije izdavanja platform sesije. Ovo važi za svaku putanju prijave; passkey/WebAuthn nije zamjena za TOTP, a sama lozinka ili passkey nisu dovoljni za sesiju. Ovaj dodatak normira obavezni faktor, ali ne odobrava konkretan lifecycle niti implementaciju: secret storage, enrollment i first-operator bootstrap, pre-auth challenge te recovery/reset ostaju za dizajn prije koda.

### 1.9 Audit
39. `audit_events` je append-only. Upis u **istoj transakciji** kao poslovna izmjena (postojeće); za novac i dozvole obavezno.
40. **Novo:** standardizovan `metadata`: `{ before: {...}, after: {...}, changed: ["field"] }` kroz jedan helper. Slobodne strukture se odbacuju; ključevi koji liče na tajne padaju (postojeća zaštita ostaje).
41. **Novo:** `retention_class` po zapisu: `STANDARD` (2 g.), `ACCESS` (5 g.), `FINANCIAL` (10 g.). Noćni job u workeru arhivira/briše po klasi; brisanje je zapisano (`audit.retention_purged` sa brojem zapisa, ne sadržajem).
42. **Novo: trag pristupa osjetljivim podacima** — svaki **čitanje**-tip događaj za plate/obračune, medicinske priloge i lične podatke upisuje `audit` sa `retention_class=ACCESS` (`payroll.viewed`, `attachment.sensitive_viewed`). Danas se bilježi samo izmjena.
43. Audit preživljava brisanje korisnika: `actor_email` je denormalizovan (postojeće).

### 1.10 Onboarding firme (MVP, kroz operatora)
44. Čarobnjak: naziv → slug (auto, provjera zauzetosti) → PIB/PDV + adresa + valuta + zona + `week_start` → email vlasnika → izbor zadanih šifarnika (kategorije mašina, tipovi obaveza, jedinice) → potvrda.
45. Sve u **jednoj transakciji**: firma + vlasnik (ako ne postoji korisnik, pozivnica; ako postoji, članstvo OWNER) + zadani šifarnici + `audit`.
46. Idempotentno po `slug`; djelimično kreirana firma ne smije ostati.

### 1.11 Obavještenja (kanal koji ovaj modul uvodi, koristi ga cijeli sistem)
47. Jedan mehanizam za sve poruke: `notification_templates` (kod, jezik, subject, body, varijable), `notifications` (red čekanja sa statusima `QUEUED → SENDING → SENT / FAILED → DEAD`, `attempts`, `last_error`, `dedupe_key`), `notification_preferences` (per-user: in-app / email / push).
48. Worker (`apps/worker`, **pg-boss** na postojećem Postgresu, bez Redisa) šalje kroz interfejs `Mailer`. Prvi adapter: **SMTP**. Bez provajdera: `BLOCKED_NO_PROVIDER` (+ prikaz u UI-u), nikad lažni uspjeh.
49. Retry: 3 pokušaja sa backoff-om (1 min, 5 min, 30 min) → `DEAD`; admin ekran `/ured/obavjestenja` prikazuje red, neuspjehe i dugme „ponovi“.
50. `dedupe_key` sprječava duplu poruku (npr. isti podsjetnik za isti rok istog dana).

---

## 2. Promjene na bazi (nove migracije, forward-only)

### 2.1 `companies` — proširenje
`legal_name`, `tax_id`, `vat_id`, `vat_registered` bool, `address`, `city`, `postal_code`, `country` (default `BA`), `phone`, `email`, `web`, `iban`, `bank_name`, `logo_object_key`, `week_start` (`MON`/`SUN`), `workday_hours` numeric(4,2) default 8.00, `overtime_daily_threshold` numeric(4,2) default 8.00, `night_from` time, `night_to` time, `holiday_paid` bool default true, `default_locale`, `default_currency` (postojeće `currency`/`locale` ostaju kao izvor istine; nova polja ne dupliraju).
Sve nullable osim zadatih vrijednosti → postojeći podaci ne pucaju.

### 2.2 Nove tabele
| Tabela | Ključna polja | Napomena |
|---|---|---|
| `company_holidays` | `id, company_id, holiday_date, name, is_paid, is_working` | `is_working=true` = prenesena radna subota; unique `(company_id, holiday_date)` |
| `password_history` | `id, user_id, password_hash, created_at` | max 3 po korisniku (trigger ili servis) |
| `user_totp` | `id, user_id, secret_enc, enabled_at, confirmed_at` | `secret_enc` AES-256-GCM; unique `user_id` |
| `user_recovery_codes` | `id, user_id, code_hash, used_at` | 10 po korisniku, jednokratni |
| `sessions` — proširenje | `user_agent, device_label, last_seen_at, ip_hash` | bez novih tabela |
| `notification_templates` | `id, company_id, code, locale, subject, body, variables` | `code` iz zatvorenog kataloga; `company_id NULL` = platformski default |
| `notifications` | `id, company_id, user_id/email, kind, payload, status, attempts, last_error, dedupe_key, scheduled_at, sent_at` | indeks `(company_id, status, scheduled_at)` |
| `notification_preferences` | `user_id, channel, enabled` | |
| `platform_support_sessions` | `id, platform_user_id, company_id, reason, expires_at, revoked_at` | audit veza |

### 2.3 `users` — proširenje
`locked_until`, `failed_login_count`, `password_changed_at`, `totp_enabled` bool, `must_enroll_2fa` bool, `last_login_at`.
`audit_events` — proširenje: `retention_class` (`STANDARD` default), `actor_role` (role u trenutku radnje).

### 2.4 RLS i privilegije
Svaka nova tenant tabela: `ENABLE` + `FORCE ROW LEVEL SECURITY`, politika `company_id = current_setting('app.company_id')`, unos u `privilege-matrix.tsv` i u preflight provjeru. `platform_*` tabele **nisu** tenant tabele — pristup samo kroz administrativnu rolu, bez `GRANT` aplikacijskoj.

---

## 3. API ugovor (dodaci; sve kroz `packages/contracts`, OpenAPI se generiše)

| Metoda | Ruta | Dozvola | Napomena |
|---|---|---|---|
| GET/PATCH | `/api/company` | `company.settings.view` / `company.settings.manage` | nova dozvola; postavke iz §1.1 |
| GET/POST/PATCH/DELETE | `/api/company/holidays` (+`/:id`) | `company.holidays.manage` | praznici i radne subote |
| GET | `/api/me/sessions` | authenticated | lista vlastitih sesija |
| DELETE | `/api/me/sessions/:id` | authenticated | opoziv pojedinačne |
| POST | `/api/me/sessions/revoke-others` | authenticated | „odjavi sve ostale“ |
| GET | `/api/users/:id/sessions` | `users.manage` | admin pregled |
| POST | `/api/users/:id/sessions/revoke` | `users.manage` | uz razlog |
| POST | `/api/auth/2fa/enroll` · `/verify` · `/disable` | authenticated | uparivanje, potvrda, isključivanje (samo ako rola ne zahtijeva) |
| POST | `/api/auth/2fa/recovery` | pre-auth token | prijava recovery kodom |
| POST | `/api/users/:id/2fa/reset` | `users.manage` | uz obavezan razlog |
| GET/PATCH | `/api/roles` | `roles.view` | pregled matrice; PATCH **samo** opis/oznaka osjetljivosti, ne efektivne dozvole |
| GET | `/api/platform/companies` | platform sesija | lista firmi |
| POST | `/api/platform/companies` | platform sesija | onboarding čarobnjak (§1.10) |
| POST | `/api/platform/companies/:id/suspend` · `/activate` | platform sesija | |
| POST | `/api/platform/companies/:id/support-access` | platform sesija | `{reason, minutes ≤ 60}` → token |
| GET | `/api/notifications` | authenticated | in-app inbox, cursor |
| GET/POST | `/api/notifications/outbox` · `/outbox/:id/retry` | `users.manage` | red čekanja |

**Novi kodovi grešaka** (`ERROR_CODES`, zatvoren katalog): `AUTH_2FA_REQUIRED`, `AUTH_2FA_INVALID`, `AUTH_2FA_ENROLLMENT_REQUIRED`, `AUTH_ACCOUNT_LOCKED`, `AUTH_PASSWORD_REUSED`, `PLATFORM_FORBIDDEN`, `SUPPORT_ACCESS_EXPIRED`.
**Nove dozvole** (`permissions.ts`): `company.settings.view`, `company.settings.manage`, `company.holidays.manage`, `notifications.manage`. Matrica: view za OWNER/ADMIN/PM/ACCOUNTANT; manage za OWNER/ADMIN; `notifications.manage` OWNER/ADMIN.

---

## 4. UI / UX

| Ekran | Ruta | Sadržaj | Stanja |
|---|---|---|---|
| Postavke firme | `/ured/postavke` | 4 taba: **Osnovno** (identitet, kontakt, logo), **Rad i obračun** (`week_start`, `workday_hours`, prag prekovremenog, noćni interval, valuta, zona), **Praznici** (kalendar + lista, „prenesena radna subota“), **Dokumenti** (zaglavlje izvoza) | loading / prazno / greška / uspjeh; izmjena traži potvrdu |
| Moje sesije | `/ured/profil/sesije` | lista uređaja, „ovo je ovaj uređaj“, opoziv | prazno = „prijavljeni ste samo ovdje“ |
| 2FA uparivanje | `/lozinka/2fa` | QR + tajna + 6 cifara + recovery kodovi (jednom) | greška koda, isteklo, „nemam telefon“ → admin reset |
| Korisnici — detalj | `/ured/korisnici` (drawer) | role, opseg, sesije, 2FA status, reset 2FA, deaktivacija | zaštita OWNER-a i sebe |
| Obavještenja | `/ured/obavjestenja` | red čekanja, neuspjesi, šabloni, „ponovi“ | `BLOCKED_NO_PROVIDER` kao vidljivo stanje |
| Operator: firme | `/platform/firme` | tabela + suspend/activate + „Nova firma“ | odvojen shell, bez tenant menija |
| Operator: čarobnjak | `/platform/firme/nova` | 5 koraka iz §1.10 | validacija po koraku |
| Operator: support | modal | razlog + trajanje, vidljivo upozorenje dok traje | istek = automatska odjava |

Sve komponente iz kataloga (`/katalog`); nijedna nova vizuelna komponenta bez odobrenja (AGENTS.md §11).

---

## 5. Testovi (obavezni, idu u `quality/registry`)

1. Tenant: firma B ne vidi korisnike, pozivnice ni audit firme A (RLS + aplikacijski sloj).
2. Anti-lockout: ADMIN ne može deaktivirati OWNER-a, niko ne može ukinuti zadnju OWNER rolu.
3. 2FA: obavezna rola bez uparivanja ne dobija ni jednu drugu rutu; recovery kod radi jednom; reset 2FA je u auditu.
4. Lozinke: blacklist, ponovna upotreba zadnje 3, 10 promašaja → lock 15 min, prisilni reset samo za uredske role.
5. Sesije: promjena role opoziva sesije; opoziv pojedinačne ne dira druge; „odjavi sve ostale“ ostavlja tekuću.
6. Audit: `metadata` šema `before/after/changed`; čitanje plate upisuje `ACCESS` zapis; retencija briše po klasi.
7. Notifikacije: bez provajdera → `BLOCKED_NO_PROVIDER` (ne `SENT`); `dedupe_key` sprječava duplu poruku; 3 neuspjeha → `DEAD`.
8. Onboarding: firma + vlasnik + šifarnici u jednoj transakciji; ponovni `slug` = `CONFLICT`; pad u koraku 4 ne ostavlja firmu.
9. Support pristup: istekao token ne radi; pristup je vidljiv u auditu firme.

---

## 6. Van opsega ovog modula
Editabilna matrica rola po firmi (v1.1) · SSO/OAuth · SMS kanal · brisanje firme i offboarding izvoz (B15.21) · granularne dozvole po polju.
