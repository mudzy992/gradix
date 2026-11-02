# INF-03 — Frontend image + nginx

| | |
|---|---|
| Sloj | `INF` |
| Obim | `fajlovi` |
| Status | `done` |
| Plan | [`AUDIT/02_MASTER_AUDIT_PLAN.md`](../02_MASTER_AUDIT_PLAN.md) |
| Matrica | [`AUDIT/COVERAGE_MATRIX.csv`](../COVERAGE_MATRIX.csv) (filter `segment=INF-03`) |
| Živi dnevnik | [`AUDIT/STATE.md`](../STATE.md) |

## 1. Svrha i obim

Frontend kontejner (nginx) mora ispravno proxy-ovati API i WebSocket, keširati assete bez
keširanja `index.html`, slati sigurnosne headere **u svakom bloku** i gasiti se graceful.

**Ne radi se ovdje:** dizajn/tokeni (FE-01), a11y (FE-03), bundle budžet (FE-06).

## 2. Ulaz

**Zavisnosti:** INF-01, INF-02 (guard `check:image` postoji).

**Fajlovi:** `frontend/Dockerfile`, `Dockerfile.frontend`, `frontend/nginx/default.conf.template`,
`scripts/standards/check-image.mjs`, `docs/INFRASTRUCTURE.md` §10.

## 3. Kriteriji završetka (DoD)

- [x] `server_tokens off` (nginx ne izdaje verziju)
- [x] Sigurnosni headeri u `server` bloku **i ponovljeni** u `/assets/` i `=/index.html`
- [x] CSP postoji (strogi `script-src 'self'`)
- [x] `STOPSIGNAL SIGQUIT` + `HEALTHCHECK` + exec `CMD`
- [x] Korijenski `Dockerfile.frontend` identičan `frontend/Dockerfile`
- [x] Guard pokriva sve navedeno; negativan test (uklonjen nosniff u `/assets/`) → exit 1
- [x] Web E2E + smoke test frontend kontejnera zeleni sa CSP-om

## 4. Trenutno stanje (dokazi)

| # | Tvrdnja | Dokaz | Ocjena |
|---|---|---|---|
| 1 | `add_header` u `/assets/` i `=/index.html` je **poništavao** nosniff/X-Frame/Referrer | `default.conf.template` (prije) | ❌ |
| 2 | Nije bilo CSP-a | isto | ❌ (W4 u planu) |
| 3 | `server_tokens` nije bio isključen | isto | ⚠️ |
| 4 | Proxy `/api/`, `/socket.io/`, SPA fallback i keš politika su bili ispravni | `default.conf.template` | ✅ |
| 5 | `STOPSIGNAL SIGQUIT`, `HEALTHCHECK`, exec `CMD` | `frontend/Dockerfile` | ✅ |

## 5. Nalazi

| ID | Nalaz | Težina | Dokaz | Odluka |
|---|---|---|---|---|
| F-INF-03-01 | Sigurnosni headeri su tiho nestajali na `/assets/*` i `/index.html` (nginx semantika) | visoko | `location /index.html` blok | riješeno: headeri ponovljeni + guard |
| F-INF-03-02 | Nema `Content-Security-Policy` | visoko | nema headera | riješeno: CSP bez vanjskih izvora |
| F-INF-03-03 | `server_tokens` otkriva verziju nginx-a | nisko | nema direktive | riješeno |
| F-INF-03-04 | Nema automatske provjere da korijenski `Dockerfile.frontend` prati app verziju (bilo je samo u CI jobu `docker`) | srednje | `ci.yml` korak | riješeno: guard provjerava oba para |

## 6. Popravke

- Ponovljeni sigurnosni headeri u oba bloka sa vlastitim `add_header`.
- CSP: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (React/Tailwind
  inline stilovi), `connect-src 'self' ws: wss:`, `object-src 'none'`, `frame-ancestors 'self'`.
- `Permissions-Policy` (kamera/mikrofon/lokacija off) — aplikacija ih ne koristi u webu.
- **Odbačeno:** `nginxinc/nginx-unprivileged` slika (port 8080) — Coolify očekuje 80 i to bi
  zahtijevalo izmjenu compose-a; nginx master ionako mora biti root za port 80.

## 7. Testovi i verifikacija

| Provjera | Komanda | Rezultat |
|---|---|---|
| Guard pozitivno | `npm run check:all -- --only=image` | PASS (17 provjera) |
| Guard negativno | uklonjen nosniff iz `/assets/` | exit 1 ✅ |
| Stvarno ponašanje | CI job `docker` (nginx + proxy) i Web E2E | vidi `AUDIT/STATE.md` |

## 8. Rizici i rollback

- **Rizik:** CSP previše strog → prazna stranica. Ublaženo: `connect-src 'self' ws: wss:` pokriva
  Socket.IO, stilovi dozvoljeni inline; Web E2E pada ako nešto blokira.
- **Rollback:** ukloniti CSP linije (jedan commit); ostalo su aditivni headeri.

## 9. Dokumentacija

- [x] `docs/INFRASTRUCTURE.md` §10 (nginx: proxy, keš, headeri, CSP + zamka `add_header`)
- [x] `docs/CONVENTIONS.md` §7, `docs/CI.md`

## 10. Zapis izvršavanja

| | |
|---|---|
| Datum | 2026-11-02 |
| Commit(ovi) | `feat(infra): … [INF-03]` |
| CI run | vidi `AUDIT/STATE.md` |
| Status | `done` |
