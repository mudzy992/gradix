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
- **Rate limit:** 5 neuspjeha ⇒ `RATE_LIMITED` (429) sa `Retry-After`; **koliko još traje prozor** računa baza (`login_attempt_retry_after`), pa poruka kaže stvarni broj sekundi, ne fiksnu minutu. Uspješna prijava resetuje brojač. Ključ je `trim().toLowerCase()` emaila — isti ključ za brojanje i za prijavu, inače razmak otvara drugi brojač. Radi preko više procesa (dijeljena tabela).
- **Audit:** svaka izmjena ostavlja tačno jedan zapis; filteri vraćaju isto što i direktan upit.
- **E2E glavnog toka** — vidi odluku ispod (Playwright nije u projektu).


---

## Kako RLS radi prije prijave (invitations, password_resets, login_attempts)

Prijava je jedini tok u kojem se čita **prije nego znamo firmu**, pa `withCompany` ne može
posredovati. Tri tabele se zato rješavaju na tri različita načina — i nijedan ne zaobilazi
izolaciju:

1. **`invitations` — tenant tabela, čita se dvaput.**
   - Admin izdaje pozivnicu: ima sesiju, dakle firmu → `withCompany` + `SET LOCAL app.company_id`
     kao i sve ostalo. RLS politika je `company_id = current_setting('app.company_id')`.
   - Primalac otvara `/lozinka/postavi?token=…`: firme još nema. Tada se **neznačajni** podaci
     (email, role, opseg, rok) čitaju kroz **uskopojasnu `FOR SELECT` politiku** koja pušta red
     samo kad je `token_hash` jednak vrijednosti koju je server stavio u
     `app.invite_lookup_token` (isti obrazac kao `auth_lookup_session` iz migracije
     `20261107160000`). Token je 32 slučajna bajta — pogađanje je nemoguće, a politika ne
     dozvoljava čitanje „svega“, samo red koji odgovara proslijeđenom ključu. Upis (postavljanje
     lozinke, `used_at`) ide posebnom `FOR UPDATE` politikom vezanom na isti ključ, u jednoj
     transakciji sa `UPDATE … WHERE used_at IS NULL` (atomski claim, kao kod refresh tokena).

2. **`password_resets` — potpuno isti obrazac, po `user_id` iz sesije.** Čita admin (kroz firmu)
   i primalac (kroz `app.reset_lookup_token`). Nema putanje koja vraća listu resetova.

3. **`login_attempts` — nije tenant tabela i zato RLS ne bi imao smisla.** Čuva se **bez
   čitljivog identiteta**: `email_hash` (SHA-256 sa `AUTH_SECRET` kao pepperom, ne čist hash —
   bez tajne se ne može pogoditi email iz baze) i `ip_hash`. Nema `company_id` jer se firma u tom
   trenutku ne zna i ne smije se saznati. Tabela nema RLS politiku „po firmi“ nego **samo
   zapisivanje i brojanje** kroz dvije funkcije (`login_attempt_record`, `login_attempt_count`);
   aplikacijska rola nema direktan `SELECT` na tabelu. Tako rate limit ne postaje oracle koji
   otkriva postoji li nalog.

**Zajedničko pravilo:** nijedna nova tabela ne dobija „pročitaj sve“ politiku. Svaka ima ili
tenant politiku (`company_id`), ili politiku vezanu na **tačan ključ pretrage** koji postavlja
server u `SET LOCAL` unutar transakcije, ili nema `SELECT` pravo uopšte. Test izolacije se
generiše iz liste tenant tabela, pa nova tabela ne može ostati nepokrivena.

## Kako se čuvaju tokeni (i zašto ih nema u logu ni u auditu)

| Pravilo | Kako |
|---|---|
| U bazi samo hash | `token_hash = sha256(token)`; sirovi token postoji samo u odgovoru onome ko ga je izdao i nikad se ne upisuje |
| Jednokratnost | `used_at` + `UPDATE … WHERE used_at IS NULL RETURNING id` u transakciji; drugi pokušaj dobija isti kod `INVITE_INVALID` (bez razlike istekao/iskorišten/izmišljen) |
| Rok | pozivnica i reset **48 h**; istek se provjerava u istom `UPDATE`-u, ne u aplikaciji |
| Nikad u logu | token se ne pojavljuje u porukama greške, u `console.*`, ni u `pino` poljima; jedini izlaz je tijelo odgovora kreiranja |
| Nikad u auditu | `audit_events` za ove akcije nosi `action` (`invitation.created`, `password.reset_issued`, `password.changed`), `entity_id` (id zapisa, ne token) i `metadata` **bez** tokena. Test to tvrdi: serijalizovan audit zapis ne sadrži vrijednost tokena |
| Opoziv | novi token ne opoziva stari automatski; stari sam ističe. Deaktivacija korisnika gasi sve sesije i sve važeće pozivnice te osobe |
| U URL-u | token je u **query** dijelu, pa ga Next.js ne loguje po defaultu; `Referer` se ne šalje na treće strane jer nema vanjskih resursa. Nakon uspjeha URL se zamjenjuje (`router.replace`) da token ne ostane u istoriji |

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
