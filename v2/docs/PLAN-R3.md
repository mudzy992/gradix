# PLAN R3 — projekti i dodjele (+ opseg „dodijeljeni projekti“)

**Datum:** 2026-11-08 · **Status:** stavke, pun plan kad R3 počne
**Odakle:** `MASTER_BRIEF.md` B11 — R3 je „projekti i dodjele“. Odluka vlasnika iz R1b se time
ne mijenja, samo seli ovdje.

## Obavezno u R3 (odluka vlasnika, 2026-11-08)

- [ ] **Tabela `projects`** (tenant, RLS `tenant_isolation`, `code`, `name`, `is_active`,
      `created_at`) + `memberships.project_ids` FK → `projects(id)` sa `ON DELETE RESTRICT`
      (projekat sa dodijeljenim ljudima se ne briše nego deaktivira).
- [ ] **Vrijednost opsega `PROJECTS`** vraćena u `CHECK (scope IN ('COMPANY','PROJECTS','SELF'))`,
      zajedno sa tabelom dodjela (`project_assignments(company_id, project_id, user_id)`),
      FK na `projects` i `memberships`, i backfillom ako ga bude.
- [ ] **`resolveScope`** u `@gradix/domain` dobija treći slučaj (`PROJECTS` = akcija dozvoljena
      samo nad projektima iz dodjele) — jedan `switch`, jedan novi test, bez diranja R1b logike.
- [ ] **Dozvola `projects.assign`** — **nova, posebna dozvola** za dodjelu projekata osobi
      (odluka vlasnika). **Ne** ide kroz `users.manage`: mijenjanje role i dodjela projekta su
      dvije različite radnje i moraju se moći dati odvojeno. Dodaje se u `PERMISSIONS` i u
      matricu rola; podrazumijevano je imaju OWNER i ADMIN, a može se dati i `PROJECT_MANAGER`.
- [ ] **UI:** izbor projekata u dijalogu „Rola i opseg“ + filter liste po projektu.
- [ ] **Testovi:** tenant izolacija za `projects` i `project_assignments` (kroz generisani test
      iz liste tenant tabela), `projects.assign` odvojeno od `users.manage` (test da dozvola
      `users.manage` sama po sebi **ne** daje dodjelu projekta), E2E: čovjek sa opsegom
      `PROJECTS` vidi samo svoje projekte.

## Zavisnosti

- R3 traži R2b (obaveze s rokom) ako projekat dobija rokove (građevinska dozvola, saglasnosti —
  B5.4 ih vodi pod „Projekat“). Generički model iz R2b to pokriva bez izmjene.
- Blokade iz B5.4 („radnik bez ovlaštenja ne može na mašinu“) traže **i** dodjele (R3) **i**
  radne sate (R5) — zato se uvode u R3/R5, ne u R2.

**Zašto opseg nije bio u R1b:** u R1b ne postoji ekran ni entitet nad kojim bi opseg `PROJECTS`
nešto mijenjao, pa bi bio polje koje nigdje ne važi. Opseg bez dejstva je gori od opsega koji još
ne postoji. Isto pravilo važi i sada.
