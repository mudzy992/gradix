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

---

## Zamijenjene / povučene odluke

| Referenca | Šta je tvrdila | Zašto više ne važi |
|---|---|---|
| `.cursor/rules/00_project.mdc` (penzionisano) | „Banned: PostgreSQL“, MySQL 8 | D-001 |
| `PLAN_FREEZE.md` (penzionisano) | cross-cutting pravila | prenesena u `BACKEND.md` (važeća), MySQL dio povučen |
| `ANALIZA_I_PLAN_PRODUKCIJA.md` (penzionisano) | stanje bez Docker/Coolify | D-020…D-025 |
