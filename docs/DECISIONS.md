# DECISIONS.md — log odluka

> Ovdje idu **samo odluke koje je vlasnik odobrio** (ili koje su već implementirane i
> potvrđene u produkciji). Format: ID · datum · odluka · kontekst · alternative · posljedice.
>
> Nova odluka = novi ID. Promjena odluke = **novi ID** sa referencom na stari (nikad
> prepisivanje historije). Penzionisani dokumenti (`docs/_retired/`) služe kao historijski
> kontekst, ne kao izvor pravila.

---

## Odluke o procesu i smjeru (2026-11-02)

### D-001 — PostgreSQL je konačna baza
**Datum:** 2026-11-02 · **Status:** odobreno (vlasnik, odgovor P1)
**Odluka:** sistem radi isključivo na **PostgreSQL** (Prisma 7 + `@prisma/adapter-pg`).
Stara MySQL dokumentacija i pravilo „banned: PostgreSQL“ se **povlače**.
**Kontekst:** kod, migracija `init_postgres`, compose i CI već su PostgreSQL; dokumentacija je
tvrdila MySQL (`.cursor/rules/00_project.mdc`, `PLAN_FREEZE.md`, `ANALIZA…md`).
**Alternative:** (a) povratak na MySQL — odbačeno (migracija urađena, e2e zelen, CI zelen).
**Posljedice:** `backup/migrations/**` uklonjen (D-010); svi novi dokumenti pišu PostgreSQL.

### D-002 — Stara dokumentacija se penzioniše, pravila se prenose
**Datum:** 2026-11-02 · **Status:** odobreno (vlasnik, odgovor P2 = preporuka)
**Odluka:** sva stara dokumentacija (`.cursor/docs/**`, `.cursor/plans/**`,
`.cursor/rules/00_project.mdc`, `ANALIZA_I_PLAN_PRODUKCIJA.md`, `DEPLOYMENT_COOLIFY.md`,
`ENV_LIST.md`, `redis-cli-command.md`, `backend/README.md`) premješta se u `docs/_retired/`
uz originalnu putanju i baner. **Važeća poslovna pravila** iz matrica i freeze-a prenose se u
`docs/BACKEND.md`, `docs/FRONTEND.md`, `docs/MOBILE.md` i ovaj dokument.
**Alternative:** (b) matrice ostaju „žive“ — odbačeno (dva izvora istine).
**Posljedice:** jedan izvor istine (`docs/` + `AUDIT/`); `.cursorrules` i `.cursor/rules`
postaju kratki pokazivači na `docs/`.

### D-003 — Mobile: kvalitet + testovi prije objave
**Datum:** 2026-11-02 · **Status:** odobreno (P3 = preporuka)
**Odluka:** u ovom ciklusu mobile dobija testove, E2E i standarde; **EAS build/profili i
objava** dolaze nakon stabilizacije API-ja.
**Posljedice:** segment MOB-07 (EAS) je posljednji; do tada nema release procesa.

### D-004 — Maestro za mobilne E2E tokove
**Datum:** 2026-11-02 · **Status:** odobreno (P4)
**Odluka:** E2E na Android emulatoru u CI-ju pokreće se **Maestro** (YAML flow). Unit i
component testovi: Jest + React Native Testing Library.
**Alternative:** Detox (teži setup, dublja RN integracija), Appium (najveći overhead) — odbačeni
zbog cijene održavanja i stabilnosti u CI-ju. iOS se u CI-ju ne pokreće (cijena runnera).

### D-005 — Test piramida sa ras­tućim coverage pragom
**Datum:** 2026-11-02 · **Status:** odobreno (P5 = preporuka)
**Odluka:** unit testovi za logiku, API/integracija za ugovor, E2E za tokove. Coverage prag se
uvodi postepeno (detalji: `TESTING.md` §3) i **raste** kad segment zatvori pokrivenost.
**Alternative:** ostati samo na e2e — odbačeno (sporo, skupo, slaba dijagnostika).

### D-006 — Nove zavisnosti su dozvoljene uz zapis
**Datum:** 2026-11-02 · **Status:** odobreno (P6 = preporuka)
**Odluka:** nova biblioteka/tool je dozvoljena ako: (1) rješava stvarni problem, (2) ima
alternativu razmotrenu, (3) upisana je u ovaj dokument sa rizikom. Bez zapisa — nema zavisnosti.

### D-007 — Nema staging okruženja (za sada)
**Datum:** 2026-11-02 · **Status:** odobreno (P7)
**Odluka:** CI (živi Postgres + MinIO + build image-a + smoke testovi) je dovoljna verifikacija;
Coolify ima samo produkciju.
**Posljedice:** sve što CLG ne može pokriti (TLS prema bazi, host putanje) provjerava se kroz
`docker` job i pažljiv deploy; ako se pojavi potreba, otvara se novi ID.

### D-008 — Nova paleta i dizajn po WCAG 2.2 AA
**Datum:** 2026-11-02 · **Status:** odobreno (P8)
**Odluka:** brend paleta iz starih pravila **nije obavezna**; dozvoljen je novi dizajn sistema i
admin dashboarda uz obavezan **WCAG 2.2 AA**. Konkretan predlog (paleta + informaciona
arhitektura + wireframe opis) ide vlasniku na odobrenje **prije** implementacije.
**Alternative:** zadržati paletu i samo doraditi — vlasnik je izabrao novi dizajn.

### D-009 — Produkcijski seed svodi se na jednog platform admina
**Datum:** 2026-11-02 · **Status:** odobreno (P9 = preporuka)
**Odluka:** u produkciji se ne sadi demo skup (7 ops korisnika, demo firma, demo projekat);
produkcijski seed kreira **1 `PLATFORM_ADMIN`** korisnika. Demo seed ostaje za razvoj.
**Implementacija:** segment BE-08 (izdvajanje `seed-prod` iz `seed.ts`); do tada se demo seed
u produkciji ne pokreće.

### D-010 — Stare MySQL migracije se uklanjaju
**Datum:** 2026-11-02 · **Status:** odobreno (P10)
**Odluka:** `backup/migrations/**` (9 MySQL DDL fajlova + lock) se **briše** iz radnog stabla.
**Sigurnost:** fajlovi ostaju u git historiji (`5679a4b`), vraćanje:
`git checkout 5679a4b -- backup/migrations`.
**Posljedice:** jedina migracija je `20261102130000_init_postgres`.

### D-011 — AI-instrukcijski fajlovi ostaju, ali ne kao izvor istine
**Datum:** 2026-11-02
**Odluka:** `mobile/AGENTS.md` i `mobile/CLAUDE.md` ostaju (upute za alat: „čitaj Expo v57
dokumentaciju“). Novi `.cursor/rules/00_project.mdc` je **kratki pokazivač** na `docs/` i ne
duplira pravila. `.cursorrules` pokazuje na `docs/`.
**Razlog:** dupliranje pravila je izvor kontradikcija (vidi D-001).

---

## Implementirane odluke (potvrđene u produkciji/CI-ju)

### D-020 — Compose ne objavljuje host portove
**Datum:** 2026-11-02 · **Status:** implementirano (`a1ca82f`)
Coolify deploya blue/green; fiksni host port pada sa `address already in use`. Servisi koriste
`expose`; CI guard pada ako se `ports:` vrati.

### D-021 — Mreže su eksterne: `db_net` i `redis_net`
**Datum:** 2026-11-02 · **Status:** implementirano (`a1ca82f`)
PostgreSQL i Redis žive na postojećim mrežama hosta; compose se na njih priključuje sa
`external: true` (ne kreira ih, ne preimenuje).

### D-022 — CA certifikati se mapiraju u kontejner
**Datum:** 2026-11-02 · **Status:** implementirano (`5679a4b`)
`DATABASE_URL` koristi `sslrootcert=`; bez mount-a Prisma padne u runtime-u
(`ENOENT … coolify-ca.crt`). Rješenje: bind mount sa `create_host_path: false` + env override
(`POSTGRES_CA_FILE`, `REDIS_CA_FILE`) + SSL preflight u entrypointu.

### D-023 — MinIO podaci na hostu
**Datum:** 2026-11-02 · **Status:** implementirano (`5679a4b`)
`/data` je bind na `/mnt/shared-app-files/gradix/minio` (`MINIO_DATA_DIR`), ne anonimni volume.

### D-024 — Seed je dio produkcijske slike
**Datum:** 2026-11-02 · **Status:** implementirano (`645f669`)
`prisma/` se kompajlira u `dist/prisma/seed.js`; seed se pokreće `node`-om, bez `tsx`-a i bez
dev zavisnosti. Pokreće se **ručno** (nikad automatski u entrypointu).

### D-025 — MinIO image: `ghcr.io/coollabsio/minio:latest`
**Datum:** 2026-11-02 · **Status:** implementirano (`be3bbc7`)
`minio/minio:latest` i `quay.io/minio/minio:latest` nisu javno dostupni. Alternativa:
`quay.io/minio/aistor/minio:latest`. Override: `MINIO_IMAGE`.

### D-026 — API ugovor je stabilan
**Datum:** 2026-11-02 · **Status:** na snazi (naslijeđeno iz freeze-a)
Envelope `{success, data, meta}` / `{success:false, error:{code,message}}`; paginacija
`page/limit` (20/100); JWT nosi samo `sub`. Promjena traži odobrenje vlasnika.

### D-027 — Lint: `oxlint` na frontendu, `eslint` na backendu
**Datum:** 2026-11-02 · **Status:** na snazi
Različiti alati po paketu se **zadržavaju** dok se ne odluči standardizacija (segment STD-01
može predložiti jedinstven format/lint stack).

### D-012 — Paleta: predlog B („Slate/Teal“)
**Datum:** 2026-11-02 · **Status:** na snazi (vlasnik može promijeniti prije FE-01)
Odgovor na Q1. Neutralna tamna osnova + teal akcent; lakše prolazi WCAG 2.2 AA kontrast na tamnoj
podlozi i mirniji je za dugo radno vrijeme. Predlog A („Gradix Green“) ostaje zabilježen kao
alternativa; zamjena palete je izmjena tokena, ne arhitekture.

### D-013 — Email: lažni „success“ se uklanja dok nema SMTP-a
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na Q2. `email.service.ts` danas vraća uspjeh bez slanja. Do uvođenja SMTP-a (ili odluke da
se email ukloni) API vraća jasnu grešku/„not configured“, nikad lažni uspjeh.
**Implementirano (BE-16):** `trySend` više ne vraća `true` bez transporta — uvijek `false` uz
`logger.warn` (jednom) i `debug` po poruci; brojač `smtpCalls` (lažni dokaz) je uklonjen.
`POST /auth/forgot` ostaje `200` radi anti-enumeracije, `POST /auth/reset` je `501`.

### D-014 — Redis ostaje
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na Q3. Redis ostaje za rate-limit i cache; ako padne, aplikacija mora raditi sa
degradiranim performansama (fallback se dokumentuje u INF-07).

### D-015 — Bundle budžet: 250 kB gzip
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na Q4. FE-06 uvodi mjerenje; prelazak budžeta = pad CI-ja. Podizanje budžeta traži
obrazloženje u ovom fajlu.

### D-016 — Coverage floor: 40 % (start), +5 % po fazi
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na Q5. U skladu sa D-005; pragovi po fazi su u `docs/TESTING.md` §3. Prag se nikad ne
spušta, samo podiže.

### D-017 — Env validacija bez nove zavisnosti (ručna šema)
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na B3. `backend/src/config/env.ts` validira sve varijable koje backend čita, baca jednu
grešku sa svim problemima i vraća **string mapu** (da `ConfigService` semantika i postojeće
poređenje `=== 'true'` ostanu netaknuti). **Odbačeno:** `zod`/`joi` u backendu — dvije nove
zavisnosti i drugi stil validacije pored `class-validator`; pravilo P6 traži pisano obrazloženje, a
korist je mala za ~120 linija koda. Ako backend pređe na schema-first (npr. `zod` + OpenAPI),
odluka se revidira.

### D-018 — Swagger isključen u produkciji; prazan CORS = same-origin
**Datum:** 2026-11-02 · **Status:** na snazi (revidirano prije implementacije)
Odgovor na nalaze BE-01. `/api/docs` se registruje samo van produkcije ili uz `ENABLE_API_DOCS=true`.
`CORS_ORIGIN` **nije** obavezan: prazna vrijednost je ranije značila „reflektuj svaki origin“ uz
`credentials: true`, a sada znači **nijedan strani origin** u produkciji (`resolveCorsOrigin`);
u razvoju ostaje dozvoljeno sve. **Zašto ne „obavezno“:** frontend ide kroz isti nginx, pa
postavljanje CORS-a nije uslov za rad, a obaveznost bi rušila deploy bez stvarne koristi.

### D-029 — Refresh token je neprozirni slučajni string, ne JWT
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na BE-02. Refresh token = **48 slučajnih bajtova** (base64url); u bazi se čuva samo
`sha256` hash (`RefreshToken.tokenHash`, unique), `expiresAt = +30 dana` (`REFRESH_DAYS`), opoziv je
`revokedAt` (soft). **Rotacija** na svaki refresh: stari token se opoziva i izdaje se novi par;
ponovna upotreba već opozvanog tokena gasi **sve** sesije korisnika (`401 AUTH_REFRESH_REUSE`).
Posljedica: **`JWT_REFRESH_SECRET` ne postoji** — uklonjen je iz `docker-compose.yml`,
`.env.example`, `.env.coolify`, `backend/.env.example`, CI-ja i `config/env.ts`.
**Zašto ne JWT refresh:** JWT se ne može opozvati bez server-side liste, pa bi tabela svakako
trebala; neprozirni hashirani token ne nosi podatke koje klijent ne treba da vidi, a baza ostaje
jedini izvor istine. **Cijena:** jedan upit na bazu po refreshu (zanemarivo uz 20/min limit) i
dnevni cron (03:00) koji briše istekle i tokene opozvane prije `REFRESH_RETENTION_DAYS` (7 dana).

### D-030 — Ne upravljaš nalogom koji ima višu rolu od tvoje
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na F-BE-03-01. `users.write` daje pravo da menjaš korisnike **u svojoj firmi**, ali ne i
da preuzmeš nalog iznad sebe. Pravilo (`common/rbac/role-hierarchy.ts`):
`PLATFORM_ADMIN` se ne dodjeljuje kroz tenant rute i niko ne može njime upravljati; nalogom sa
`SUPER_ADMIN` mogu upravljati samo `SUPER_ADMIN` i `PLATFORM_ADMIN`. Primjenjuje se u
`PATCH /users/:id` i `POST /users/:id/reset-password`.
**Zašto:** bez toga ADMIN u dva zahtjeva (reset lozinke → prijava) postaje SUPER_ADMIN, pa je
svaka podjela na role u firmi bila kozmetička. **Cijena:** ADMIN više ne može resetovati lozinku
SUPER_ADMIN-a — to radi drugi SUPER_ADMIN. **Odbačeno:** rangiranje svih 10 rola po „težini“
(previše proizvoljno) i skrivanje SUPER_ADMIN-a iz liste (ne blokira direktan `PATCH`).

### D-031 — Audit zapis je best-effort, ne uslov za poslovnu operaciju
**Datum:** 2026-11-02 · **Status:** na snazi
Odgovor na F-BE-04-02. `AuditService.write()` hvata grešku, loguje je (action + entitet) i **ne
ruši zahtjev** — poslovna izmjena je u tom trenutku već committed, pa bi `500` klijentu bio laž:
zapis je nastao, a klijent misli da nije. **Zašto ne „fail the request“:** konzistentnost bi tražila
da audit ide u istu transakciju kao izmjena, a to znači prosljeđivanje `tx` kroz sve servise i
mijenja desetine potpisa; za v1 je važnije da operacije rade nego da nijedan audit zapis ne
izostane. **Odbačeno:** outbox tabela + worker (previše za v1), tihi `catch {}` (nema traga).
**Dug:** u BE-08 (šema) i BE-09 (ops servisi) preporuka je `tx.auditEvent.create` u istoj
transakciji za finansijske operacije (payroll, stock, fuel).

### D-032 — Fajlovi: pristup po firmi, bez ACL-a po fajlu
**Datum:** 2026-11-03 · **Status:** na snazi
`GET /api/files?path=…` provjerava tenant prefiks (`{companyId}/`, `assertStoragePath`) i ništa više.
Nema tabele dozvola po objektu, nema potpisanih URL-ova. **Zašto tako:** putanje su
`{companyId}/{yyyy}/{mm}/{uuid}.{ext}` — nema listinga i nema načina da se putanja pogodi; svaka
putanja se do klijenta vraća **samo kroz endpoint koji već provjerava dozvolu** (dnevnik, HSE,
vagan, dokument, tender). Za v1 je to proporcionalno: pravi ACL bi tražio novu tabelu, provjeru u
svakom od ~8 tokova i UI za dijeljenje. **Popravljeno u BE-11:** odgovor sada nosi tačan
`Content-Type`/`Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
sandbox` i `Cache-Control: private, no-store`; greška streama uništi odgovor umjesto da visi.
**Kada revidirati:** čim se pojavi dijeljenje fajla van firme, javni link na prilog ili
fajl koji pripada više firmi.

### D-033 — HSE: prijavljivač vidi svoje prijave
**Datum:** 2026-11-03 · **Status:** na snazi (odluka vlasnika, opcija A)
Do BE-11 lista incidenata je tražila `hse.read`, a `WORKER`/`DRIVER`/`MACHINE_OPERATOR` imaju samo
`hse.write` — dakle **jedini ljudi koji HSE prijave unose nisu mogli da ih vide** (403 i na listu i
na sopstvenu prijavu). Sada: `hse.read` daje domen (firma / dodijeljeni projekti), a `hse.write` bez
`hse.read` daje **samo vlastite** prijave (`userId = actor.id`) i dozvoljava ACK/CLOSE tih prijava.
Tuđa prijava vraća `404`, ne `403` — da se ne otkriva postojanje. **Odbačeno:** (B) zadržati 403
(prijavljivač ne vidi šta je prijavio — nerealno za HSE obrazac); (C) dati `hse.read` svim radnicima
(otvara sve HSE zapise firme). **Revidirati** ako se traži anonimno prijavljivanje.

### D-034 — Dashboard po najširoj roli; prisustvo po dodjeli
**Datum:** 2026-11-03 · **Status:** na snazi
Odgovor na F-BE-12-01/F-05. (1) Verzija dashboarda se bira po **najširoj** roli (firma → PM/SS →
DRIVER → WORKER/MACHINE_OPERATOR → MECHANIC); korisnik sa više rola više ne „upada“ u terenski
dashboard. (2) `GET /projects/:id/presence` prikazuje samo korisnike **dodijeljene** projektu —
prije je lista bila „bilo ko iz firme ko prođe kroz geofence“. Dashboard i dalje prikazuje prisustvo
na nivou firme, jer je to pitanje „ko je na terenu danas“. **Odbačeno:** filtriranje po dodjeli i na
dashboardu (PM bi izgubio pregled ljudi koji rade na tuđim projektima), zadržavanje stare liste
projekta (dostavljač u prolazu se brojao kao radnik na gradilištu).

### D-035 — Payroll: mjerodavna je satnica iz trenutka rada (snapshot)
**Datum:** 2026-11-03 · **Status:** na snazi (odluka vlasnika, opcija A)
Do BE-14 iznos se računao `user.hourlyRate` **u trenutku čitanja**, pa je povišica retroaktivno
mijenjala i već odobrene mjesece (a `from-payroll` je knjižio trošak po današnjoj satnici za rad od
prije godinu dana). Sada `TimerSession.hourlyRateSnapshot` pamti satnicu **u trenutku zatvaranja
sesije**; svi putevi iznosa (`payroll-summary`, `serialize-payroll`, `erp/from-payroll`) koriste
`payrollRate()` = `snapshot ?? user.hourlyRate`. Snapshot piše jedina tačka zatvaranja
(`TimerForceCloseService.closeSession`), pa ga dobijaju i stop, force, auto-close i offline replay.
`null` snapshot (sesije zatvorene prije migracije) pada na trenutnu satnicu — bez backfilla, jer se
istorijska satnica za te redove ne može pouzdano rekonstruisati. **Odbačeno:** (B) satnica na
`PayrollPeriod`/mjesečnom nalogu (povišica usred mjeseca i dalje bi bila nemoguća, a nalog se
zaključuje tek na kraju); (C) retroaktivni preračun uz audit (mijenja već isplaćene iznose).
**Posljedica:** izmjena satnice više nije „popravka“ starih mjeseci; ako je satnica bila pogrešna u
trenutku rada, ispravka ide kroz `/amendments` + ručni `CostEntry`, ne kroz `PATCH /users/:id`.

### D-036 — Sync ugovor: limiti batch-a, limit pull-a i watermark bez preskakanja
**Datum:** 2026-11-03 · **Status:** na snazi
Offline klijent šalje sve što je skupio u jednom `POST /sync/push` i pamti `lastSyncTimestamp` iz
`POST /sync/pull`. Do BE-17 tri stvari nisu bile ugovor nego slučajnost: (1) batch nije imao
gornju granicu — jedan zahtjev je mogao nositi hiljade itema i držati worker proces; (2) `pull` je
vraćao **sve** redove od `since`, pa je prvi sync poslije duge pauze bio neograničen odgovor;
(3) `lastSyncTimestamp` je bio `new Date()` u trenutku odgovora, pa je red upisan između upita i
odgovora imao `updatedAt` **manji** od watermark-a i klijent ga nikad nije dobio (tihi gubitak).
Sada: push prima najviše **200** itema (`SYNC_PUSH_MAX_ITEMS`, klijent reže red u
`mobile/sync/engine.ts`), pull vraća najviše **1000** redova po kolekciji (`SYNC_PULL_LIMIT`),
watermark je najmanji zadnji `updatedAt` među kolekcijama koje su nešto vratile (inače `since`), a
`since` u budućnosti je `400` umjesto klijenta koji zauvijek ne dobija podatke.
**Odbačeno:** (A) keyset paginacija sa `cursor` poljem — ispravno, ali mijenja ugovor za sve
klijente i traži verzionisanje; `take` + watermark daje isto jamstvo uz nula novih polja (red na
granici se šalje ponovo, a klijent je idempotentan po `localId`/`serverId`); (B) server-side
`since` korekcija na `min(updatedAt)` **samo** kad je odgovor pun — i dalje propušta redove kad
kolekcija nije puna, pa je pravilo jedno za sve slučajeve.
**Posljedica:** red na granici može doći dvaput; klijent mora upsertovati (radi po `id`).

### D-037 — Health: liveness i readiness su dvije rute, ravan JSON
**Datum:** 2026-11-03 · **Status:** na snazi
`GET /api/health` je bio i liveness i readiness: javna ruta bez tokena koja na svaki poziv radi
`SELECT 1` i vraća `{ process, postgres }` u standardnom envelope-u. Isti endpoint je vezan na
Docker/Coolify `HEALTHCHECK`, pa je **pad baze** činio kontejner „unhealthy“ i izazivao restart-loop
aplikacije koja je živa i oporavlja se sama kad baza vrati. Sada: `GET /api/health` = liveness
(bez baze, `{ status, uptimeSeconds }`), `GET /api/ready` = readiness (baza — od INF-05 i MinIO i
migracije — sa limitom 2 s;
`503` + `postgres.status='error'`, bez detalja greške). Obje rute su `@Public` i **bez envelope-a**
— to je infrastrukturni ugovor, ne API resurs, i monitor/orchestrator čita `status` direktno.
**Odbačeno:** (A) zadržati bazu u `/api/health` i dodati samo `/health/ready` — restart-loop na pad
baze ostaje; (B) vratiti envelope na health rute — `{data:{status}}` je nezgodan za probe, a ništa
u aplikaciji ne čita te rute (jedini potrošači su `curl`/`HEALTHCHECK`, koji gledaju status kod);
(C) izuzeti rute iz globalnog throttle-a — healthcheck je 2 zahtjeva/min, pa nema potrebe da javna
ruta ostane bez ikakvog ograničenja.
**Posljedica:** `HEALTHCHECK` ostaje na `/api/health` (liveness) i ne mijenja se; readiness je
opciono dostupan monitoringu na `/api/ready` (INF-05: Postgres + MinIO + stanje migracija; putanja
je imenovana po planu §4.3, a ne kao podruta health-a). Stari `{process, postgres}` oblik nestaje —
nijedan klijent ga nije čitao (provjereno grep-om po `frontend/`, `mobile/`, `scripts/`, CI-ju).

### D-038 — Logovanje: JSON red na stdout + korelacioni ID, bez `pino` zavisnosti
**Datum:** 2026-11-03 · **Status:** na snazi
Do INF-04 log je bio Nest-ov tekstualni format i tri `console.error` mjesta; bez korelacionog ID-a
se greška iz Coolify loga nije mogla povezati sa zahtjevom, a nivo se nije mogao filtrirati.
Sada `JsonLogger` (implementira Nest `LoggerService`) piše **jedan JSON red** po zapisu
(`ts/level/context/msg/requestId/meta`), `requestLogMiddleware` daje svakom zahtjevu `x-request-id`
(validan klijentski se prihvata, inače `randomUUID`) i jednu `http_request` liniju
(`method/path/status/durationMs`), a `redact()` čisti tajne i PII iz meta. Nivo je `LOG_LEVEL`.
**Odbačeno:** (A) `pino` + `pino-http` — najzrelije rješenje, ali dvije nove zavisnosti i transport
konfiguracija za izlaz koji Coolify ionako čita sa stdout-a; P6 traži pisano obrazloženje, a
funkcionalno ništa ne dobijamo u v1 (rotaciju i drain radi Docker/Coolify). Ako zatreba
`traceId`/sampling ili više destinacija, `pino` je prvi izbor i tada se ova odluka mijenja;
(B) `nestjs-pino` — dodatno vuče `pino` i `pino-http` (tri zavisnosti); (C) samo `requestId` bez
strukture — Coolify bi i dalje dobijao neparsirane linije.
**Posljedica:** `console.log/debug` je zabranjen guardrail-om, a `console.error` je dozvoljen
(za slučajeve prije nego što logger postoji — koristi se u `main.ts` bootstrap-u). Nijedan log red
ne smije sadržavati tijelo zahtjeva, headere, query string, email/telefon ni tajne.


### D-039 — Redis aktiviran: throttle u Redisu, ACL po prefiksu, fail-open
**Datum:** 2026-11-03 · **Status:** na snazi

`REDIS_*` je do INF-07 bila mrtva konfiguracija (I7): ključevi su postojali u compose-u i env
šablonima, ali ih nijedan modul nije čitao, a throttle je bio memorijski po procesu — dva
backenda su imala dva nezavisna limita, a restart je resetovao brojač. Vlasnik je odlučio da se
Redis aktivira (`redis-core`, mreža `redis_net`, TLS sa postojećim CA, ACL korisnik čiju lozinku
on generiše i unosi kroz `redis-cli`/Coolify).

**Odluka:** Redis nosi **samo** throttle brojač (`<prefix>throttle:<throttler>:<key>`), preko
`ioredis` klijenta sa TLS-om i ACL korisnikom; sve ostalo (sessions, fajlovi, queue) ostaje van
Redisa. Storage je `FailoverThrottlerStorage`: `INCR` + `PEXPIRE NX` + `PTTL` u jednom `MULTI`
(prozor identičan memorijskom), a na bilo koju grešku se vraća na `ThrottlerStorageService`
(fail-open, jedno `warn` logovanje). `/api/ready` prikazuje `checks.redis`
(`disabled`/`ok`/`error`), ali Redis **ne obara** readiness — D-014 je od početka tražila da
aplikacija radi i bez njega.

**Prava:** ACL korisnik (`REDIS_USER`, default `gradix`) dobija `on` + `~<REDIS_PREFIX>*` +
`+ping +multi +exec +incr +pexpire +pttl +get +set +del +exists +ttl`, ništa iz `@admin`.
`reset` u `ACL SETUSER` liniji čini je idempotentnom; liniju ispisuje `scripts/ops/redis-acl.sh`,
a lozinku nikad ne dodirujemo (repo/CI/logovi).

**Nova zavisnost:** `ioredis@5` (P6 — pisano obrazloženje). Alternative: (A) `redis`
(node-redis v4) — jednako sposoban, ali TLS opcije i `MULTI` ergonomija su lošije za ovaj slučaj;
(B) ručni RESP klijent — ~200 linija koda za reconnect/TLS/parse, bez koristi; (C) nastaviti sa
memorijskim throttle-om — ne rješava I7 ni razliku između replika. Rizik: nova zavisnost u produkcijskoj
putanji; ublaženo time što je cijela upotreba iza `FailoverThrottlerStorage`-a i što Redis nije
obavezan (prazan `REDIS_HOST` = staro ponašanje).

**Posljedica:** deploy bez `REDIS_PASSWORD` uz zadat `REDIS_HOST` **ne starta** (validacija u
`env.ts`) — namjerno, jer bi tiho pao na `default` korisnika ili na neautentifikovanu vezu.

**Dopuna (2026-11-03):** ACL korisnik **nema `+info`** (nije mu potreban), pa je u klijentu
isključen ioredis ready check (`enableReadyCheck: false`) — bez toga svaki start loguje
„Skipping the ready check because INFO command fails“, što izgleda kao greška konfiguracije.
Spremnost provjerava `PING` u `/api/ready`.

**Dopuna (2026-11-03, vlasnik):** `redis-core` sluša **TLS na portu 6380**, obični 6379 je
isključen (`--tls-port 6380 --port 0`). Zato je default `REDIS_PORT=6380` u kodu, compose-u, env
šablonima i ACL skripti — pogrešan port bi dao `ECONNREFUSED` koji se lako pročita kao „Redis ne
radi“. Ako se port ikad promijeni, mijenja se samo `REDIS_PORT` (kod ne pretpostavlja 6380).

### D-040 — Paleta: kombinacija A + B („Gradix Green + teal signal“)
**Datum:** 2026-11-03 · **Status:** na snazi

P8 je tražila novu paletu i WCAG 2.2 AA, ali nije rekla kakav identitet. Pripremljena su dva
predloga — A „Gradix Green“ (duboka zelena + amber, topla podloga) i B „Slate / Teal“ (neutralni
slate + teal). Vlasnik je odabrao **kombinaciju**: zadržava se A podloga i brend zelena (topao,
prepoznatljiv „alat za teren“), teal iz B preuzima **akcenat** (informacija, isticanje), a amber iz
A postaje **zaseban `--warning`** token.

**Zašto amber nije ostao akcenat:** u aplikaciji gdje se amber koristi za HSE upozorenja, istekao
liječnički i registraciju vozila, „akcenat = amber“ bi značio da obična akcija izgleda kao
upozorenje. Zato su signali razdvojeni: zelena = brend/akcija, teal = informacija, amber =
upozorenje, crvena = greška/opasnost.

**Odluka:** tokeni su u `frontend/src/index.css` (`:root` + `.dark` + `--warning` u `@theme
inline`); vrijednosti i dokazi kontrasta u `docs/design/FE-01-palette-proposals.md` §5 (najmanji
par 5.02:1, prag AA je 4.5:1). Nijedna komponenta ne hardkodira boju (provjereno grep-om: nema
`bg-[#…]` ni `text-green-600` obrazaca), pa je povratak na A ili B izmjena ~20 vrijednosti.

**Posljedica:** `.dark` blok postoji ali je **inertan** (nigdje se ne dodaje klasa `dark`) — tamna
tema nije u obimu v1; tokeni su tu da je kasnije uključivanje jedno pravilo, a ne redizajn.

### D-041 — Shell i navigacija: grupisana navigacija, lazy rute, naslov i fokus
**Datum:** 2026-11-03 · **Status:** na snazi

Sidebar je bio ravna lista od 17 stavki bez grupa i ikona, sve stranice su bile u jednom JS
chunk-u (292.6 kB gzip, iznad budžeta D-015), `document.title` se nije mijenjao po ruti, nije bilo
„preskoči na sadržaj“ linka, a `<main>` nije primao fokus — pa je poslije navigacije fokus ostajao
na linku, a skrol na staroj poziciji.

**Odluka:**
1. **Jedan spisak navigacije** (`components/layout/navigation.ts`) sa grupama *Pregled · Posao ·
   Teren · Ured · Administracija*; vidljivost po permisijama je funkcija (`isNavItemVisible`), ne
   `if` u JSX-u; aktivna stavka je **najduži** prefiks putanje (`/fleet/map` ne boji i `/fleet`).
2. **Lazy rute** za `fleet/map` (Leaflet), javni sajt, obračun i ERP, sa `Suspense` fallbackom koji
   je isti statusni prikaz kao pri boot-u → početni JS **207.7 kB gzip** (budžet 250 kB).
3. **Shell a11y:** skip-link, `<main id="main" tabIndex={-1}>`, fokus na sadržaj poslije promjene
   rute, `<title>` = „<ekran> · Gradix“, reset skrola.

**Odbačeno:** (A) ikone bez teksta na skupim ekranima — štedi prostor, ali ruši razumijevanje i
a11y; (B) `react-router` `ScrollRestoration` — traži data-router API i mijenja bootstrap; običan
efekat radi isto za ovaj broj ruta; (C) ručni `manualChunks` u Vite config-u — dijeljenje po
biblioteci ne pomaže jer se Leaflet ionako koristi samo na jednoj ruti; lazy po ruti je preciznije.

**Posljedica:** novi ekran se dodaje u `NAV_SECTIONS` (jedno mjesto); zaboravljen unos znači da
ekran postoji ali se ne vidi u meniju — FE-05 dobija test koji provlači sve rute iz `appRoutes` i
traži da svaka ima stavku (ili je svjesno bez nje: `/change-password`).

### D-041 — Dva domena: frontend i API su odvojeni (obavezno)
**Datum:** 2026-11-03 · **Status:** na snazi

Vlasnik je odredio da deploy **mora** biti dvodomenski: frontend `https://gradix.ba101.top`,
API `https://api.gradix.ba101.top`. Do sada je nginx bio jednozemljisni (`connect-src 'self'`) i
apsolutni `VITE_API_URL` bio je blokiran u browseru, pa je login padao bez ikakve serverske greške.

**Odluka:** API se servira sa svog domena, a frontend ga dobija kroz tri usklađene postavke:
`VITE_API_URL` (build-time, pun URL API-ja), `CSP_API_ORIGIN` (nginx `connect-src` + `img-src`) i
`CORS_ORIGIN` na backendu (frontend origin, i za HTTP i za Socket.IO — oba koriste
`resolveCorsOrigin`).

**Zašto ne „samo dodaj domen u CSP“:** `connect-src` pokriva `fetch`, ali logo firme i fajlovi se
prikazuju kroz `<img src="https://api…/api/files">`, pa bi bez `img-src` slike tiho nestale; zato
`CSP_API_ORIGIN` ide u **oba** direktiva i guard (`check:image`) provjerava sva tri `add_header`
bloka (nginx ne nasljeđuje headere u blokovima koji imaju svoj `add_header`).

**Default ostaje prazan:** kod kuće/lokalno i u CI-ju API je na istom originu; vrijednosti se
postavljaju u Coolify env-u. `frontend/Dockerfile` ima `ENV CSP_API_ORIGIN=""` jer `envsubst`
preskače nedefinisane varijable — bez toga bi u nginx konfiguraciji ostao literal `${…}` i nginx bi
pao pri startu.

**Posljedica:** deploy checklista je u `docs/INFRASTRUCTURE.md` §10.1 (redoslijed: backend CORS →
frontend rebuild sa `VITE_API_URL` + `CSP_API_ORIGIN` → provjera u DevTools). CORS je sada stvarno
na kritičnoj putanji (u jednozemljisnom režimu nije bio), pa `CORS_ORIGIN` mora biti tačan origin
(bez trailing slash-a) — inače browser blokira odgovor iako server vraća `200`.

### D-042 — `trust proxy` = 1 (per-IP throttle iza Coolify proxy-ja)
**Datum:** 2026-11-03 · **Status:** na snazi

Kontejneri nemaju `ports:` (samo `expose`, D-020), pa sve zahtjeve prima Coolify/Traefik i prosljeđuje
ih na `backend:3000`. Express bez `trust proxy` tada vraća **IP proxy-ja** kao `req.ip`, a
`ThrottlerGuard` po njemu broji — posljedica je jedan globalni bucket (npr. `POST /auth/login`
5/min za **sve** korisnike, a globalni limit 120/min za cijelu firmu). Sa Redis storage-om (INF-07)
to bi važilo i između replika, pa problem postaje trajan, a ne „dok se kontejner ne restartuje“.

**Odluka:** `configureApp` postavlja `trust proxy` na `TRUST_PROXY` (default **1**). Vjerujemo samo
prvom hopu jer aplikacija nije direktno izložena (nema host portova); `TRUST_PROXY=0` je za lokalni
rad bez proxy-ja. Vrijednost se validira (0–10), a smeće pada na 1.

**Posljedica:** `req.ip` i `x-forwarded-for` lanac su tačni → throttle je per-IP, a logovi (koji IP
namjerno ne pišu) ostaju bez PII. Ako se ispred Coolify-ja ikad doda CDN, `TRUST_PROXY` se povećava
na broj hopova — inače bi klijentski IP bio CDN-ov.

### D-043 — Dashboard: tri pitanja po roli, bez novih podataka na backendu
**Datum:** 2026-11-03 · **Status:** na snazi

Dashboard je prije bio lista kartica bez stanja učitavanja/greške, bez prečica i bez ikakvog
reda po hitnosti; `dash.*` prijevodi su postojali (**`ops-bs.ts`/`ops-en.ts`**), pa su labele bile
prevedene — ali u `bs.ts`/`en.ts` ih nije bilo, što je zbunjivalo i pravilo rizik od tihog
pregazivanja pri spread-u resursa. Plan (§4.3) traži da se prvo zapiše informaciona arhitektura, pa
kod — zapis je `docs/design/FE-04-dashboard-ia.md`.

**Odluka:** dashboard odgovara na **tri pitanja** i to različito po roli (backend već bira kartice u
`dashboard-role.ts`): šta ističe, ko je na terenu, koliko trošimo. Zone su: zaglavlje (pozdrav +
datum), brze akcije (do 4, filtrirane **istim** pravilom kao sidebar), KPI traka (kartice → link na
ekran gdje se problem rješava), rokovi/dokumenti (sortirano po hitnosti, istekli ostaju vidljivi),
prisustvo (avatar-inicijali + broj).

**Zašto bez novih backend polja:** „moji zadaci sa rokovima“, trendovi i realtime brojači traže nova
agregiranja (i po jedan novi upit po ekranu). Dashboard time ne postaje mjesto gdje se podaci
„popravljaju“ — on pokazuje postojeće stanje i vodi dalje. Ako se pokaže potreba, to je BE segment.

**Posljedica:** hitnost (`daysLeft`) je izražena **bojem i tekstom** („isteklo prije 3 d“, „još 5 d“),
pa je čitljiva i bez razlikovanja boja (WCAG 1.4.1); greška je `role="alert"` sa dugmetom
„Pokušaj ponovo“ umjesto toasta koji nestane; skeleton ima `aria-busy`. `dash.*` ključevi su
**konsolidovani na jedno mjesto** (`ops-bs.ts`/`ops-en.ts`, jer `index.ts` spreaduje te fajlove
poslije `bs`/`en`, pa bi duplikat bio mrtav kod), a `dashboard.*` ključevi su dodati u **bs** i **en**.
FE-05 je dodao test koji padne ako se `dash` sekcija vrati u `bs.ts`/`en.ts`.

### D-044 — Frontend testovi: Vitest + Testing Library, coverage ratchet po segmentu
**Datum:** 2026-11-03 · **Status:** na snazi

Do FE-05 frontend **nije imao** unit/component testove — samo Playwright u CI-ju. To znači da se
greška u logici (npr. pogrešno filtriranje prečica, prazna vrijednost prikazana kao `0`) vidjela tek
u browseru i to samo ako je E2E pokrije.

**Odluka:** `vitest` + `@testing-library/react` + `user-event` + `jest-dom` + `jsdom` + `@vitest/coverage-v8`
(samo `devDependencies`; produkcijski bundle se ne mijenja). Razlog za **Vitest** a ne Jest: projekat
je ESM + Vite, pa Vitest koristi isti alias `@`, isti TS pipeline i isti `transform` bez druge
konfiguracije; Jest bi tražio `ts-jest`/Babel i ručno mapiranje modula.

**Coverage ratchet (P5):** `coverage.include` nabraja **samo** module koje su segmenti stvarno
pokrili (`dash.ts`, `payroll-access.ts`, `navigation.ts`, `dashboard-page.tsx`) sa pragovima
85/85/85/75. Globalni procenat preko 500+ fajlova koje segmenti još nisu obradili ne bi ništa
garantovao; svaki sljedeći FE segment dodaje svoj fajl u listu, prag ostaje visok. Playwright
(`e2e/`) ostaje za tokove kroz pravi backend — Vitest ga **ne** pokupi.

**Posljedica:** CI job `frontend` sada ima korak `npm run test:cov` (i artefakt `frontend-coverage`);
`tsconfig.app.json` uključuje `test/` (setup fajl donosi jest-dom matchere i tipove).

### D-045 — Auth ekrani: jedan okvir, greška uz polje, pošten `/reset`
**Datum:** 2026-11-03 · **Status:** na snazi

`login` je poslije FE-03 imao `h1`, ali `forgot`, `reset` i `change-password` su naslov renderovali
kao `div` (`CardTitle`) — ekran bez naslova nije čitljiv čitaču ekrana (WCAG 1.3.1/2.4.6). Uz to:
greške validacije se **nisu prikazivale** (`Field` prima `error`, ali ga `forgot`/`change-password`
nisu prosljeđivali), `min(10)` je bacao engleski Zod tekst, a greške servera su išle u toast koji
nestane.

**Odluka:** svi auth ekrani koriste **jedan okvir** (`AuthCard`) koji garantuje jedno `h1` i isti
raspored. Pravila: poruka o grešci ide **uz polje** (`role="alert"`, `aria-invalid`,
`aria-describedby` preko `Field`-a), greška servera (pogrešna lozinka, **429 zbog previše pokušaja**,
mreža) ostaje na ekranu sa dugmetom/stanjem koje korisnik vidi, a uspjeh je **stanje ekrana**, ne
toast.

**`/reset` ostaje pošten:** backend vraća `501 AUTH_RESET_NOT_AVAILABLE` (nema reset tokena ni
dostave emaila). Ekran zato **ne nudi** formu koja bi glumila uspjeh, nego kaže šta korisnik sada
može (admin resetuje lozinku u `/users`) — lažni „poslano“ bio bi gori od poruke „nije dostupno“.

**Posljedica:** novo `PasswordInput` polje sa prekidačem vidljivosti (`aria-pressed` + tekstualno
ime) jer se duge lozinke na telefonu ne mogu unijeti bez greške; `autoComplete`
`current-password`/`new-password` za menadžere lozinki; `change-password` dobija svoje dugme
„Promijeni lozinku“ umjesto generičkog „Sačuvaj“.

### D-046 — Enumi se prevode na jednom mjestu, a stanja lista su obavezna
**Datum:** 2026-11-03 · **Status:** na snazi

Liste projekata i zadataka prikazivale su **sirove enume** iz baze: `IN_PROGRESS`, `PENDING`,
`URGENT` — interfejs je bio polovično preveden, a badge nije nosio značenje (sve isto sivo). Uz to
nije bilo stanja učitavanja (prazna tabela izgleda kao „nema podataka“), greške (pad je bio tih),
prazne liste (prazna tabela bez poruke) ni paginacije (dugme „Dalje“ je uvijek bilo aktivno).

**Odluka:** `src/lib/labels.ts` je **jedino** mjesto koje zna kako se enum zove korisniku i koji ton
badge-a nosi (`projectStatus`, `taskStatus`, `taskPriority`, `assignmentRole`, `formatDuration`).
Vraća `{ labelKey, tone, known }`; nepoznat enum ne puca — prikaže se sirova vrijednost (`defaultValue`),
ali `known: false` ostaje signal za test. Liste imaju **obavezna** stanja: skeleton (`aria-busy`),
trajna greška sa „Pokušaj ponovo“, prazno stanje („nema“ vs. „nema rezultata za upit“) i paginaciju
koja se prikazuje **samo** kad ima više strana.

**Zašto ne enum → tekst u svakoj komponenti:** isti enumi se pojavljuju i u floti, logistici i
obračunu (FE-09/FE-12); pet kopija bi se razišlo pri prvom novom statusu.

**Posljedica:** test `labels.spec.ts` poredi mape sa **Prisma šemom** (`KNOWN_STATUSES`), pa novi
status u bazi obara test dok se ne prevede. Tabele dobile `caption` (ukupan broj / prazno stanje) i
označena polja pretrage; detalj projekta koristi `dt`/`dd` umjesto `div`-ova sa dvotačkom u tekstu.

### D-047 — Flota i logistika koriste isti ugovor iz D-046; mapa dobija tekstualni ekvivalent
**Datum:** 2026-11-03 · **Status:** na snazi

Ekrani flote i logistike imali su iste bolesti kao projekti/zadaci prije FE-08, plus dvije svoje:
mapa flote je bila **nepristupačna** (SVG platno bez ikakvog tekstualnog ekvivalenta), a `select` za
dodjelu mašine nije imao ime (čitač ekrana je čitao „kombi bez labele“). Uz to su sate rada prikazivali
kao `Decimal` string (`1234.500`), balončić na mapi je miješao preveden naziv sa sirovim `PHONE`/`IOT`,
a jedinica materijala je bila `M3`.

**Odluka:**
1. `lib/labels.ts` (D-046) proširen je na flotu i logistiku: `machineStatus`, `machineType`,
   `gpsSource`, `materialUnit`, `tripStatus` + `tripStatusOf` (tura nije status u bazi — izvodi se iz
   `unloadedAt`). Ništa se ne prevodi u komponentama.
2. `formatHours()` je u istom modulu: `Decimal(12,3)` → `1.234,5 h`, ručno formatirano (hiljade
   tačkom, decimale zarezom) da rezultat ne zavisi od ICU podataka u CI image-u.
3. Svaka tabela ima `caption`, skeleton (`aria-busy`), trajnu grešku sa „Pokušaj ponovo“ i prazno
   stanje sa uputom (D-046).
4. Mapa **mora** imati tekstualni ekvivalent: lista mašina sa GPS pozicijom (naziv · status · vrijeme)
   ispod platna, a platno je `aria-hidden` kad nema pinova. Boje pinova su iz palete C (D-040).
5. Polja za dodavanje materijala/deponije imaju `<label>` (placeholder nije labela, WCAG 3.3.2), a
   jedinica se bira iz šeme (`MaterialUnit`) umjesto da se hardkodira `T`.

**Odbačeno:** (a) `toLocaleString('bs-BA')` za sate — zavisi od ICU-a, test bi bio okruženjski;
(b) „samo CSS“ rješenje za pristupačnost mape — platno nema šta izložiti čitaču; (c) zadržati stare
boje pinova — to su boje odbačene palate (D-040).

### D-048 — HSE i rokovi dokumenata imaju prevod i stanje; dnevnik je čitljiv i bez vida
**Datum:** 2026-11-03 · **Status:** na snazi

Ekrani dnevnika, HSE-a i dokumenata imali su iste propuste kao prethodni segmenti (sirovi enumi,
nema stanja liste), plus tri svoja: (1) **HSE akcije su bile vidljive svima** koji vide listu, iako
mijenjaju zapis; (2) ekran dokumenata je pisao „Upozorenja 30 / 15 / 5 dana“, a uz dokument je stajao
samo datum — korisnik je morao sam računati da li je istekao; (3) u dnevniku su dani bili **dugmad
koja ništa ne rade** i zvala su se „01“, „02“…, filter projekta se nije mogao poništiti, a sheet
konflikta je na nepotpune detalje **tiho** odustajao.

**Odluka:**
1. `lib/labels.ts` (D-046/D-047) proširen: `hseSeverity` (HIGH crveno), `hseStatus` (OPEN primarno,
   ACK/ZATVORENO neutralno) i `documentState`/`daysUntil` sa pragovima **30 / 15 / 5** dana (D-013).
2. Akcije koje mijenjaju zapis prikazuju se **samo** uz odgovarajuće pravo (`hse.write`); prije su
   „Potvrdi“/„Zatvori“ stajali i onima koji ih ne smiju izvršiti.
3. Rok dokumenta se prikazuje kao stanje („Istekao“, „Ističe“, „Vrijedi“, „Bez roka“) **plus**
   relativni pomak („ističe za 6 d“), uz datum.
4. F-FE-06-01 (frontend dio): `/hse` više nije vezan isključivo za `hse.read` — stavka navigacije i
   ruta traže **bilo koje** od `hse.read`/`hse.write`. Backend (D-033) već daje prijavljivaču samo
   njegove prijave i `404` za tuđe, pa je ekran siguran i bez `hse.read`.
5. Kalendar dnevnika: prazne ćelije do prvog dana mjeseca (ponedjeljak kao prva kolona), dan je
   **ćelija sa punim imenom** („2026-11-03 — ima unos“/„— nema unosa“), opcija „Svi projekti“ vraća
   filter na cijelu firmu. Sheet konflikta pokazuje datum i **onemogući** odluku uz objašnjenje kad
   detalji nemaju projekat/datum.
6. Radix `Select` u jsdom-u traži `hasPointerCapture`/`scrollIntoView`; stubovi su dodati u
   `test/setup.ts` da se meni može testirati (nema uticaja na produkcijski kod).

**Odbačeno:** (a) dati `hse.read` svim radnicima — otvara sve HSE zapise firme (D-033 opcija C);
(b) boja kao jedini nosilac značenja roka — uz nju ide i tekst; (c) „popravi“ dan klikom na
`setParams({ projectId })` (isto stanje) — prikaz je sada informativan, a unos ide kroz tab projekta.

### D-049 — Ured (tenderi, servis, izvještaji): prevod kolona, naziv mašine i siguran export
**Datum:** 2026-11-03 · **Status:** na snazi

Ekrani tendera, servisa i izvještaja imali su iste propuste kao prethodni segmenti (sirovi enumi, nema
stanja liste), plus tri svoja: (1) servisni nalozi su umjesto naziva mašine prikazivali **`machineId`
(CUID)**; (2) izvještaji su imali zaglavlja kolona kao **sirove ključeve sa backenda**
(`plannedBudget`, `avgCompletedSpend`); (3) export je brisao `objectURL` odmah poslije `click()`, pa se
preuzimanje u nekim browserima otkazivalo. Uz to su iznosi bili `12000.00`, a dugme „Označi WON“.

**Odluka:**
1. `lib/labels.ts` proširen: `tenderStatus` (LOST crveno, WON subtilno), `serviceStatus` (CANCELLED
   crveno) i `formatAmount` (hiljade tačkom, dvije decimale zarezom, „—“ za prazno).
2. Nazivi mašina: lista servisa učitava `listMachines` i prikazuje **ime** mašine; CUID ostaje samo
   kao fallback kad mašina više ne postoji.
3. Zaglavlja izvještaja se prevode kroz `reports.columns.<ključ>` sa `defaultValue` — nepoznat ključ
   iz backenda se vidi **sirov** (isti ugovor kao D-046), pa se primijeti kad se doda nova kolona.
4. Izvještaji dobili period (`Od`/`Do`), `caption` sa brojem redova, stanja i onemogućen export kad
   nema redova; export briše `objectURL` sa odgodom i link se dodaje u DOM (Safari/Firefox).
5. Tenderi: broj po fazi, prazna faza sa porukom, `role="region"` po fazi, prevedena dugmad
   („Označi kao dobijen“), labele i poruka za obavezna polja.

**Odbačeno:** (a) mijenjati backend da vraća nazive kolona — ugovor API-ja se ne dira; (b) skrivati
nepoznate kolone — tada bi tiho nestao podatak; (c) `toLocaleString` za iznose — okruženjski zavisno.

### D-050 — Throttle limiti su konfigurabilni; u E2E poslu se podižu, defaulti ostaju isti
**Datum:** 2026-11-03 · **Status:** na snazi

Run **41780990334** je pao u koraku „Playwright testovi“, a anotacije su sadržavale samo rep liste —
nije se vidjelo koji test pada. Novi korak u CI-ju (samo na pad) pretvara svaki pad u `::error::`
anotaciju i ispisuje sekciju „Failed Tests“. Sljedeći run (**41781490823**) pokazao je tri pada
(`lista projekata`, `flota`, `HSE`) sa „element(s) not found“ i **retry koji traje 0 ms** — to nije
spor API, nego odbijena prijava/zahtjev: backend drži **120 zahtjeva/min globalno** i **5 prijava/min**,
a `retries: 1` ponovo izvršava `beforeAll`, tj. **novu prijavu**, pa četvrta prijava u minuti vraća 429
i ekran ostane bez podataka.

**Odluka:** limiti ostaju **isti po defaultu** (120/min globalno, 5/min prijava, 20/min refresh), ali se
čitaju iz okruženja: `THROTTLE_LIMIT`/`THROTTLE_TTL_MS`, `AUTH_LOGIN_LIMIT`, `AUTH_REFRESH_LIMIT`.
CI job `web-e2e` postavlja `1000 / 30 / 200` — testovi tako ne troše produkcijsku kvotu, a produkcija
nema nijednu novu varijablu i ponaša se identično. Uz to E2E dobija pomoćnik `expectNoLoadError(page)`
koji pad pretvara u poruku „Ekran prikazuje grešku umjesto podataka: …“ (vidi se i 429 tekst).

**Odbačeno:** (a) isključiti throttle u testovima — testirao bi se drugi sistem od produkcijskog;
(b) `retries: 0` — pravi flake bi maskirao pravi pad; (c) povećati limite svuda — slabi zaštitu.

### D-051 — Novčani ekrani: jedinice i enumi se prevode u UI sloju, upiti po tabu
**Datum:** 2026-11-04 · **Status:** na snazi

FE-12 je pregledao obračun sati (`/payroll`) i ERP-lite (`/erp`). Nalazi su bili istog oblika kao u
D-046/D-049, ali sa posljedicom na **razumijevanje brojeva**: trajanje se prikazivalo kao `480`
(minute), iznos kao `120.000000`, `REJECTED` je imao isti ton kao `PENDING`, a u ERP-u su kategorija
troška i izvor (`MATERIAL`, `PAYROLL`) i tipovi partnera/skladišta išli **sirovi** u UI; dugme za
knjiženje lagera je nosilo tekst **„Količina“**, a polja su imala samo `placeholder` (bez labele).

**Odluka:**

1. `lib/labels.ts` ostaje **jedini** izvor prevoda enuma (D-046). Dodate su grupe `payroll`,
   `costCategory`, `costSource`, `partnerType`, `warehouseType` sa selektorima
   (`payrollStatus`, `costCategory`, `costSource`, `partnerType`, `warehouseType`) i `known` zaštitom:
   nepoznata vrijednost se prikazuje **sirova**, ne prazna.
2. Vremenske jedinice: kolone i zbroj obračuna prikazuju **sate** („8 h“, „8 h 30 min“), a minute
   ostaju u detalju stavke (`duration` + `minutesUnit`) — nijedan podatak se ne gubi.
3. Iznosi idu isključivo kroz `formatAmount` (`12000.00` → `12.000,00`); `toLocaleString` se ne
   koristi (okruženjski zavisno).
4. Ton statusa je dio značenja: `APPROVED` → uspjeh, `PENDING` → upozorenje, `REJECTED` → greška.
5. Skriveni tabovi **ne šalju** zahtjeve: `useQuery({ enabled: tenantReady && tab === '…' })`. Pad
   API-ja je uvijek vidljiv (`role="alert"` + „Pokušaj ponovo“ koji poništava sve upite ekrana), a
   prazna lista uvijek ima rečenicu šta nedostaje (npr. „Nema skladišta — dodajte prvo skladište.“).
6. Akcija se imenuje po **posljedici** („Knjiži“, „Novi trošak“), a ne po polju („Količina“); svako
   polje ima `Field` labelu (`htmlFor` + `id`).
7. Export nosi ime sa periodom (`obracun-YYYY-MM.xlsx`), link se dodaje u DOM i `objectURL` se gasi
   sa odgodom (isti obrazac kao D-049).

**Posljedica na prava:** zbir obračuna se učitava uz `canSeePayroll` (supervizor i PM vide sate), ali
odobravanje/odbijanje i dalje traži `canDecidePayroll`, a export `canExportPayroll` — UI ne proširuje
prava, samo prestaje da krije podatke koje korisnik smije vidjeti.

**Odbačeno:** (a) mijenjati backend da vraća prevedene nazive — API ugovor se ne dira u FE segmentu;
(b) `toLocaleString` za sate i iznose — okruženjski zavisno; (c) sakriti nepoznat enum — podatak bi
tiho nestao; (d) učitavati sve tabove unaprijed — troši kvotu i skriva pravi trošak ekrana.

### D-052 — Admin ekrani: forma samo nad učitanim podacima, status naloga i prevod postavki po ključu
**Datum:** 2026-11-04 · **Status:** na snazi

FE-13 je pregledao administraciju (postavke, korisnici, firme, prebacivač firme). Najopasniji nalaz
nije bio kozmetički: ekran postavki je prikazivao **formu firme i kad `GET` padne**. Polja su bila
prazna, a „Sačuvaj“ je slao prazne stringove — jedan klik je mogao **pregaziti naziv, JIB i adresu**
firme. Uz to: tabela korisnika **nije imala status**, pa se deaktiviran korisnik nije razlikovao od
aktivnog, a reaktivacije nije bilo nigdje iako API prima `isActive: true` (deaktivacija je bila
trajna iz UI-a); reset lozinke je išao **jednim klikom**; kolona statusa firmi imala je prazno
zaglavlje; registar postavki je uz polje stavljao goli tehnički ključ i **engleski opis** u bosanski
interfejs, a prazno numeričko polje se pretvaralo u `0`.

**Odluka:**

1. **Destruktivna forma se prikazuje samo nad učitanim podacima.** Dok `useQuery` nije `isSuccess`,
   nema forme (skeleton), a pad je vidljiv (`role="alert"` + „Pokušaj ponovo“). Time je nemoguće
   poslati prazna polja kao izmjenu. Isto važi za registar postavki.
2. **Status naloga je prve klase u UI-u.** `accountStatus(isActive)` (labels.ts) daje tekst i ton;
   status je svoja kolona sa zaglavljem i u korisnicima i u firmama. Uz deaktivaciju postoji
   **reaktivacija** (`isActive: true`), pa deaktivacija nije trajna iz UI-a.
3. **Opasne akcije traže potvrdu.** Reset lozinke i deaktivacija (korisnik/firma) idu kroz
   `AlertDialog` sa imenom aktera; ishod je potvrđen toastom.
4. **Postavke se prevode po ključu.** `SETTINGS_KEYS` (`lib/settings-keys.ts`) + i18n
   `settings.keys.<ključ>.label/.description`; opis sa backenda ostaje **rezerva** kad prijevoda nema
   (kao `defaultValue` u D-046/D-049). Brojevi se drže kao tekst i validiraju pri čuvanju — prazno
   polje se **ne** upisuje (prije: `Number('')` = 0), a „Sačuvaj“ je onemogućen dok nema izmjena.
5. **Validacija obrazaca ne zavisi od odmontiranih polja.** U `CompanySheet` se provjera radi u
   `handleSubmit`-u (`form.setError`), jer je react-hook-form zadržavao `required` pravila polja koja
   više nisu u DOM-u (uređivanje firme se nije moglo sačuvati). Isto svojstvo rešeno je i u
   `UserSheet` (`shouldUnregister`).
6. **Kartice postavki su imenovani `region`-i**, pa čitač ekrana (i test) razlikuje blokove; polje
   fajla (logo) ima `htmlFor`/`id`, a `Switch` u registru dobija `id` preko `Field`-a.
7. **Kopiranje privremene lozinke ne smije pući**: bez `navigator.clipboard` tekst se označi, a
   korisnik dobija poruku šta da uradi.

**Odbačeno:** (a) skrivati ceo ekran postavki bez `settings.write` — čitanje je dozvoljeno i korisno;
(b) „mekana“ deaktivacija bez reaktivacije — nepovratna radnja u UI-u bez razloga; (c) validacija
kroz HTML `required` — poruke nisu na bosanskom i ne vide se uz polje; (d) prevod tehničkih ključeva
na backendu — API ugovor se ne dira u FE segmentu.

---

## Zamijenjene / povučene odluke

| Referenca | Šta je tvrdila | Zašto više ne važi |
|---|---|---|
| `.cursor/rules/00_project.mdc` (penzionisano) | „Banned: PostgreSQL“, MySQL 8 | D-001 |
| `PLAN_FREEZE.md` (penzionisano) | cross-cutting pravila | prenesena u `BACKEND.md` (važeća), MySQL dio povučen |
| `ANALIZA_I_PLAN_PRODUKCIJA.md` (penzionisano) | stanje bez Docker/Coolify | D-020…D-025 |
