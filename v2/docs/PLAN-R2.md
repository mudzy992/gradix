# PLAN R2 — projekti i opseg „dodijeljeni projekti“

**Datum:** 2026-11-08 · **Status:** samo stavke, pun plan kad R2 počne

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
