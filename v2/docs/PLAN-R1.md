# PLAN R1 — pristup (R1a) i matrica + audit (R1b)

**Datum:** 2026-11-08 · **Status:** predlog, čeka odobrenje · **Kapije:** G1a poslije R1a, G1b poslije R1b
**Redoslijed:** plan (ovo) → dva dizajn smjera + wireframe → kod R1a → demo/kapija → isto za R1b.

## Model (nove migracije; RLS politika za SVAKU novu tabelu)

| Tabela | Ključna polja | Zašto |
|---|---|---|
| `invitations` | `token_hash`, `email`, `roles[]`, `scope`, `expires_at`, `used_at`, `created_by` | jednokratan link; u bazi samo hash, kao refresh token |
| `password_resets` | `token_hash`, `user_id`, `expires_at`, `used_at`, `created_by` | admin pokreće, korisnik sam postavlja lozinku |
| `membership_scopes` | `membership_id`, `scope`, `project_ids[]` | `FIRMA` / `DODIJELJENI` / `SVOJE`; `membership_id` jer `project_ids` miruje dok ne bude R2 tabela `projects` |
| `audit_events` (postojeća) | `+ actor_email`, `+ ip`, `+ metadata jsonb` | filter po korisniku/resursu/vremenu bez join-a na `users` (audit mora preživjeti brisanje) |
| `login_attempts` | `email_hash`, `ip`, `at` | rate limit koji radi za više replika (sada je `Map` u memoriji) |

Bez `mustChangePassword` migracije — polje postoji od R0.

## API (envelope + zatvoren katalog kodova, kao do sada)

```
POST   /api/auth/change-password        (sesija; trenutna + nova; gasi ostale sesije)
POST   /api/auth/logout-all             (sesija)
GET    /api/users                        (ADMIN/OWNER; lista + status + role + opseg)
POST   /api/users/invitations            (ADMIN/OWNER → { link } jednokratno)
POST   /api/users/invitations/:token/accept  (javno; postavlja lozinku, pravi membership)
POST   /api/users/:id/reset-password     (ADMIN/OWNER → { link } jednokratno)
POST   /api/users/:id/deactivate         (ADMIN/OWNER; gasi sve sesije te osobe)
PATCH  /api/users/:id/membership         (R1b: role + opseg)
GET    /api/audit                        (R1b: cursor + filter user/entityType/from-to)
```

Ključno: ADMIN ne može mijenjati OWNER-a ni sebe (posljednji OWNER je zaštićen); svaka izmjena piše `audit_events` u **istoj** transakciji.

## Ekrani (bez novih dizajn smjerova — postojeći tokeni)

| Ekran | Stanja koja moraju postojati |
|---|---|
| `/prijava` (postojeći) | + „Zaboravljena lozinka? → obrati se administratoru“ (bez emaila) |
| `/lozinka/promjena` | obavezna poslije prve prijave; greška politike; uspjeh |
| `/lozinka/postavi?token=` | token važeći / istekao / iskorišten; uspjeh |
| `/ured/korisnici` | učitavanje, prazno, greška, uspjeh; pozivnica (modal sa linkom + Kopiraj), reset, deaktivacija (potvrda) |
| `/ured/audit` (R1b) | filteri, prazno, „nema više“, greška |

Sva stanja su obavezna (učitavanje / prazno / greška / uspjeh), tastatura kroz cijeli tok, tekstovi na bosanskom.

## Testovi

- **Tenant izolacija, generisano po resursu** (invitations, resets, scopes, audit): firma A ne vidi ni jedan red firme B; test se generiše iz liste tenant tabela da novi resurs ne može ostati nepokriven.
- **Dozvole po roli:** matrica rola × ruta; ADMIN smije, SITE_SUPERVISOR ne smije, WORKER ne smije; ADMIN ne dira OWNER-a.
- **Jednokratnost:** iskorišten/istekao/opozvan token → isti kod, bez razlike u poruci.
- **Rate limit:** 5 neuspjeha ⇒ `RATE_LIMITED`, uspjeh resetuje brojač, radi preko dva procesa (dijeljena tabela).
- **Audit:** svaka izmjena ostavlja tačno jedan zapis; filteri vraćaju isto što i direktan upit.
- **E2E glavnog toka** — vidi odluku ispod (Playwright nije u projektu).

## Procjena i zavisnosti

| | R1a | R1b |
|---|---|---|
| Model + RLS + testovi izolacije | 1 dan | 0,5 |
| API + testovi dozvola | 1,5 | 1 |
| Ekrani + stanja + a11y | 1,5 | 1 |
| E2E, demo, dokumentacija | 1 | 0,5 |
| **Ukupno** | **~5 dana** | **~3 dana** |

**Otvoreno prije početka koda:**
1. **E2E:** Playwright nije u projektu. Opcija A = dodati ga (nova zavisnost, treba ADR). Opcija B = HTTP-level E2E kroz `fetch` na pravoj bazi (bez browsera) + ručni demo za ekrane. Preporuka: **B za R1a**, Playwright kad bude treći ekran.
2. **Email** (ne blokira R1a): link se kopira i šalje ručno. Tri opcije za ADR 0008 — (a) **Resend** (najlakše, 3.000/mj besplatno, preporuka), (b) SMTP preko postojećeg provajdera firme (bez nove zavisnosti, loša reputacija), (c) AWS SES (najjeftinije na obimu, najviše postavljanja). Self-service reset ide tek s emailom.
3. **`login_attempts` raste** — čišćenje starijih od 24 h pri svakom pokušaju (bez `worker` procesa) ili indeks + periodični posao u R2.
