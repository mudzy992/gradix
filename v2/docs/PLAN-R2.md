# PLAN R2 — projekti i opseg „dodijeljeni projekti“

**Datum:** 2026-11-08 · **Status:** čeka vlasnikov „kreni“ (stavke su odluka; pun plan kad R2 počne)

**Stanje prije početka:** R1a ✅, R1b funkcionalno ✅, dizajn v2 ✅ (vlasnik odobrio 2026-11-08,
`docs/DEMO-DIZAJN.md`). R2 je prvi rez u kojem se dodaje novi entitet poslije R1 — zato ide
prvo `projects`, pa sve što na njemu stoji.

**Pitanje na koje čekam odgovor:** ko smije dodijeliti projekat osobi — samo ADMIN/OWNER (kao
role danas) ili i vođa projekta (`PROJECT_MANAGER`) na svojim projektima? Od toga zavisi da li
`project_assignments` dobija svoju dozvolu ili se veže na postojeću `users.manage`.

## Obavezno u R2 (odluka vlasnika, 2026-11-08)

- [ ] **Tabela `projects`** (tenant, RLS `tenant_isolation`, `code`, `name`, `is_active`,
      `created_at`) + `memberships.project_ids` FK → `projects(id)` sa `ON DELETE RESTRICT`
      (projekat sa dodijeljenim ljudima se ne briše nego deaktivira).
- [ ] **Vrijednost opsega `PROJECTS`** vraćena u `CHECK (scope IN ('COMPANY','PROJECTS','SELF'))`,
      zajedno sa tabelom dodjela (`project_assignments(company_id, project_id, user_id)`),
      FK na `projects` i `memberships`, i backfillom ako ga bude.
- [ ] **`resolveScope`** u `@gradix/domain` dobija treći slučaj (`PROJECTS` = akcija dozvoljena
      samo nad projektima iz dodjele) — jedan `switch`, jedan novi test, bez diranja R1b logike.
- [ ] **UI:** izbor projekata u dijalogu „Rola i opseg“ + filter liste po projektu.
- [ ] **Testovi:** tenant izolacija za `projects` i `project_assignments` (kroz generisani test
      iz liste tenant tabela), dodjela po roli, E2E: čovjek sa opsegom `PROJECTS` vidi samo
      svoje projekte.

**Zašto odloženo:** u R1b ne postoji ekran ni entitet nad kojim bi opseg `PROJECTS` nešto
mijenjao, pa bi bio polje koje nigdje ne važi. Opseg bez dejstva je gori od opsega koji još
ne postoji.
