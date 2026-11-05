# INF-07 — Redis: aktiviran (throttle storage, ACL, fail-open)

| | |
|---|---|
| Sloj | `INF` |
| Obim | `proces` (kod: `backend/src/common/redis/`, `scripts/ops/redis-acl.sh`) |
| Ispravka | 2026-11-03: vlasnik javio da Redis TLS sluša na **`6380`** (ne 6379) — defaulti (`env.ts`, `redis.service.ts`, compose, env šabloni, ACL skripta, docs §5.4/§11) usklađeni na 6380 |
| Status | `done` |
| Potvrđeni puni CI | [42104618087](https://github.com/mudzy992/gradix/actions/runs/42104618087) — success |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-07`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Da `REDIS_*` konfiguracija prestane biti mrtva (dug I7): Redis (`redis-core`, mreža `redis_net`,
TLS sa postojećim CA) postaje **stvarni** throttle storage, sa ACL korisnikom koji ima pravo samo
na ključeve pod `REDIS_PREFIX`. Provjereno: šta aplikacija piše u Redis, koja prava korisnik ima,
šta se dešava kad Redis nije konfigurisan i kad padne, i kako vlasnik infrastrukture dodaje
korisnika (lozinku generiše on).

**Ne provjerava:** Redis server sam (Coolify/host — eksterni servis, P1 logika za bazu vrijedi i
ovdje), queue/worker infrastrukturu (van obima v1), cache poslovnih podataka (nema ga — samo
brojač), migraciju postojećih sesija u Redis (sesije nisu u Redisu i neće biti).

## 2. Ulaz

**Zavisnosti:** INF-01 (env šabloni, compose mreža `redis_net`, CA mount), BE-01 (`env.ts`
validacija, `ThrottlerModule`), BE-18/INF-05 (`/api/ready`), CI-01 (workflow pravila).

**Fajlovi:** `backend/src/common/redis/{redis.service.ts,redis.module.ts,failover-throttler.storage.ts}`
+ 2 spec fajla, `scripts/ops/redis-acl.sh`, `backend/src/app.module.ts`, `backend/src/config/env.ts`,
`backend/src/modules/health/health.service.ts`, `docker-compose.yml`, `.env.example`, `.env.coolify`.

**Pretpostavke:** Redis radi na `redis-core:6380` (TLS port) u eksternoj mreži `redis_net`, sa TLS-om i CA
fajlom koji Coolify već mapira (`/etc/ssl/redis/redis-ca.crt`); vlasnik generiše lozinku i dodaje
ACL korisnika kroz `redis-cli`, pa backend nikad ne poznaje administratorske kredencijale.

**Odluka vlasnika (2026-11-03):** „Redis aktivirati; ACL za usera ću dodati lično kroz `redis-cli`
(šifru generišem ja); host `redis-core`, mreža `redis_net`, prefix također; certifikat je već
definisan.“

## 3. Kriteriji završetka (DoD)

- [x] Redis je stvarno u upotrebi (throttle brojač), a ne samo konfiguracija
- [x] Prava su minimalna: `~<prefix>*` + tačno potrebne komande, bez `@admin`
- [x] Bez `REDIS_HOST` ponašanje je **identično** starom (memorijski throttle); pad Redisa ne daje `500`
- [x] `/api/ready` prikazuje `checks.redis`, ali Redis ne obara readiness
- [x] Lozinka ne postoji u repou, logovima ni CI-ju; ACL liniju generiše skripta
- [x] Svi fajlovi segmenta pregledani; status u matrici ≥ `pregledano`
- [x] `npx jest` zelen; `check:all` zelen; `docs/` ažuriran u istom commitu
- [x] `AUDIT/STATE.md` ažuriran; commit + push + **zelen CI** (run u §10)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (`fajl:linija`) | Ocjena |
|---|---|---|---|
| 1 | `REDIS_HOST/PORT/PASSWORD/PREFIX/TLS_CA_FILE` su bili u compose-u i env šablonima, a nijedan modul ih nije čitao | `docker-compose.yml:94-100`, `docs/INFRASTRUCTURE.md:127-131` (prije) | ❌ F‑01 |
| 2 | Throttle je bio isključivo memorijski (`ThrottlerModule.forRoot`, default storage) ⇒ dva procesa = dva limita, restart resetuje brojač | `backend/src/app.module.ts:32-34` (prije) | ❌ F‑02 |
| 3 | `redis_net` je bio priključen, CA mapiran, ali veza nikad uspostavljena | `docker-compose.yml:133-135` | ⚠️ F‑01 |
| 4 | Nije postojala ACL dokumentacija ni skripta — korisnik bi se dodavao „po sjećanju“ (najvjerovatnije `+@all`) | — | ⚠️ F‑03 |
| 5 | Readiness nije znao za Redis, pa pad Redisa (da je korišten) ne bi bio vidljiv monitoringu | `backend/src/modules/health/health.service.ts` (prije) | ⚠️ F‑04 |
| 6 | Nijedna zavisnost za Redis nije bila instalirana (`ioredis`/`redis` nema u `package.json`) | `backend/package.json` (prije) | ✅ činjenica |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-07-01 | **Mrtva konfiguracija (I7)**: pet `REDIS_*` varijabli, eksterna mreža i CA mount bez ijednog čitaoca u kodu — deploy je izgledao „spreman za Redis“, a rate limit je bio po procesu | visoko | `docs/INFRASTRUCTURE.md:127-131` (prije) | riješeno: `RedisService` + `FailoverThrottlerStorage`; `REDIS_*` se validiraju u `env.ts` i koriste u throttle-u (D‑039) |
| F-INF-07-02 | **Rate limit nije važio između replika** i resetovao se restartom — kod blue/green deploya i dva kontejnera limit je bio duplo veći | visoko | `backend/src/app.module.ts` (prije) | riješeno: brojač u Redisu (`INCR`+`PEXPIRE NX`+`PTTL` u `MULTI`) pod `<prefix>throttle:<throttler>:<key>` |
| F-INF-07-03 | **ACL bi vjerovatno bio preširok**: bez dokumentovanog spiska komandi najlakše je dati `+@all` korisniku koji ne smije imati `FLUSHALL`/`CONFIG` | srednje | — | riješeno: `scripts/ops/redis-acl.sh` ispisuje `ACL SETUSER <user> reset on ><LOZINKA> ~<prefix>* +ping +multi +exec +incr +pexpire +pttl +get +set +del +exists +ttl`; dokumentovano u `INFRASTRUCTURE.md` §11.2 |
| F-INF-07-04 | **Redis ne smije postati nova tačka pada**: da je storage bio „tvrd“, pad Redisa bi značio `500` na svakom zahtjevu | visoko | — | riješeno: `FailoverThrottlerStorage` na svaku grešku koristi `ThrottlerStorageService` (jedno `warn` logovanje), `enableOfflineQueue: false` da zahtjev ne čeka, `maxRetriesPerRequest: 1` |
| F-INF-07-05 | **Readiness bi lažno padao** da je Redis ušao u `failed` skup — Redis nije zavisnost bez koje API ne radi | srednje | `backend/src/modules/health/health.service.ts` | riješeno: `checks.redis` je informativan (`disabled`/`ok`/`error`), `status: 'ok'` ostaje `200`; test to tvrdi |
| F-INF-07-06 | **Start aplikacije ne smije zavisiti od Redisa**: `lazyConnect` + `void client.connect().catch()` — ako Redis još nije spreman, app starta, throttle je privremeno memorijski | srednje | `backend/src/common/redis/redis.service.ts` | riješeno |
| F-INF-07-07 | **Nova zavisnost** (`ioredis@5`) u produkcijskoj putanji — P6 traži pisano obrazloženje | srednje | `backend/package.json` | prihvaćeno: D‑039 (alternative `redis`/node-redis i ručni RESP klijent odbačene; upotreba je iza fail-open wrappera) |
| F-INF-07-08 | **TLS bez CA** bi tiho degradirao na nešifrovanu vezu ako fajl nedostaje — u produkciji to mora biti vidljivo | nisko | `redis.service.ts` (warn grana) | riješeno: `warn` log u startu + CA putanja u env katalogu; `REDIS_TLS_CA_FILE` default je putanja iz compose mount-a |
| F-INF-07-10 | **ioredis ready check traži `INFO`** koji ACL korisnik namjerno nema → pri svakom startu log „Skipping the ready check because INFO command fails“ (izgleda kao greška konfiguracije) | nisko | produkcijski log vlasnika, 2026-11-03 | riješeno: `enableReadyCheck: false` (spremnost = naš `PING` u `/api/ready`); alternativa `+info` odbačena jer korisniku ne treba nijedna admin komanda |
| F-INF-07-09 | **Host bez lozinke**: da validacija nije uvela pravilo, klijent bi se tiho autentifikovao kao `default` korisnik | nisko | `backend/src/config/env.spec.ts` | riješeno: `REDIS_PASSWORD` je obavezan kad je `REDIS_HOST` zadat (greška pri startu, ne warning) |

## 6. Popravke

1. **`backend/src/common/redis/redis.service.ts`** (novo) — jedan `ioredis` klijent: TLS (`ca` iz
   `REDIS_TLS_CA_FILE` + `servername`), ACL (`REDIS_USER`, default `gradix`), `lazyConnect`,
   `enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, `connectTimeout: 2 s`, reconnect sa
   backoff-om u pozadini; `ping()` za readiness (nikad ne baca) i `quit()` u
   `onApplicationShutdown`.
2. **`backend/src/common/redis/failover-throttler.storage.ts`** (novo) — `ThrottlerStorage` koji
   broji u Redisu (`INCR`, `PEXPIRE … NX`, `PTTL` u jednom `MULTI`) i mapira odgovor u
   `totalHits/timeToExpire/isBlocked/timeToBlockExpire`; na grešku (ili bez klijenta) delegira
   memorijskom storage-u uz jedno `warn` logovanje.
3. **`backend/src/common/redis/redis.module.ts`** (novo) — `@Global()` modul, isti klijent za
   throttle i readiness.
4. **`backend/src/app.module.ts`** — `ThrottlerModule.forRootAsync` sa `FailoverThrottlerStorage`
   (limit i TTL nepromijenjeni: 120 / 60 s).
5. **`backend/src/config/env.ts`** — validacija `REDIS_*` grupe: prazan `REDIS_HOST` = isključeno;
   inače `REDIS_PASSWORD` obavezan, `REDIS_USER` default `gradix`, `REDIS_PREFIX` default `gradix:`,
   `REDIS_TLS_CA_FILE` default `/etc/ssl/redis/redis-ca.crt`, `REDIS_PORT` 1–65535.
6. **`backend/src/modules/health/health.service.ts`** — `checks.redis` (`disabled`/`ok`/`error`),
   **van** `failed` skupa.
7. **`scripts/ops/redis-acl.sh`** (novo) — ispisuje idempotentnu `ACL SETUSER` liniju + provjere
   (`ACL GETUSER`, `ACL SAVE`, `redis-cli … PING`); lozinku ne dodiruje.
8. **`docker-compose.yml` / `.env.example` / `.env.coolify`** — `REDIS_USER` dodat, prefiks
   `gradix:queue:` → `gradix:` (više nije queue, nego throttle), komentari opisuju fail-open i to
   da je lozinka obavezna uz host.

**Odbačene alternative:** (A) `redis` (node-redis v4) umjesto `ioredis` — jednako sposoban, ali TLS
opcije i `MULTI` ergonomija su lošije za ovaj slučaj; (B) ručni RESP klijent — ~200 linija koda za
reconnect/TLS/parse bez ikakve koristi; (C) „tvrd“ storage (greška ⇒ `500`) — pretvara opcionu
zavisnost u tačku pada, suprotno D‑014; (D) Redis kao cache poslovnih podataka — nema dokazanog
problema u v1, a uvodi invalidaciju i „hladni“ podatke bez vlasnika.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Unit: Redis service | `npx jest src/common/redis` | ✅ 4 testa — `disabled` bez hosta, ACL/TLS opcije klijenta, `ping` error bez bacanja, `quit` pri gašenju |
| Unit: throttle storage | `npx jest src/common/redis` | ✅ 4 testa — fallback bez Redisa, brojanje/blokada preko limita + prefiks ključa, pad Redisa → memorija, `PTTL = -1` → pun TTL |
| Unit: readiness | `npx jest src/modules/health` | ✅ uključujući `redis: disabled` (status `ok`) i `redis: error` (**i dalje `ok`**) |
| Unit: env | `npx jest src/config/env.spec.ts` | ✅ grupa isključena bez hosta, uključena sa hostom, host bez lozinke = greška, `REDIS_PORT` van opsega = greška |
| Sintaksa ACL skripte | `bash -n scripts/ops/redis-acl.sh` + pokretanje | ✅ ispisuje liniju sa `<LOZINKA>` placeholderom (nema tajni) |
| Guardovi | `node scripts/standards/check-all.mjs` | ✅ (`check:secrets` ne vidi lozinku — u primjerima je placeholder) |
| CI | `gh run watch` | ✅ u §10 |

## 8. Rizici i rollback

- **Rizik (nova zavisnost):** `ioredis` u produkcijskoj putanji — ublaženo: cijela upotreba je iza
  `FailoverThrottlerStorage`-a, a bez `REDIS_HOST` klijent se **ne pravi**.
- **Rizik (CPU/veza):** jedan klijent po procesu, reconnect sa backoff-om; `enableOfflineQueue:
  false` znači da zahtjev ne čeka mrtav Redis (throttle pada na memoriju).
- **Rizik (ACL pogrešan):** ako korisnik nema `+multi`/`+exec`, throttle tiho prelazi na memoriju
  (log `warn`) — `/api/ready` pokaže `redis: error`, a `ACL GETUSER` u §11.3 otkriva uzrok.
- **Rizik (ključevi drugih aplikacija):** pravo je `~<prefix>*`, pa korisnik ne vidi ni ne mijenja
  ništa van prefiksa; prefiks mora odgovarati onome koji vlasnik upiše u `REDIS_PREFIX`.
- **Rollback:** obrisati `REDIS_HOST` (Coolify env) i restart — throttle se vraća na memorijski
  bez izmjene koda; `git revert` vraća i kod. Nema migracije baze (7 migracija nepromijenjeno).

## 9. Dokumentacija

- [x] `docs/INFRASTRUCTURE.md` §1 (status), §2 (topologija/readiness), §5.4 (env katalog), §9 (I7 zatvoren), **§11 (ACL, provjera, fail-open)**
- [x] `docs/BACKEND.md` §2.4 (throttle u Redisu), §5.2 (Redis storage), §6 (env se čita)
- [x] `docs/DECISIONS.md` **D-039** (aktiviranje, ACL model, fail-open, nova zavisnost)
- [x] `AUDIT/segments/INF-07.md` (ovaj dokument), `AUDIT/STATE.md`, `scripts/audit/segments.json`, matrica

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-03 |
| Commit(ovi) | `f20d1db` — `feat(infra): INF-07 …` (klijent + storage + env + readiness + ACL skripta + docs) |
| CI run | ✅ **`41666523698`** — **6/6** zelen · drill **`41666523647`** ✅ |
| Ispravka | 2026-11-03: vlasnik javio da Redis TLS sluša na **`6380`** (ne 6379) — defaulti (`env.ts`, `redis.service.ts`, compose, env šabloni, ACL skripta, docs §5.4/§11) usklađeni na 6380 |
| Status | `done` |
