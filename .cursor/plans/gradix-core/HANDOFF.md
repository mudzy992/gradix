# HANDOFF — Gradix

Datum: 2026-08-16. Repo: `C:\Users\m.ceric\Documents\GitHub\gradix`.

Nova sesija: [PLAN_FREEZE.md](./PLAN_FREEZE.md), ovaj fajl, [DECISIONS.md](../../docs/DECISIONS.md), [01_phase-01-foundation.md](./01_phase-01-foundation.md), [02_phase-02-core-ops-api.md](./02_phase-02-core-ops-api.md).

## Šta je urađeno

**Plan 1–11 LOCKED.** Kod: **samo Faza 1**. Nema `frontend/` ni `mobile/`. Faze 2–11 nisu implementirane.

### Infra
- `docker-compose.yml` — **samo MinIO** (jedan bucket). MySQL nije u Dockeru.
- `backend/.env` (nije u gitu) — vanjski MySQL `DATABASE_URL`, JWT, MinIO, `SEED_PASSWORD`.
- `.env.example` / `backend/.env.example` — placeholder `mysql://USER:PASSWORD@HOST:3306/gradix`.

### Backend (Nest 11 + Prisma 7)
- `backend/prisma/schema.prisma` + `prisma.config.ts` + migracija `20260815120000_phase_01_foundation`
- `backend/prisma/seed.ts` — Company `demo`; `platform@gradix.local` PLATFORM_ADMIN; `admin@gradix.local` SUPER_ADMIN; `mustChangePassword=false`; 11 settings
- Moduli: `health`, `auth` (+ `/me`, FCM device), `users`, `companies` (+ `PATCH /company`), `settings`, `notifications`, `files`, `audit`, `realtime` (Socket.IO rooms `user:{id}` / `company:{id}`)
- Common: envelope, `AppError` + `error.code`, RBAC katalog v1, tenant/JWT/password-change/permissions guards, pagination 20/100
- E2E: `backend/test/*.e2e-spec.ts` (health, auth, users, tenant, files)

### Seed u bazi (applied)
- firma `demo` (Demo Gradnja, Sarajevo)
- `platform@gradix.local` / `admin@gradix.local`
- 11 settings keys

## Odluke + razlozi

- MySQL je **vanjski** (`DATABASE_URL` u `backend/.env`). Docker samo MinIO. Owner override vs Faza 1 plan “MySQL u compose”.
- Zarez u DB lozinci u URL-u ide kao `%2C`.
- Magic-byte upload: lokalni `detect-mime.ts` (Nest CJS; bez ESM `file-type`).
- Prisma 7: `prisma-client` generator → `backend/generated` (gitignore), adapter `@prisma/adapter-mariadb`.
- Timer force-close na deaktivaciji = **no-op** dok nema `TimerSession` (Faza 2).
- JWT access samo `{ sub }`; role iz DB.

## Otvoreno / rizici

- Git: lokalni `main` commit `5bf484a` (`feat(backend): add phase 1 foundation`). Remote nije pushan — `gh` nije ulogovan (`gh auth login`).
- PLATFORM_ADMIN seed lozinka (`SEED_PASSWORD`); 2FA opciono Faza 7.
- Deploy domen nije biran.
- Gap vs plan Faze 1: compose bez MySQL — [03_gap_analysis.md](../../docs/03_gap_analysis.md).

## Next steps

1. Nova sesija: prompt ispod. **Ne implementirati Fazu 2** dok owner ne kaže **izvrši Fazu 2**.
2. Opciono prije Faze 2: `docker compose up -d` (MinIO) + `cd backend && npm run test:e2e`.
3. Faza 2: [02_phase-02-core-ops-api.md](./02_phase-02-core-ops-api.md) — projects/phases/tasks/timer/quantities/TIMER amendment. Nema frontend, nema Machine/Trip.

## Test status

| Šta | Rezultat |
|---|---|
| `npx nest build` | OK |
| `npx prisma generate` | OK |
| vanjski MySQL `gradix` | konekcija OK |
| `prisma migrate deploy` | applied (`phase_01_foundation`) |
| `prisma db seed` | OK (demo + 2 usera + 11 settings) |
| `npm run test:e2e` | nije pokrenuto |

## Prompt za sljedeću sesiju

```
Čitaj `.cursor/plans/gradix-core/PLAN_FREEZE.md` i `HANDOFF.md`. Svih 11 faza plan locked. Faza 1 kod + seed su na vanjskom MySQL (nije Docker). Bez faza 2–11 dok ne kažem „izvrši Fazu 2“.

Ako kažem izvrši Fazu 2: radi po `02_phase-02-core-ops-api.md` + matrice project-status, task-status, timer, spend-progress, data-scope, quantities, amendments. machineId null do 4.1. Nema frontend/mobile.
```
