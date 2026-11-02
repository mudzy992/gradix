# HANDOFF — Gradix

Datum: 2026-08-17. Repo: `C:\Users\m.ceric\Documents\GitHub\gradix`.

**Nova sesija čita redom:** [PLAN_FREEZE.md](./PLAN_FREEZE.md) → ovaj fajl → [CHECKLIST.md](./CHECKLIST.md).

v1 plan 1–11 je **implementiran**. Nema Faze 12 u freeze-u.

## Šta je urađeno

**Plan 1–11 LOCKED.** Kod: **Faza 1–11**. Implementacija **100%** (11/11), **100%** po segmentima (41/41).

Canvas: `C:\Users\m.ceric\.cursor\projects\c-Users-m-ceric-Documents-GitHub-gradix\canvases\gradix-implementation-status.canvas.tsx`

### Infra
- Compose: **samo MinIO**. MySQL vanjski (`DATABASE_URL`, baza `gradix`).
- Prisma 7: `backend/prisma/schema/`. Zadnja migracija: `20260817140000_phase_11_iot`.

### Faza 11 (IoT)
- `GpsDevice` 1/mašina (`IOT_DEVICE_EXISTS`). Key Argon2id + sha256 lookup. Plaintext jednom na create/rotate.
- `POST /api/iot/gps` + `X-Device-Key`. Loš key 401. DECOMMISSIONED / `isActive=false` → 403. Throttle 1/5s.
- Phone GPS ostaje (`source=PHONE`). Mapa badge PHONE|IOT (`lastGpsSource`). Key nije u GET.

### Seed (`SEED_PASSWORD`, `mustChangePassword=false`)
`platform@` PLATFORM · `admin@` SUPER_ADMIN · `pm@` · `ss@` · `worker@` · `driver@` · `op@` · `mechanic@` · `accountant@`. Firma `demo` + `DEMO-1`. Dev: backend `:3000`, `cd frontend && npm run dev`.

## Van freeze-a (ne raditi osim ako owner kaže)
CAN bus, tachograph, više IoT uređaja po mašini, Redis geo, auto-deploy, TOTP, SMS, ERP GL/PDV, doprinosi.

## Otvoreno / rizici

- Git: lokalni `main`; remote nije pushan.
- Ne committati `backend/.env`.

## Test status

| Šta | Rezultat |
|---|---|
| `npx nest build` | OK |
| frontend `tsc -b` | OK |
| e2e iot (Faza 11) | **3/3** |
| e2e fleet (401 umjesto 501) | **5/5** |

## Next steps

Nema sljedeće v1 faze. Owner bira: commit/push, deploy, ili van-scope polish.
