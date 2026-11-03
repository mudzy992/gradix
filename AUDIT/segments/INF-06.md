# INF-06 — Backup / restore runbook + skripte

| | |
|---|---|
| Sloj | `INF` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-06`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Da backup ne bude pretpostavka nego **dokaz**: skripte koje prave dump, skripta koja ga vraća uz
zaštite od pregazivanja pogrešne baze, i noćni CI drill koji **stvarno** vrati dump i uporedi
podatke sa izvorom. Provjereno: gdje dump završava i koliko se čuva, šta se dešava ako se restore
pokrene nad produkcijom, kako se prepoznaje nepotpun restore, i šta skripte izričito **ne** pokrivaju.

**Ne provjerava:** MinIO objekte (fajlovi na hostu — dokumentovan ručni `mc mirror` korak), izvoz
Coolify env-a, PITR/WAL arhiv (van obima v1 — D‑007 nema staging), automatsko zakazivanje na
produkciji (Coolify „Scheduled Tasks“ ili cron na DB hostu — runbook §7.1), i sam DB servis
(Coolify Postgres je eksterni, P1).

## 2. Ulaz

**Zavisnosti:** BE-08 (migracije + `_prisma_migrations`), INF-01 (env/compose), INF-05 (readiness
provjera migracija — ista logika „folder = migracija“), CI-01 (workflow pravila: nema
`pull_request`, pinovane akcije, `timeout-minutes`).

**Fajlovi:** `scripts/ops/backup.sh`, `scripts/ops/restore.sh` (oba nova) + dokumentacija
`docs/INFRASTRUCTURE.md` §7. Workflow `.github/workflows/backup-restore.yml` i `docs/CI.md` su u
matrici pod **CI-01** (workflow fajlovi), a `scripts/audit/lib.mjs` pod **STD-01** (klasifikacija).

**Pretpostavke:** `pg_dump`/`pg_restore`/`psql` iz `postgresql-client` postoje tamo gdje se skripte
pokreću (host, kontejner, CI); imena tabela su Prisma modeli (seme nemaju `@@map`, pa su u Postgresu
quoted: `"User"`, `"Project"`…); `DATABASE_URL` nosi Prisma parametar `?schema=public` koji libpq
**ne** razumije.

## 3. Kriteriji završetka (DoD)

- [x] Svi fajlovi segmenta pregledani; status u matrici ≥ `pregledano`
- [x] Svaki nalaz ima težinu, dokaz (`fajl:linija`) i odluku
- [x] Popravke imaju dokaz: noćni drill **stvarno** prošao (run u §10), ne samo „skripta postoji“
- [x] `node scripts/audit/check-coverage.mjs` → PASS
- [x] `npx jest` zelen (nepromijenjen: **209/209**)
- [x] `docs/` ažuriran u istom commitu (INFRASTRUCTURE §7 runbook, CI.md drill + dug C8)
- [x] `AUDIT/STATE.md` ažuriran; commit + push + **zelen CI** (runovi u §10)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja / ponašanje | Dokaz (`fajl:linija`) | Ocjena |
|---|---|---|---|
| 1 | Nije postojala nijedna backup ni restore skripta; tabela u dokumentaciji je rekla „prepušteno Coolify/DB servisu“ | `docs/INFRASTRUCTURE.md:172-180` (prije) | ❌ F‑01 |
| 2 | Nije bilo testa da se dump **može vratiti** (dug I3) | `docs/INFRASTRUCTURE.md` dug I3 (prije) | ❌ F‑01 |
| 3 | `pg_dump`/`psql` padaju na Prisma URL-u (`invalid URI query parameter: schema`) — prvi drill je pao upravo tako | run `41661838563` (Backup korak) | ⚠️ F‑02 |
| 4 | Restore nad produkcijom nije imao nikakvu barijeru (skripte nije ni bilo) | — | ⚠️ F‑03 |
| 5 | Provjere redova po tabelama morale su koristiti quoted Prisma imena (`"User"`), ne `users` — drugi drill je pao na tome | run `41662099664` (Restore korak) | ⚠️ F‑04 |
| 6 | `prisma/migrations/` sadrži i `migration_lock.toml`, pa `ls -1 \| wc -l` daje 8 umjesto 7 — treći drill je pao **samo** na tome | run `41662656725` (`migrations 7 od 8`) | ⚠️ F‑05 |
| 7 | Workflow samo sa `schedule` + `workflow_dispatch` nije se registrovao (404 na dispatch) | `gh workflow run` → HTTP 404 | ⚠️ F‑06 |
| 8 | Retencija dumpova i provjera integriteta (sha256) | `scripts/ops/backup.sh` | ✅ (novo) |
| 9 | MinIO objekti, izvoz env-a i PITR ostaju **van** automatizacije i to je u runbook-u eksplicitno | `docs/INFRASTRUCTURE.md` §7.4 | ✅ (svjesno) |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-06-01 | **Backup je bio pretpostavka**: nije postojala skripta, retencija, provjera integriteta ni test restore-a — „imamo backup“ se nije moglo dokazati ni izvršiti bez improvizacije u incidentu | visoko | `docs/INFRASTRUCTURE.md:172-180` (prije), dug I3 | riješeno: `scripts/ops/backup.sh` (custom-format `pg_dump`, sha256, retencija 7) + `scripts/ops/restore.sh`; runbook `docs/INFRASTRUCTURE.md` §7 sa RPO ≤ 24 h / RTO ≤ 1 h |
| F-INF-06-02 | **Dokaz da restore radi** je sada automatizovan: noćni workflow podigne Postgres, migrira, seeduje, napravi dump, vrati ga u **drugu** bazu i uporedi 8 tabela + broj migracija | visoko | run **`41662900597`** ✅ | riješeno: `.github/workflows/backup-restore.yml` (limit 20 min, dump kao artefakt 7 dana). Prvi zelen drill: `User 9, Company 1, Project 1, Task 3, TimerSession 0, AuditEvent 0, CostEntry 0, DiaryEntry 0`, migracije `7 / 7` |
| F-INF-06-03 | **Libpq ne prima Prisma parametar**: `DATABASE_URL` nosi `?schema=public`; `pg_dump`/`psql` padaju sa `invalid URI query parameter: schema` — prvi drill je pao na `Backup (backup.sh)` | srednje | run `41661838563` | riješeno: `pg_conn()` u obje skripte uklanja **samo** `schema=` (ostali parametri, npr. `sslmode`, ostaju); workflow za `psql` koristi `PG_SOURCE`/`PG_TARGET` bez Prisma parametra. Provjereno testom funkcije za 4 oblika URL-a |
| F-INF-06-04 | **Restore je mogao pregaziti pogrešnu bazu**: bez skripte nije bilo ni zaštite; „samo `DATABASE_URL`“ bi u incidentu značilo restore preko izvora | srednje | — | riješeno: `restore.sh` traži **`RESTORE_DATABASE_URL`** (nikad `DATABASE_URL`), odbija cilj identičan izvoru, odbija ime koje sadrži `prod` osim uz `ALLOW_PRODUCTION_RESTORE=yes`, provjeri `sha256` prije nego što dira bazu |
| F-INF-06-05 | **Quoted imena tabela**: seme nemaju `@@map`, pa su tabele `"User"`, `"Project"`, … — provjere sa `users`/`projects` padaju (drugi drill) | nisko | run `41662099664` | riješeno: `RESTORE_VERIFY_TABLES` default `User,Company,Project,Task,TimerSession,AuditEvent,CostEntry,DiaryEntry`; isto u workflow poredjenju; u komentaru zapisano zašto |
| F-INF-06-06 | **`migration_lock.toml` nije migracija**: `ls -1 \| wc -l` je dao 8 umjesto 7, pa je drill pao iako su podaci bili identični | nisko | run `41662656725` (`migrations 7 od 8`) | riješeno: `find … -type d` (isto pravilo kao `expectedMigrationCount()` u INF‑05) |
| F-INF-06-07 | **Schedule-only workflow se nije registrovao**: `gh workflow run` je vratio 404, pa drill nije bio ni pokrenut | nisko | `gh workflow run backup-restore.yml` → HTTP 404 | riješeno: dodat `push` trigger **ograničen na aktivnu granu** i `paths` (`scripts/ops/**`, sam workflow) — u skladu sa CI‑01 pravilom; `docs/CI.md` dokumentuje drill i dug C8 |
| F-INF-06-08 | Dijagnostika: job logovi nisu dostupni iz ovog okruženja (`EOF` na blob URL-u), pa je bilo teško utvrditi **zašto** drill pada | nisko | `gh api …/actions/jobs/<id>/logs` → EOF | riješeno: skripte u workflow-u teku kroz `tee`, a korak „Dijagnostika na pad“ objavljuje zadnjih 12 linija kao `::error::` anotacije (vidljive kroz check-run API) i poređenje šalje `::error title=…::` po tabeli |

## 6. Popravke

1. **`scripts/ops/backup.sh`** (novo) — `pg_dump --format=custom --compress=9 --no-owner
   --no-privileges`, `sha256`, retencija `BACKUP_RETENTION` (default 7), `pg_conn()` za URL;
   jasna greška ako `pg_dump` nije u PATH-u.
2. **`scripts/ops/restore.sh`** (novo) — obavezan `RESTORE_DATABASE_URL`, odbija identičan izvor i
   ime sa `prod`, provjerava `sha256`, `pg_restore --clean --if-exists --no-owner --no-privileges
   --exit-on-error`, pa brojevi redova ključnih tabela (greška ako tabela ne postoji).
3. **`.github/workflows/backup-restore.yml`** (novo) — `schedule` 03:30 UTC + `workflow_dispatch` +
   `push` (paths) na aktivnu granu; Postgres 16 servis, migracije + seed, backup, restore u
   `gradix_restore`, poređenje 8 tabela + migracija, dijagnostika kroz `::error::`, dump kao
   artefakt 7 dana.
4. **`docs/INFRASTRUCTURE.md` §7** — runbook: rutinski backup, restore procedura, RPO/RTO, drill,
   i §7.4 „šta skripte ne pokrivaju“ (MinIO objekti, env izvoz, PITR). Dugovi I2/I3 zatvoreni.
5. **`docs/CI.md`** — novi workflow dokumentovan (okidači, koraci, trajanje), dug C8.
6. **`scripts/audit/lib.mjs`** — `scripts/ops/**` ulazi u inventar kao **INF-06** (prije nije bio
   inventarisan, pa bi „pokrivenost“ tiho zaobišla operativne skripte).

**Odbačene alternative:** (A) `docker run postgres:16 pg_dump …` — radi, ali traži Docker u svakom
okruženju gdje se radi backup i otežava korištenje na DB hostu; (B) `pg_dump --format=plain` (SQL) —
lakše za čitanje, ali bez selektivnog/paralelnog restore-a i veće; (C) backup u MinIO bucket preko
`mc` unutar `backup.sh` — miješa dvije odgovornosti i traži `mc` na svakom hostu; MinIO ostaje
dokumentovan ručni korak (§7.4) dok ne bude poseban segment.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Sintaksa skripti | `bash -n scripts/ops/{backup,restore}.sh` | ✅ |
| `pg_conn()` (4 oblika URL-a) | ručni test kroz `source` funkcije | ✅ (`?schema=public`, `&sslmode=require`, samo `sslmode`, bez parametara) |
| Unit testovi | `npx jest` | **209/209 ✅** (nepromijenjeni) |
| Guardovi | `node scripts/standards/check-all.mjs` | ✅ (`check:secrets` ne vidi tajne u primjerima — URL-ovi su sa `<placeholder>`-ima) |
| Drill | workflow `backup-restore` (ručno) | ✅ **`41662900597`** — backup → restore → 8 tabela identično → migracije `7/7` |

## 8. Rizici i rollback

- **Rizik (RPO):** dnevni dump znači do 24 h gubitka; ako to nije dovoljno, PITR (WAL) na DB servisu
  — van obima v1 i eksplicitno u §7.4.
- **Rizik (dump leži na istom hostu):** runbook traži da dump ide **van** hosta baze (Coolify
  scheduled task / cron na DB hostu + kopija na sekundarnu lokaciju); skripta to ne može garantirati.
- **Rizik (MinIO):** objekti nisu u dumpu — restore baze bez fajlova daje zapise koji pokazuju na
  nepostojeće fajlove; zato je `mc mirror` u runbook-u (§7.4), a ne „zaboravljen“.
- **Rizik (drill troši minute):** pokreće se noću + na promjenu `scripts/ops/**`; trajanje ~1 min.
- **Rollback:** `git revert` koda; workflow se može onemogućiti u GitHub UI bez izmjene koda
  (`gh workflow disable backup-restore.yml`). Nema migracije ni env varijable.

## 9. Dokumentacija

- [x] `docs/INFRASTRUCTURE.md` §7 (backup/restore runbook, RPO/RTO, drill, §7.4 ograničenja) + dugovi I2/I3
- [x] `docs/CI.md` (okidači i koraci drill-a, dug C8)
- [x] `AUDIT/segments/INF-06.md` (ovaj dokument), `AUDIT/STATE.md`, `scripts/audit/segments.json`, matrica

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-03 |
| Commit(ovi) | `feat(ops): INF-06 …` (skripte + workflow + runbook), `ci(ops): INF-06 …` (registracija workflow-a), `fix(ops): INF-06 …` ×3 (libpq `schema`, quoted imena tabela, brojanje foldera), `ci(ops): INF-06 …` (anotacije za dijagnostiku) |
| Drill runovi | ❌ `41661838563` (`?schema=public`) · ❌ `41662099664` (`users` tabela) · ❌ `41662365671` (poređenje bez izlaza) · ❌ `41662656725` (`7 od 8` migracija) · ✅ **`41662900597`** |
| CI run | vidi `AUDIT/STATE.md` (main CI za završni commit) |
| Status | `done` |
