# AUDIT/STATE.md — živi dnevnik

> Pravilo: ovaj fajl se ažurira u **svakom** commitu. Ako nešto nije upisano ovdje, nije se
> ni desilo.

## Aktivna grana

`arena/0bc0e56e-gradix` (remote: `mudzy992/gradix`). Nema PR-ova; radi se direktno na grani.

## Trenutna faza / segment / korak

- **Faza:** FAZA 0 — razumijevanje projekta ✅ **završena**
- **Sljedeće:** FAZA 1 — „dokumentacija vs. stvarnost“ + penzionisanje stare dokumentacije
- **Kapija:** KAPIJA 1 (čekam odobrenje vlasnika nakon FAZE 1)
- **Segmenti:** master plan (FAZA 2) još nije napisan

## Zadnji commit i CI

| | |
|---|---|
| Commit | `5679a4b` — `fix(compose): CA certifikati za bazu/Redis + MinIO podaci na hostu` |
| CI run | [41495269647](https://github.com/mudzy992/gradix/actions/runs/41495269647) — ✅ **success** (5/5 jobova) |
| Prethodni | `645f669` → run [41493920645](https://github.com/mudzy992/gradix/actions/runs/41493920645) ✅ |
| Audit commit | vidi sekciju „Hronologija“ (ovaj dokument + `AUDIT/00_PROJECT_UNDERSTANDING.md`) |

## Hronologija (šta je urađeno)

### 2026-11-02 — priprema infrastrukture (prije audita)
- `c6dbcad` — Dockerfile: `npm ci --include=dev` (Coolify `NODE_ENV=production`).
- `be3bbc7` — MinIO image: mrtve reference zamijenjene `ghcr.io/coollabsio/minio:latest`.
- `a1ca82f` — compose bez host portova (blue/green) + `db_net`/`redis_net` eksterne mreže.
- `645f669` — seed postaje dio produkcijske slike (`node dist/prisma/seed.js`).
- `5679a4b` — CA certifikati (baza/Redis) mapirani + SSL preflight + MinIO podaci na hostu.

### 2026-11-02 — FAZA 0 (`A-00`)
- Pročitana sva dokumentacija: `.cursor/docs/**`, `.cursor/plans/gradix-core/**`,
  `.cursor/rules/00_project.mdc`, `ANALIZA_I_PLAN_PRODUKCIJA.md`, `DEPLOYMENT_COOLIFY.md`,
  `ENV_LIST.md`, `redis-cli-command.md`, `backend/README.md`, `mobile/AGENTS.md`.
- Mapiran repozitorij i stack; izmjereni obim (backend 232 fajla / 16.032 LOC,
  frontend 115 / 8.573, mobile 63 / 1.744, 1 aktivna migracija, 16 e2e + 1 unit test).
- Nalazi koji ulaze u FAZU 1: **MySQL vs PostgreSQL konflikt** (docs+rules vs kod),
  `pull_request` trigger u CI-ju (u suprotnosti sa novim pravilima), nema env validacije pri
  startu, nema coverage praga, mobile bez testova/EAS, `backend/README.md` je Nest starter šum.
- Napisan `AUDIT/00_PROJECT_UNDERSTANDING.md` (14 sekcija, 10 pitanja vlasniku P1–P10).

## Šta je sljedeće (tačan sljedeći korak)

1. FAZA 1.1 — brzi audit „docs vs. stvarnost“ u 5 oblasti (endpointi, moduli, ekrani, env,
   šema + auth) sa tabelom `tvrdnja | stvarno stanje | status | fajl:linija`.
2. FAZA 1.2 — `docs/_retired/` + baneri na svim premještenim dokumentima + `INDEX.md`.
3. FAZA 1.3 — skeleton nove dokumentacije (`ARCHITECTURE`, `INFRASTRUCTURE`, `BACKEND`,
   `FRONTEND`, `MOBILE`, `TESTING`, `CI`, `CONVENTIONS`, `DECISIONS`).
4. Commit + push + provjera CI → **KAPIJA 1** (stajem, tražim odobrenje i odgovore P1–P10).

## Otvorena pitanja / blokatori

- **P1–P10** iz `AUDIT/00_PROJECT_UNDERSTANDING.md` §14 (MySQL vs PostgreSQL je blokirajuće
  za FAZU 2, ostalo je blokirajuće za početak segmenata).
- Nema tehničkih blokatora: lokalni Docker nije dostupan u okruženju agenta, pa se sve
  provjere vezane za image/DB rade kroz CI (job `docker`), a lokalno samo lint/typecheck/build.
