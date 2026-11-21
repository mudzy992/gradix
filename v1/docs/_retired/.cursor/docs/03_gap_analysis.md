> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Gap analysis — kod vs docs

Datum: 2026-08-16.

## Aktivni gapovi

| Izvor | Docs | Kod | Status |
|---|---|---|---|
| Faza 1.1 `01_phase-01-foundation.md` | `docker-compose.yml`: MySQL 8 + MinIO | Compose: samo MinIO. MySQL vanjski preko `backend/.env` `DATABASE_URL` | Owner override 2026-08-16. Plan fajl nije mijenjan (locked). |
| Faza 1 e2e | Real MinIO | Test helper `MemoryMinioService` jer Docker Desktop nije bio up | E2e ne blokira fazu. |

## Zatvoreno

- Faza 1 kod postoji u `backend/` (ranije HANDOFF: “nema koda”).
- Faza 3: `GET /api/company` (`settings.write`) — nije bio eksplicitno u freeze rutama; potreban za settings formu (legal polja). Users `?role=` filter iz plana Faze 3. `/me.company` za PLATFORM_ADMIN + `X-Company-Id`.
