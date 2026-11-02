# INF-01 — Compose, mreže, env predlošci

| | |
|---|---|
| Sloj | `INF` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-01`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Provjeriti da compose fajlovi, mreže i env predlošci opisuju **isto** stanje koje kod zaista troši,
i pretvoriti to u guard (`check:env`). Ne mijenjaju se mrežna topologija (`db_net`/`redis_net`
external) ni bilo koja vrijednost koja utiče na produkcijski deploy.

**Ne radi se ovdje:** slike i entrypoint (INF-02), nginx (INF-03), Redis odluka (INF-07), globalna
zamjena tagova digestom (planirano uz renovate).

## 2. Ulaz

**Zavisnosti:** STD-01 (`check:all`), CI-01.

**Fajlovi:**

- `docker-compose.yml`, `docker-compose.local-ports.yml`, `.env.example`, `.env.coolify`
- `scripts/standards/check-env.mjs`, `scripts/standards/allowlist.json`
- `docs/INFRASTRUCTURE.md` (§5 env katalog)

## 3. Kriteriji završetka (DoD)

- [x] Svaka varijabla iz compose/entrypoint/Dockerfile/backend/frontend/mobile je u `.env.example`
- [x] `.env.example` i `.env.coolify` imaju identičan skup ključeva
- [x] Nema referenci na penzionisane dokumente iz konfiguracije
- [x] Guard je u `check:all` i u CI jobu `audit`
- [x] Negativan test: uklonjen `MINIO_PORT` iz predloška → exit 1
- [x] `docs/INFRASTRUCTURE.md` §5 govori istinu (uključujući da `JWT_REFRESH_SECRET` još niko ne čita)

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja | Dokaz | Ocjena |
|---|---|---|---|
| 1 | `.env.example` nije imao `PORT`, `MINIO_PORT`, `REDIS_TLS_CA_FILE`, a kod/compose ih koriste | `check-env` prije izmjene: 4 ❌ | ❌ |
| 2 | `.env.example` je upućivao na penzionisan `DEPLOYMENT_COOLIFY.md` (4 mjesta) | `grep -n DEPLOYMENT_COOLIFY .env*` | ❌ |
| 3 | `JWT_REFRESH_SECRET` je obavezan u compose-u, a kod čita samo `JWT_ACCESS_SECRET` | `grep -rn JWT_REFRESH_SECRET backend/src` → prazno | ⚠️ |
| 4 | `REDIS_*` su u compose-u, kod ih ne čita | `grep -rn REDIS_ backend/src` → prazno | ⚠️ (INF-07) |
| 5 | Mreže `db_net`/`redis_net` su `external: true`, nema host portova | `check:compose` (13 provjera) | ✅ |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-01-01 | Env predložak nije pokrivao `PORT`, `MINIO_PORT`, `REDIS_TLS_CA_FILE` → deploy bi radio „slučajno“ na defaultima | visoko | `check-env` prije izmjene | riješeno: dodane u oba predloška |
| F-INF-01-02 | `JWT_REFRESH_SECRET` obavezan, a nekorišten — lažna sigurnost da refresh tok postoji | visoko | `auth.module.ts` koristi samo access tajnu | **dokumentovano** (katalog + predložak); implementacija = BE-02, **nije** tiho brisano |
| F-INF-01-03 | Konfiguracija je upućivala na penzionisan `DEPLOYMENT_COOLIFY.md` | srednje | `.env.example:6,9,20`, `.env.coolify:7` | riješeno: `docs/INFRASTRUCTURE.md` + guard protiv ponavljanja |
| F-INF-01-04 | `REDIS_*` i `REDIS_TLS_CA_FILE` se prenose u kontejner, a kod ih ne čita | srednje | `grep -rn REDIS_ backend/src` | ostaje za **INF-07** (D-014: Redis ostaje) |
| F-INF-01-05 | `MINIO_IMAGE` je `:latest` (nepinovan) | nisko | `.env.example:30` | ostaje za pinning (CI-03 nastavak / renovate); dokumentovano |

## 6. Popravke

- Novi guard `check-env.mjs` (4 provjere, 67 stavki): dokumentovanost, parity predložaka, mrtve
  varijable kao **upozorenje**, zabrana referenci na arhivu.
- `allowlist.json` dobio sekciju `env` sa 4 izuzetka i razlogom (`DEV`, `JEST_WORKER_ID`,
  `MINIO_SKIP`, `EXPO_PUBLIC_API_URL`).
- **Odbačeno:** automatsko generisanje `.env.example` iz koda — izgubili bi komentare koji nose
  kontekst (CA mount, build-time varijable) i smisao predloška.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Pozitivno | `npm run check:all -- --only=env` | PASS (67 provjera) |
| Negativno | uklonjen `MINIO_PORT=9000` iz `.env.example` | exit 1 ✅ |
| CI | job `audit` (guardrail lista uključuje `env`) | vidi `AUDIT/STATE.md` |

## 8. Rizici i rollback

- **Rizik:** obavezni guard može blokirati brzu izmjenu tokom deploya. Ublaženo: izuzeci idu u
  allowlist sa razlogom (vidljivo u review-u), a ne `// skip`.
- **Rollback:** ukloniti korak `env` iz `check-all`/`ci.yml`; vraćanje env predložaka je jedan commit.

## 9. Dokumentacija

- [x] `docs/INFRASTRUCTURE.md` §5.1/§5.4/§5.5
- [x] `docs/CONVENTIONS.md` §7, `docs/CI.md` (guard tabela + `--only` lista)

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-02 |
| Commit(ovi) | `feat(infra): … [INF-01]` |
| CI run | vidi `AUDIT/STATE.md` |
| Status | `done` |
