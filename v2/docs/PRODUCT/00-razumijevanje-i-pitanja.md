# Gradix v2 — Faza 0: razumijevanje i pitanja

Verzija 1 · 7. 11. 2026. · Kapija **G0** (bez koda)

> **Nisam mogao provjeriti:** stvarno stanje infrastrukture (rade li Postgres/Redis/MinIO/Coolify, resolviraju li se domene), da li su vrijednosti u `.env` fajlovima žive tajne, ni pravila obračuna plaća za pilot firmu — sve to je niže označeno kao pretpostavka.

## a) Razumijevanje

Gradimo **operativni sistem za firmu koja radi niskogradnju**: projekat, ljudi, mašine, sati, rokovi, dokumenti i trošak na jednom mjestu — od tendera do obračuna sati. Korisnici: ured (desktop, gusti ekrani), šef gradilišta, radnik, vozač, rukovalac, mehaničar (telefon, sunce, loš signal) i vlasnik koji traži rizik, ne tabele. Podatak se unosi jednom, na mjestu nastanka, i sam teče dalje.
MVP (B4/B11 R0–R6): firme/korisnici/role/audit · projekti s fazama i budžetom · radnici i evidencija rada (web + mobilni, offline) · mehanizacija (sati, ture, gorivo) · univerzalne obaveze s rokom · dokumenti · obračun sati i priprema za isplatu · dashboard. **Van opsega:** glavna knjiga, PDV, e-faktura, CAD/BIM, javni portal, regrutacija; tenderi, servis, skladište, HSE, izvještaji su v1.1 (R7–R9); GPS, situacije, javni profil su v2. Radim vertikalne rezove, dizajn prije koda, kapija poslije svakog reza, bez stubova i bez izmišljanja posla.

## b) Nelogičnosti i rupe (s prijedlogom ispravke)

1. **A6 je matematički nemoguć:** 30 str. ukupno, a 14 obaveznih specifikacija (do 3 str.) + ~12 ADR + `PLAN.md` do 15. → specifikacije se stapaju u `PLAN.md` po rezu; 30 str. za žive dokumente, `PLAN.md` izdvojen; skillovi se ne broje.
2. **Cilj B1.3.4 (stvarni trošak vs budžet) traži nabavku i podizvođače — a to je B5.11 „Treba“.** → MVP budžet = rad + mehanizacija + gorivo + ručni trošak, tako i imenovan u UI-u.
3. **G1 traži „uživo na produkcijskoj domeni“, A0.7 kaže privremene poddomene.** → G1 na poddomeni; domeni su zasebna odluka poslije pilota.
4. **Offline sync je „najrizičniji dio“ (B8), a R4 je 4. rez.** → jedan offline zapis + push/pull + konflikt ulazi već u Fazu 1.
5. **B6.12 priznaje zamku „jedan korisnik = jedna firma“, ali `Membership` nema u modelu.** U v1 je `User.companyId` jedan nullable string, a `UserRoleAssignment` nema `companyId` — role su globalne po korisniku. → `Membership(userId, companyId, roles[])` od prve šeme; jedna firma je pravilo, ne ograničenje.
6. **Noćni rad (B5.7) protiv v1 pravila „nema splita preko ponoći“.** → sati se dijele po minuti u zoni firme (DST), jedan izvor sati po danu.
7. **Tri mehanizma za rokove:** B5.4 univerzalna obaveza, B5.3 vlastita kontrolna lista, B5.9 servis po satima. → obaveza = samo datum isteka na bilo koji entitet; servisni trigger je zasebno pravilo.
8. **Dvostruko knjiženje troška:** B5.2 automatski sabira, B5.11 dopušta ručni isti kategorije. → jedan `CostEntry` po događaju, `source + sourceId` unique, ručno samo gdje izvora nema.
9. **A3.1 traži 10 paketa i `apps/worker` odmah, a A3.3.10 zabranjuje mrtav kod.** → start bez `worker` i bez `i18n` paketa (dok ne bude drugi pozadinski posao, odnosno drugi jezik).
10. **Root nije u skladu s A0:** nema `README.md`, `.gitignore`, `.github/`, a **`.env` s tajnama je u gitu** (i `v1/.env.coolify`). Nalaz: rotirati tajne, `.env` van gita u Fazi 1.
11. **Root `.env` je i zastario:** sadrži `JWT_REFRESH_SECRET` koji po v1 D-029 više ne postoji, a nema `REFRESH_REPLAY_SECRET` koji v1 traži kao obavezan. Uz to `CORS_ORIGIN` ima 101 znak (vjerovatno dva origina) — ko to preuzme doslovno, prijava pada. → u v2 šema ide iz `v1/.env.example`, ne iz root `.env`.
12. **Git i deploy su pušteni iz ruku:** `v1-final` tag postoji (A0.6 ispunjeno), ali aktivna grana je `arena/37e610e9-gradix`, a noćni backup/restore drill se pokreće samo na staroj grani `arena/0bc0e56e-gradix`. → u Fazi 1: zaštita grane, `paths` filter bez imena grane, i provjera da Coolify ne deploya v1 na produkcijske domene (A0.7).
13. **Brisanje vs čuvanje:** B5.1 „nikad brisanje korisnika s historijom“ protiv B7 prava na brisanje. → anonimizacija + pravilo čuvanja (pitanje 10).
14. **Razlike prema v1 (brief ima prednost):** fajlovi bez ACL-a i bez potpisanih URL-ova (D-032) → v2 traži potpisane; „nema staginga“ (D-007) → v2 traži staging; „dva domena obavezno“ (D-041) → otvoreno; v1 miješa platform-admina s firmama (`PLATFORM_ADMIN` u istom enumu, `companyId` nullable) → v2 to razdvaja u modelu.

## c) Pregled pravila iz v1 (§4 BACKEND.md, DECISIONS.md)

| Pravilo | Status | Razlog |
|---|---|---|
| `companyId` na svakom zapisu, liste uvijek scope-ovane | preuzeto | cross-tenant bugovi su u v1 bili stvarni |
| Tenant zaštita samo u aplikaciji | izmijenjeno | provjereno: v1 nema `SET LOCAL`, `set_config` ni RLS; v2 dodaje RLS kao dubinsku zaštitu |
| Envelope + zatvoren katalog kodova (D-026) | preuzeto | testabilno, klijent prevodi po kodu |
| Paginacija `page/limit` | odbačeno | provjereno: v1 nema cursor nigdje u `common`; B7 traži cursor |
| JWT 15 min + neprozirni refresh, hash u bazi (D-029) | preuzeto | jednostavan, provjeren model |
| Refresh replay prozor/generacije (D-059) | odbačeno | B6.16: prekomjerno složeno |
| Unija permisija, deklaracija rute, hijerarhija rola (D-030) | preuzeto | bez toga je podjela rola kozmetička |
| Vidljivost projekata po roli/dodjeli | preuzeto | radnik ne vidi budžet; ide u matricu, ne u `if` |
| Timer: jedan otvoren po korisniku i mašini, pauza ne teče | preuzeto | domenski tačno |
| Tihi auto-close nakon 12 h | odbačeno | B6.8: pravilo vidljivo i ispravljivo |
| Ture/gorivo nepromjenjivi, ispravka kroz razlog | preuzeto | B6.10 potvrđuje princip, UI je nov |
| Gorivo ne skida cisternu | odbačeno | B6.9: jedan izvor istine |
| HSE online-only | odbačeno | B6.11: incident se prijavljuje offline |
| HSE: prijavljivač vidi svoje, tuđe 404 (D-033) | preuzeto | inače prijavljivači ne vide svoje prijave |
| Obračun: atomska odluka, niko ne odobrava sebe | preuzeto | kontrola i dokazivost |
| Satnica kao snapshot u trenutku rada (D-035) | preuzeto | povišica ne mijenja isplaćene mjesece |
| „Nema splita preko ponoći“ | izmijenjeno | noćni rad traži podjelu po danu |
| Sync: unique `localId`, batch 200, pull 1000, watermark | preuzeto | rješava tihi gubitak zapisa |
| Audit best-effort van transakcije (D-031) | izmijenjeno | za novac audit u istoj transakciji |
| Fajlovi bez ACL-a i bez potpisanih URL-ova (D-032) | odbačeno | `<img>` ne šalje zaglavlje (B6.20) |
| Email nikad lažni uspjeh, `reset` = 501 (D-013) | preuzeto | poštenje prema korisniku |
| Redis samo throttle, fail-open, trust proxy = 1 | izmijenjeno | ima smisla tek uz 2+ replike |
| Liveness odvojen od readiness (D-037) | preuzeto | pad baze ne smije praviti restart-loop |
| Javni sajt: whitelist, 404 bez enumeracije | odgođeno | v2 backlog, pravilo ostaje zapisano |
| Centralno mapiranje Prisma grešaka (v1 dug) | preuzeto kao zahtjev | dug se ne prenosi |
| `slug` immutable, email globalno unique | preuzeto | identitet tenanta i naloga stabilan |

## d) Infrastruktura iz v1 koja se preuzima (bez tajni)

- **Baza:** eksterni PostgreSQL, mreža `db_net`, TLS `verify-ca`; CA `/data/coolify/ssl/coolify-ca.crt` → `/etc/ssl/certs/coolify-ca.crt`; jedna `DATABASE_URL`; preflight na startu pada glasno.
- **Redis:** `redis-core` na `redis_net`, TLS **6380** (6379 ugašen), ACL korisnik samo na `gradix:*`, CA `/data/coolify/ssl/redis-core/redis-ca.crt`. U v2 samo uz opravdanje i definisan fail-open.
- **Domene:** `gradix.ba101.top` + `api.gradix.ba101.top`, tri usklađene postavke (API URL, CSP `connect-src` **i** `img-src`, CORS bez trailing slash). Raspored [OTVORENO].
- **Fajlovi:** MinIO `ghcr.io/coollabsio/minio:latest`, podaci `/mnt/shared-app-files/gradix/minio`, bucket `gradix`; prefiks po firmi, bez listinga.
- **Coolify/Docker:** bez `ports:` (blue/green), mreže `external`, CA mount `create_host_path: false`, entrypoint preflight → `migrate deploy` → `exec`, `HEALTHCHECK` na liveness, sve tajne kroz Coolify, ručni seed (produkcija = jedan platform-admin).
- **Okoline:** lokalni compose + staging + produkcija; bez staginga pilot ide naslijepo. Provjereno u v1: CI servisi su Postgres 16 + MinIO, **bez Redisa** (u skladu s fail-open pravilom); backup/restore drill postoji kao noćni workflow sa `backup.sh`/`restore.sh` — preuzimam **ideju drilla**, ne skripte.
- **Tajne:** preuzimam samo šemu varijabli, ne vrijednosti; rotacija prije prve deploy-a v2.

## e) Struktura `v2/` i plan Faze 1

```
v2/  AGENTS.md · apps/{web,mobile,worker} · packages/{db,domain,contracts,ui,config,testing}
     infra/ · docs/{STATUS.md, PLAN.md, PRODUCT/, DECISIONS/}
```

**Faza 1:** 1) workspace, TS strict, lint, `.gitignore`, `v2/AGENTS.md` (0,5 d) → 2) `STATUS.md` + ADR indeks (0,25) → 3) lokalni compose (0,5) → 4) `packages/db`: `Company, Membership, User, Session, AuditEvent` + migracija + seed (0,5) → 5) **tenant scope + RLS spike** + generisan test izolacije (1) → 6) prijava, zaštićena stranica, `/api/me`, jedan zapis (1) → 7) **mobilni kostur** + jedan offline zapis i push/pull (1,5) → 8) `contracts`: zod + generisan OpenAPI + klijent (0,5) → 9) CI <10 min: lint/type/test/E2E/tajne/bundle (0,5) → 10) Docker + staging + health/ready (0,5) → 11) pravila kao kod + 4 skilla (0,5). **~7 radnih dana.** Ne radim: `worker`, 2FA, tamnu temu, Sentry.

## f) Pitanja (12, po važnosti, s preporukom)

**Opseg i novac** — 1) Pilot firma: koliko radnika/mašina/projekata i 3 najveća problema? → odgovor prije G2; pretpostavka 40/25/5. 2) Entitet i računovođa za obračun, koji program? → FBiH, MVP samo sati + CSV, puni obračun tek uz pisanu potvrdu modela. 3) Je li MVP bez obračunskih situacija poslovno koristan? → situacije idu odmah poslije pilota, ispred tendera; odluka do G2. 4) Dva domena ili jedan s `/api`? → **jedan domen + `/api`** (u v1 su CORS/CSP/`img-src` oborile prijavu).
**Tehnika** — 5) Ostaje MinIO? → da, novi bucket/prefix po okolini, potpisani URL-ovi. 6) Offline engine: vlastiti ili gotov? → vlastiti tanki (red + `localId` + pravilo konflikta); PowerSync samo ako spike padne. 7) Android/iOS, čiji uređaji, kakav signal, ima li telematike? → Android-first, firmini uređaji, iOS kroz web do v1.1. 8) Koliko firma smije mijenjati role? → fiksne role, firma mijenja opseg i dodatne dozvole.
**Proces i pravno** — 9) Prodajemo li drugim firmama? → da, multi-tenant od dana 1, ali UI operatora nije MVP. 10) Rokovi čuvanja i brisanja? → 5 godina za poslovnu dokumentaciju, anonimizacija umjesto brisanja, audit pristupa. 11) Obavezni šabloni (dnevnik, platni listić, situacije)? → dnevnik kao interna PDF forma u R9, platni listić poslije računovođe, šablone dajete vi. 12) Referentne aplikacije, budžet i rok pilota? → polazim od palete D-040 i dva smjera na stvarnim ekranima; pilot 12 sedmica od G1.

## g) Tri najveća rizika i ublažavanje

1. **Obim** (8 domena + offline mobilni za 6 rola ≈ 10–14 sedmica, ne 4) → mjerilo su ciljevi B1.3, ne B5; jedan rez = jedan prolazni tok; opseg se zamrzava mjesečno; sve van R0–R6 čeka pilot.
2. **Offline sync i usvajanje na terenu** → sync spike već u Fazi 1, idempotentnost po `localId`, E2E prekida mreže, Maestro od R4, EAS od R0, pilot s jednom ekipom.
3. **Drift agenta — dokumentacija preraste proizvod i „zeleni CI“ se proglasi gotovim** → A6 kao tvrdo pravilo, `STATUS.md` ≤100 linija, najviše 1 ADR po rezu, nijedan rez gotov bez demoa i vaše riječi, izvještaj počinje sa „šta ne radi“.

**Trebam od tebe:** odgovore na 1–4 (ostalo može poslije) i riječ **„G0 odobreno“**; bez toga ne počinjem Fazu 1.
