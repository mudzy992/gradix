# STATUS — Gradix v2

**Faza:** 1 (postavljanje), mini-kapija **poslije koraka 5** · **Datum:** 2026-11-07
**Sljedeće:** čeka riječ vlasnika za nastavak na korake 6–7 (prijava + mobilni kostur).

## Gotovo (koraci 1–5)

| # | Korak | Stanje |
|---|---|---|
| 1 | pnpm workspace, TS strict, ESLint, Turbo | ✅ |
| 2 | `docs/STATUS.md`, `docs/DECISIONS/` (4 ADR-a) | ✅ |
| 3 | Lokalno okruženje | ⚠️ djelimično — PostgreSQL 16.2 pokrenut u sandboxu; **nema Dockera**, pa nema compose-a, MinIO ni Redis |
| 4 | `packages/db`: šema, migracija, role | ✅ migracija `20261107120000_init` prolazi na praznoj bazi |
| 5 | Tenant scope + RLS spike | ✅ **dokazano**, 8/8 testova na pravoj bazi |
| — | `@gradix/domain`: `Money` | ✅ 7/7 testova |

Prolazi: `pnpm test` (15 testova), migracija na praznoj bazi, `roles.sql` bootstrap.

## Ne radi / nije urađeno

- **Prisma generator ne radi** u ovom okruženju (`binaries.prisma.sh` nedostupan) → ADR 0002, SQL-first do provjere u CI-ju.
- **Nema `apps/web`** — nema prijave, nema zaštićene stranice, nema `/api/me` (korak 6).
- **Nema `apps/mobile`** — nema offline zapisa (korak 7).
- **Nema CI-ja** (korak 9), **nema Docker/staging** (korak 10), **nema `AGENTS.md`** (korak 1, drugi dio).
- **Nema `contracts`** (OpenAPI iz koda) — korak 8.
- Lokalno **nema MinIO/Redis** zbog nedostatka Dockera; ne utiče na korake 1–5, utiče na R5 (gorivo, prilozi).

## Otvoreno za vlasnika

1. Riječ za nastavak na korake 6–7 (mini-kapija 2 je poslije 7).
2. Prisma: potvrdi da CI ima pristup `binaries.prisma.sh` — ako da, ADR 0002 se mijenja na „Prisma u CI-ju“.
3. Redis ACL komanda za v2 isporučena u `infra/redis/acl-v2.txt` (izvršava vlasnik).
4. Bucket i prefiks za v2: predlog `gradix-v2` bucket, prefiks `gx2/` u MinIO — potvrda prije R5.
